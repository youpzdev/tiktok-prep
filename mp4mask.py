# MP4 fingerprint mask - приводит выход ffmpeg к виду нативного экспорта
# мобильного редактора (эталон MediaInfo: EditingVC1 / TikTok Editing).
#
# Что делает mask():
#   1. SEI user_data_unregistered с полной строкой настроек x264 заменяется на
#      короткую строку энкодера + filler_payload той же длины - длина NAL
#      сохраняется, таблицы stsz/stco остаются валидными, битстрим не меняется.
#   2. compressorname в stsd обнуляется.
#   3. Тег ©too ("Lavf<version>") заменяется на JSON-строку редактора;
#      moov растёт, поэтому оффсеты чанков во всех треках пересчитываются.
# Реэнкод не выполняется - декодированные кадры остаются побитово теми же.

import json
import os
import struct

from mp4boxes import (Mp4Error, _child, _find, _parse, _serialize, _stco_read,
                        _stco_write, _zero_compressorname)

X264_SEI_UUID = bytes.fromhex("dc45e9bde6d948b7962cd820d923eeef")
ENCODER_MARKER = b"x264 - core"
MASK_SEI_UUID = bytes.fromhex("7b1e4c9a3f52d84b91c6ae23f7d5b168")
FULL_BOXES = {b"meta"}


def _enc_size(n):
    out = bytearray()
    while n >= 255:
        out.append(0xFF)
        n -= 255
    out.append(n)
    return bytes(out)


def _fit_filler(rest):
    """filler_payload ровно rest байт: [03][size][0xFF * size].

    Длины вида 256k+1 недостижимы одним payload: при однобайтовом size потолок
    256, а двухбайтовый начинается с 258. Такие длины закрываются двумя filler
    подряд, иначе профиль с неудачной длиной SEI ронял бы каждый файл.
    """
    if rest < 0:
        return None
    if rest == 0:
        return b""
    for n in range(min(rest, 65535), -1, -1):
        if 1 + len(_enc_size(n)) + n == rest:
            return b"\x03" + _enc_size(n) + b"\xFF" * n
    for first in (2, 3, 4):
        tail = _fit_filler(rest - first)
        head = _fit_filler(first)
        if head is not None and tail is not None:
            return head + tail
    return None


def _build_sei(total_len, uuid16, text):
    """SEI NAL ровно total_len байт: user_data_unregistered + filler_payload."""
    for pad in range(0, 4):
        body = uuid16 + text.encode("ascii") + b" " * pad
        head = b"\x06\x05" + _enc_size(len(body)) + body
        rest = total_len - len(head) - 1       # -1 на rbsp_stop_one_bit (0x80)
        if rest < 0:
            continue
        filler = _fit_filler(rest)
        if filler is None:
            continue
        nal = head + filler + b"\x80"
        if len(nal) != total_len:
            raise Mp4Error(f"SEI собран неверно: {len(nal)} != {total_len}")
        return nal
    raise Mp4Error("строка энкодера не укладывается в исходный SEI")


def _mask_sei(data, sei_text):
    """Заменить все x264-SEI на строку sei_text. Длины сэмплов не меняются."""
    buf = bytearray(data)
    replaced = 0
    pos = 0
    while True:
        i = buf.find(X264_SEI_UUID, pos)
        if i < 0:
            break
        pos = i + 16
        # назад до начала NAL: [06][05][0xFF...][size_last] перед UUID
        k = i - 2                       # i-1 - последний байт payload_size
        while k > 4 and buf[k] == 0xFF:
            k -= 1
        start = k - 1
        if start < 4 or bytes(buf[start:start + 2]) != b"\x06\x05":
            continue
        nal_len = struct.unpack(">I", buf[start - 4:start])[0]
        if start + nal_len > len(buf):
            continue
        buf[start:start + nal_len] = _build_sei(nal_len, MASK_SEI_UUID, sei_text)
        replaced += 1
        pos = start + nal_len
    return bytes(buf), replaced


def _walk_blob(data, start, end, path, out):
    i = start
    while i + 8 <= end:
        size = struct.unpack(">I", data[i:i + 4])[0]
        typ = data[i + 4:i + 8]
        header = 8
        if size == 1:
            if i + 16 > end:                   # не бокс, а тело чужого тега
                return
            size = struct.unpack(">Q", data[i + 8:i + 16])[0]
            header = 16
        elif size == 0:
            size = end - i
        if size < header or i + size > end:
            return
        out.append((i, typ, size, header, tuple(path)))
        body = i + header + (4 if typ in FULL_BOXES else 0)
        _walk_blob(data, body, i + size, path + [i], out)
        i += size


def _set_ilst_tag(udta_data, key, value):
    """Переписать значение тега key в udta, поправив размеры всех предков."""
    boxes = []
    _walk_blob(udta_data, 0, len(udta_data), [], boxes)
    target = next((b for b in boxes if b[1] == key), None)
    if target is None:
        return udta_data, False
    tag_start, _, tag_size, _, _ = target
    data_box = next((b for b in boxes if b[1] == b"data"
                     and tag_start < b[0] < tag_start + tag_size), None)
    if data_box is None:
        return udta_data, False
    d_start, _, d_size, d_header, ancestors = data_box
    prefix = udta_data[d_start + d_header:d_start + d_header + 8]   # ver/flags + locale
    new_payload = prefix + value.encode("utf-8")
    new_size = d_header + len(new_payload)
    delta = new_size - d_size

    buf = bytearray(udta_data)
    buf[d_start:d_start + d_size] = struct.pack(">I", new_size) + b"data" + new_payload
    if delta:
        for off in sorted(set(ancestors), reverse=True):
            old = struct.unpack(">I", buf[off:off + 4])[0]
            buf[off:off + 4] = struct.pack(">I", old + delta)
    return bytes(buf), True


def encoder_json(maxrate_bps, creation_id, creation_time):
    return json.dumps({
        "aid": "0", "libevc": "1", "trans_type": "4", "te_is_reencode": "1",
        "maxrate": str(int(maxrate_bps)), "cr": "0.00", "br": "0.00",
        "beauty": "0.00", "creation_id": str(creation_id),
        "creation_time": str(int(creation_time)),
    })


def mask(in_path, out_path, sei_text="EditingVC1-v1.5.0.2", too_value=None):
    with open(in_path, "rb") as f:
        data = f.read()

    data, sei_count = _mask_sei(data, sei_text)

    tree = _parse(data, 0, len(data))
    top_types = [b["type"] for b in tree]
    moov = next((b for b in tree if b["type"] == b"moov"), None)
    if moov is None or b"mdat" not in top_types:
        raise Mp4Error("не найден moov или mdat")

    stsd_zeroed = 0
    for stsd in _find(moov["children"], b"stsd"):
        if _zero_compressorname(stsd):
            stsd_zeroed += 1

    too_set = False
    if too_value is not None:
        udta = _child(moov, b"udta")
        if udta is not None and "data" in udta:
            udta["data"], too_set = _set_ilst_tag(udta["data"], b"\xa9too", too_value)

    growth = len(_serialize([moov])) - moov["size"]
    if growth and top_types.index(b"moov") < top_types.index(b"mdat"):
        for box in list(_find(moov["children"], b"stco")) + list(_find(moov["children"], b"co64")):
            _, offs = _stco_read(box)
            _stco_write(box, [o + growth for o in offs])

    out = _serialize(tree)                     # собираем до открытия файла:
    tmp_path = out_path + ".part"              # сбой не должен портить готовый выход
    with open(tmp_path, "wb") as f:
        f.write(out)
    os.replace(tmp_path, out_path)

    return {"sei_replaced": sei_count, "stsd_zeroed": stsd_zeroed,
            "too_set": too_set, "moov_growth": growth,
            "encoder_left": ENCODER_MARKER in out}
