"""Правка MP4: прежняя маскировка для Max и контейнер по образцу для Stealth."""

import json
import os
import struct

from mp4boxes import (Mp4Error, _child, _find, _parse, _serialize, _stco_read,
                      _stco_write, _set_compressorname, _stsc_append, _stsz_append,
                      _stsz_info, _stts_append, _stts_last_delta, _strip_entry_box)

X264_SEI_UUID = bytes.fromhex("dc45e9bde6d948b7962cd820d923eeef")
ENCODER_MARKER = b"x264 - core"
GHOST_SAMPLE_SIZE = 8            # как у рабочего патчера: 8 байт на фиктивный сэмпл
GHOST_SAMPLE_BYTES = bytes([0, 0, 0, 4, 0, 0, 0, 0])     # их содержимое сэмпла
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


def _blank_sei(total_len):
    """SEI NAL ровно total_len байт, состоящий только из filler_payload."""
    filler = _fit_filler(total_len - 2)        # -1 на NAL header, -1 на 0x80
    if filler is None:
        raise Mp4Error(f"не удалось собрать filler на {total_len} байт")
    nal = b"\x06" + filler + b"\x80"
    if len(nal) != total_len:
        raise Mp4Error(f"SEI собран неверно: {len(nal)} != {total_len}")
    return nal


def _mask_sei(data):
    """Вырезать x264-SEI целиком вместе с полем длины NAL.

    В потоке рабочего патчера нет ни одного SEI, поэтому мало затереть подпись
    filler-ом: сам факт наличия user data выдаёт посторонний энкодер. Данные
    сдвигаются, поэтому вызывающий код обязан поправить размер затронутого
    сэмпла и оффсеты чанков - для этого возвращается список вырезов.
    """
    buf = bytearray(data)
    cuts = []
    pos = 0
    marker = bytes([0x06, 0x05])
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
        if start < 4 or bytes(buf[start:start + 2]) != marker:
            continue
        nal_len = struct.unpack(">I", buf[start - 4:start])[0]
        if start + nal_len > len(buf):
            continue
        cut_from = start - 4                   # вместе с четырьмя байтами длины
        cut_len = nal_len + 4
        del buf[cut_from:cut_from + cut_len]
        cuts.append((cut_from, cut_len))
        pos = cut_from
    return bytes(buf), cuts


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
    """Тег ©too в том виде, в каком его пишет рабочий патчер (версия 2026-08-29)."""
    return json.dumps({
        "aid": "0", "libevc": "1", "trans_type": "4", "te_is_reencode": "1",
        "te_is_use_ai_predict": "0", "maxrate": str(int(maxrate_bps)),
        "creation_id": str(creation_id), "creation_time": str(int(creation_time)),
        "extra": "{}",
    })


def _video_stbl(moov):
    for trak in _find(moov["children"], b"trak"):
        mdia = _child(trak, b"mdia")
        hdlr = _child(mdia, b"hdlr") if mdia else None
        if hdlr and hdlr["data"][8:12] == b"vide":
            node = trak
            for t in (b"mdia", b"minf", b"stbl"):
                node = _child(node, t)
                if node is None:
                    raise Mp4Error(f"в видеотреке нет бокса {t!r}")
            return node
    raise Mp4Error("видеотрек не найден")


def _copy_box(box):
    if "children" in box:
        return {"type": box["type"], "header": box["header"], "start": box["start"],
                "size": box["size"], "children": [_copy_box(c) for c in box["children"]]}
    return dict(box)


def _audio_trak(moov):
    for trak in _find(moov["children"], b"trak"):
        mdia = _child(trak, b"mdia")
        hdlr = _child(mdia, b"hdlr") if mdia else None
        if hdlr and hdlr["data"][8:12] == b"soun":
            return trak
    return None


def _add_ghost_audio(moov, multiplier):
    """Добавить клон аудиодорожки с фиктивными сэмплами.

    Приём подсмотрен у рабочего патчера: клон несёт те же реальные сэмплы плюс
    в multiplier-1 раз больше фиктивных длиной один тик каждый. Анализатор,
    считающий длительность как число аудиокадров умножить на 1024 и поделить на
    частоту, видит время в multiplier раз больше реального и оценивает битрейт
    во столько же раз ниже. При этом видео не тронуто, fps честный, а настоящая
    длительность клона растёт лишь на доли секунды.

    Возвращает (число фиктивных сэмплов, размер фиктивного сэмпла).
    """
    src = _audio_trak(moov)
    if src is None:
        return 0, 0
    clone = _copy_box(src)
    stbl = clone
    for t in (b"mdia", b"minf", b"stbl"):
        stbl = _child(stbl, t)
        if stbl is None:
            return 0, 0
    stsz, stts, stsc = _child(stbl, b"stsz"), _child(stbl, b"stts"), _child(stbl, b"stsc")
    stco = _child(stbl, b"stco") or _child(stbl, b"co64")
    if not all((stsz, stts, stsc, stco)):
        return 0, 0

    _, real_samples = _stsz_info(stsz)
    if real_samples == 0:
        return 0, 0
    fake = real_samples * (int(multiplier) - 1)
    if fake <= 0:
        return 0, 0
    _, real_chunks = _stco_read(stco)

    _stsz_append(stsz, fake, GHOST_SAMPLE_SIZE)
    _stts_append(stts, fake, 1)                    # один тик на фиктивный сэмпл
    _stsc_append(stsc, len(real_chunks) + 1, fake, 1)
    _stco_write(stco, real_chunks + [0])           # оффсет проставим после сборки

    # Длительность дорожки обязана сойтись с суммой дельт stts, иначе контейнер
    # формально невалиден. Заодно убираем edts: список правок обрезал бы клон
    # обратно к исходной длине и гасил весь смысл затеи.
    mdia_clone = _child(clone, b"mdia")
    mdhd = _child(mdia_clone, b"mdhd")
    md = bytearray(mdhd["data"])
    md[16:20] = struct.pack(">I", struct.unpack(">I", md[16:20])[0] + fake)
    mdhd["data"] = bytes(md)
    clone["children"] = [c for c in clone["children"] if c["type"] != b"edts"]

    mvhd = _child(moov, b"mvhd")
    next_id = struct.unpack(">I", mvhd["data"][-4:])[0]
    tkhd = _child(clone, b"tkhd")
    tkhd["data"] = tkhd["data"][:12] + struct.pack(">I", next_id) + tkhd["data"][16:]
    mvhd["data"] = mvhd["data"][:-4] + struct.pack(">I", next_id + 1)

    moov["children"].insert(moov["children"].index(src) + 1, clone)
    return fake, GHOST_SAMPLE_SIZE


def _inflate_tables(moov, multiplier):
    """Дописать фиктивные сэмплы в таблицы видеотрека.

    Контейнер начинает заявлять во столько-то раз больше кадров при той же
    длительности медиаданных, из-за чего наблюдаемый битрейт выглядит низким.
    Реальные сэмплы и mdat не трогаются: фиктивные чанки указывают за конец
    файла, а их размер задан минимальным.
    """
    stbl = _video_stbl(moov)
    stsz, stts, stsc = _child(stbl, b"stsz"), _child(stbl, b"stts"), _child(stbl, b"stsc")
    stco = _child(stbl, b"stco") or _child(stbl, b"co64")
    if not all((stsz, stts, stsc, stco)):
        raise Mp4Error("в видеотреке неполный набор таблиц stbl")
    _, real_frames = _stsz_info(stsz)
    if real_frames == 0:
        raise Mp4Error("в видеотреке нет сэмплов")
    fake = real_frames * int(multiplier)
    delta = _stts_last_delta(stts) or 1
    _, real_chunks = _stco_read(stco)
    _stsz_append(stsz, fake, 8)
    _stts_append(stts, fake, delta)
    _stsc_append(stsc, len(real_chunks) + 1, 1, 1)
    _stco_write(stco, real_chunks + [0] * fake)
    return fake


def mask(in_path, out_path, sei_text="EditingVC1-v1.5.0.2", too_value=None,
         ghost=0, inflate=0):
    """sei_text уходит в compressorname (MediaInfo показывает его как
    Encoded_Library). Сам SEI с настройками x264 вычищается: у нативного
    экспорта в потоке нет ни одного user_data_unregistered."""
    with open(in_path, "rb") as f:
        data = f.read()

    tree = _parse(data, 0, len(data))
    top_types = [b["type"] for b in tree]
    moov = next((b for b in tree if b["type"] == b"moov"), None)
    if moov is None or b"mdat" not in top_types:
        raise Mp4Error("не найден moov или mdat")

    # SEI вырезается внутри mdat, поэтому размер бокса пересчитается при сборке.
    # Медиаданные при этом укорачиваются: правим размер задетого сэмпла и все
    # оффсеты правее выреза.
    mdat = next(b for b in tree if b["type"] == b"mdat")
    mdat_body, sei_cuts = _mask_sei(mdat["data"])
    if sei_cuts:
        mdat["data"] = mdat_body
        base = mdat["start"] + mdat["header"]
        stbl = _video_stbl(moov)
        stsz = _child(stbl, b"stsz")
        d = bytearray(stsz["data"])
        for _, cut_len in sei_cuts:
            first = struct.unpack(">I", d[12:16])[0]
            d[12:16] = struct.pack(">I", max(0, first - cut_len))
        stsz["data"] = bytes(d)
        for cut_from, cut_len in sei_cuts:
            abs_cut = base + cut_from
            for box in list(_find(moov["children"], b"stco")) + list(_find(moov["children"], b"co64")):
                _, offs = _stco_read(box)
                _stco_write(box, [o - cut_len if o > abs_cut else o for o in offs])

    stsd_written = 0
    btrt_removed = 0
    for stsd in _find(moov["children"], b"stsd"):
        stsd_written += _set_compressorname(stsd, sei_text)
        btrt_removed += _strip_entry_box(stsd, b"btrt")

    too_set = False
    if too_value is not None:
        udta = _child(moov, b"udta")
        if udta is not None and "data" in udta:
            udta["data"], too_set = _set_ilst_tag(udta["data"], b"\xa9too", too_value)

    fake_frames = _inflate_tables(moov, inflate) if inflate else 0
    ghost_samples, ghost_size = _add_ghost_audio(moov, ghost) if ghost > 1 else (0, 0)

    # У нативного экспорта между moov и mdat нет ничего: пустой free-бокс от
    # faststart выкидываем, а сдвиг медиаданных считаем по фактической позиции
    # mdat, а не по одному лишь росту moov.
    mdat = next(b for b in tree if b["type"] == b"mdat")
    mdat_before = mdat["start"]
    tree = [b for b in tree if not (b["type"] in (b"free", b"skip")
                                    and b["start"] < mdat_before)]
    mdat_after = sum((len(_serialize([b])) if "children" in b else b["header"] + len(b["data"]))
                     for b in tree[:tree.index(mdat)])
    shift = mdat_after - mdat_before
    growth = len(_serialize([moov])) - moov["size"]
    if shift:
        for box in list(_find(moov["children"], b"stco")) + list(_find(moov["children"], b"co64")):
            _, offs = _stco_read(box)
            _stco_write(box, [o + shift for o in offs])

    tail_offset = sum((len(_serialize([b])) if "children" in b else b["header"] + len(b["data"]))
                      for b in tree)
    if not (fake_frames or ghost_samples) or tail_offset < 2 ** 32:
        pass
    else:
        raise Mp4Error("оффсет за 4 ГБ, нужен co64")

    if fake_frames:
        # Фиктивные чанки все смотрят в один оффсет за концом медиаданных:
        # mdat не растёт, реальные сэмплы не трогаются.
        stbl = _video_stbl(moov)
        stco = _child(stbl, b"stco") or _child(stbl, b"co64")
        _, offs = _stco_read(stco)
        for k in range(len(offs) - fake_frames, len(offs)):
            offs[k] = tail_offset
        _stco_write(stco, offs)

    if ghost_samples:
        # Единственный чанк с фиктивными сэмплами лежит в хвосте файла.
        clone = [t for t in _find(moov["children"], b"trak")][-1]
        stbl = clone
        for t in (b"mdia", b"minf", b"stbl"):
            stbl = _child(stbl, t)
        stco = _child(stbl, b"stco") or _child(stbl, b"co64")
        _, offs = _stco_read(stco)
        offs[-1] = tail_offset
        _stco_write(stco, offs)

    out = _serialize(tree)                     # собираем до открытия файла:
    if ghost_samples:
        block = GHOST_SAMPLE_BYTES[:ghost_size]
        out += block * ghost_samples                # данные фиктивных сэмплов
    elif fake_frames:
        out += bytes(32)

    tmp_path = out_path + ".part"              # сбой не должен портить готовый выход
    with open(tmp_path, "wb") as f:
        f.write(out)
    os.replace(tmp_path, out_path)

    return {"sei_removed": len(sei_cuts), "compressorname": stsd_written,
            "too_set": too_set, "moov_growth": growth,
            "fake_frames": fake_frames, "ghost_samples": ghost_samples,
            "btrt_removed": btrt_removed,
            "encoder_left": ENCODER_MARKER in out}


def _reference_tables(trak, media_start, media_end):
    stbl = trak
    for kind in (b"mdia", b"minf", b"stbl"):
        stbl = _child(stbl, kind)
        if stbl is None:
            raise Mp4Error(f"в дорожке нет бокса {kind!r}")
    tables = {kind: _child(stbl, kind) for kind in (b"stsd", b"stsz", b"stts", b"stsc")}
    offsets = [_child(stbl, kind) for kind in (b"stco", b"co64")]
    offsets = [box for box in offsets if box is not None]
    if not all(tables.values()) or len(offsets) != 1:
        raise Mp4Error("неполный или дублирующийся набор таблиц сэмплов")
    offset_box = offsets[0]
    for kind, minimum in ((b"stsd", 8), (b"stsz", 12), (b"stts", 8), (b"stsc", 8)):
        if len(tables[kind]["data"]) < minimum:
            raise Mp4Error(f"обрезана таблица сэмплов {kind!r}")
    if len(offset_box["data"]) < 8:
        raise Mp4Error("обрезана таблица смещений чанков")
    fixed, samples = _stsz_info(tables[b"stsz"])
    expected = 12 if fixed else 12 + samples * 4
    if len(tables[b"stsz"]["data"]) != expected:
        raise Mp4Error("повреждена таблица размеров сэмплов")
    chunk_count = struct.unpack_from(">I", offset_box["data"], 4)[0]
    width = 8 if offset_box["type"] == b"co64" else 4
    if len(offset_box["data"]) != 8 + chunk_count * width:
        raise Mp4Error("повреждена таблица смещений чанков")
    chunks = _stco_read(offset_box)[1]
    entries = {}
    for kind, width, fmt in ((b"stts", 8, ">II"), (b"stsc", 12, ">III")):
        body = tables[kind]["data"]
        count = struct.unpack_from(">I", body, 4)[0]
        if len(body) != 8 + count * width:
            raise Mp4Error(f"повреждена таблица сэмплов {kind!r}")
        entries[kind] = [struct.unpack_from(fmt, body, 8 + i * width) for i in range(count)]
    if sum(count for count, _ in entries[b"stts"]) != samples:
        raise Mp4Error("число сэмплов в таблицах времени и размеров не совпадает")
    if samples == 0:
        if chunks or entries[b"stsc"]:
            raise Mp4Error("у пустой дорожки есть записи чанков")
        return tables, offset_box, chunks, samples, 1
    mappings = entries[b"stsc"]
    descriptions = struct.unpack_from(">I", tables[b"stsd"]["data"], 4)[0]
    if not chunks or not mappings or mappings[0][0] != 1:
        raise Mp4Error("нет записи первого чанка")
    previous = 0
    for first, count, description in mappings:
        if first <= previous or first > len(chunks) or count == 0 or not 1 <= description <= descriptions:
            raise Mp4Error("повреждена таблица распределения сэмплов по чанкам")
        previous = first
    sample_index = 0
    mapping_index = 0
    sizes = tables[b"stsz"]["data"]
    for chunk_index, offset in enumerate(chunks, 1):
        while mapping_index + 1 < len(mappings) and mappings[mapping_index + 1][0] <= chunk_index:
            mapping_index += 1
        chunk_samples = mappings[mapping_index][1]
        if sample_index + chunk_samples > samples:
            raise Mp4Error("чанки ссылаются на несуществующие сэмплы")
        if fixed:
            size = fixed * chunk_samples
        else:
            size = sum(struct.unpack_from(">I", sizes, 12 + index * 4)[0]
                       for index in range(sample_index, sample_index + chunk_samples))
        if offset < media_start or offset + size > media_end:
            raise Mp4Error("реальный чанк выходит за границы медиаданных")
        sample_index += chunk_samples
    if sample_index != samples:
        raise Mp4Error("часть реальных сэмплов не привязана к чанкам")
    return tables, offset_box, chunks, samples, mappings[-1][2]


def _reference_movie_duration(mvhd):
    data = mvhd["data"]
    if len(data) < 4:
        raise Mp4Error("обрезан заголовок фильма")
    if data[0] == 0 and len(data) >= 100:
        created, modified, timescale = struct.unpack_from(">III", data, 4)
        mvhd["data"] = (bytes([1]) + data[1:4] + struct.pack(">QQIQ", created, modified,
                        timescale, 2 ** 64 - 1) + data[20:])
    elif data[0] == 1 and len(data) >= 112:
        mvhd["data"] = data[:24] + bytes([255]) * 8 + data[32:]
    else:
        raise Mp4Error("неподдерживаемый заголовок фильма")


def _reference_box_size(box):
    if "children" in box:
        payload = sum(_reference_box_size(child) for child in box["children"])
        header = 8
    else:
        payload = len(box["data"])
        header = box["header"]
    if header == 16 or payload + header >= 2 ** 32:
        header = 16
    return payload + header


def mask_reference(in_path, out_path, ghost=10, too_value=None):
    with open(in_path, "rb") as source:
        data = source.read()
    try:
        tree = _parse(data, 0, len(data))
    except (struct.error, IndexError) as exc:
        raise Mp4Error("обрезан бокс MP4") from exc
    movies = [box for box in tree if box["type"] == b"moov"]
    media = [box for box in tree if box["type"] == b"mdat"]
    if len(movies) != 1 or len(media) != 1:
        raise Mp4Error("нужен ровно один moov и один mdat")
    if sum(box["size"] for box in tree) != len(data):
        raise Mp4Error("найдены лишние байты за пределами боксов MP4")
    moov, mdat = movies[0], media[0]
    mvhd = _child(moov, b"mvhd")
    if mvhd is None:
        raise Mp4Error("нет заголовка фильма")
    media_start = mdat["start"] + mdat["header"]
    media_end = mdat["start"] + mdat["size"]
    tracks = []
    audio = []
    video = []
    for trak in _find(moov["children"], b"trak"):
        mdia = _child(trak, b"mdia")
        hdlr = _child(mdia, b"hdlr") if mdia else None
        if hdlr is None or len(hdlr["data"]) < 12:
            raise Mp4Error("не указан тип дорожки")
        kind = hdlr["data"][8:12]
        if kind not in (b"vide", b"soun"):
            raise Mp4Error(f"неподдерживаемый тип дорожки {kind!r}")
        if _child(trak, b"tkhd") is None or _child(mdia, b"mdhd") is None:
            raise Mp4Error("нет заголовка с длительностью дорожки")
        tables, offsets, chunks, samples, description = _reference_tables(trak, media_start, media_end)
        item = {"trak": trak, "tables": tables, "offsets": offsets, "chunks": chunks,
                "samples": samples, "description": description, "fake": 0}
        tracks.append(item)
        (audio if kind == b"soun" else video).append(item)
    if len(video) != 1 or len(audio) > 1:
        raise Mp4Error("нужна одна видеодорожка и не больше одной аудиодорожки")
    too_set = False
    if too_value is not None:
        udta = _child(moov, b"udta")
        if udta is not None and "data" in udta:
            udta["data"], too_set = _set_ilst_tag(udta["data"], b"\xa9too", too_value)
    ghost_samples = 0
    if audio and ghost > 1 and audio[0]["samples"]:
        item = audio[0]
        ghost_samples = item["samples"] * (int(ghost) - 1)
        if item["samples"] + ghost_samples >= 2 ** 32:
            raise Mp4Error("число аудиосэмплов не помещается в 32-битную таблицу")
        tables = item["tables"]
        _stsz_append(tables[b"stsz"], ghost_samples, GHOST_SAMPLE_SIZE)
        _stts_append(tables[b"stts"], ghost_samples, 1)
        _stsc_append(tables[b"stsc"], len(item["chunks"]) + 1, ghost_samples, item["description"])
        _stco_write(item["offsets"], item["chunks"] + [0])
        item["fake"] = ghost_samples
        for current in tracks:
            trak = current["trak"]
            trak["children"] = [box for box in trak["children"] if box["type"] != b"edts"]
        _reference_movie_duration(mvhd)
        tree = [box for box in tree if not (box["type"] in (b"free", b"skip")
                and not box["data"] and box["start"] < mdat["start"])]
    for _ in range(len(tracks) + 2):
        media_position = sum(_reference_box_size(box) for box in tree[:tree.index(mdat)])
        header = _reference_box_size(mdat) - len(mdat["data"])
        shift = media_position + header - media_start
        tail = sum(_reference_box_size(box) for box in tree)
        promoted = False
        for item in tracks:
            offsets = [value + shift for value in item["chunks"]]
            if item["fake"]:
                offsets.append(tail)
            if any(value < 0 or value >= 2 ** 64 for value in offsets):
                raise Mp4Error("смещение чанка не помещается в формат контейнера")
            box = item["offsets"]
            if box["type"] == b"stco" and any(value >= 2 ** 32 for value in offsets):
                box["type"] = b"co64"
                promoted = True
            _stco_write(box, offsets)
        if not promoted:
            break
    else:
        raise Mp4Error("не удалось пересчитать смещения чанков")
    out = _serialize(tree)
    if ghost_samples:
        out += GHOST_SAMPLE_BYTES * ghost_samples
    out_path = os.fspath(out_path)
    tmp_path = out_path + ".part"
    try:
        with open(tmp_path, "wb") as target:
            target.write(out)
        os.replace(tmp_path, out_path)
    except OSError:
        try:
            os.remove(tmp_path)
        except FileNotFoundError:
            pass
        raise
    return {"sei_removed": 0, "compressorname": 0, "too_set": too_set,
            "moov_growth": _reference_box_size(moov) - moov["size"], "fake_frames": 0,
            "ghost_samples": ghost_samples, "btrt_removed": 0,
            "encoder_left": ENCODER_MARKER in out}
