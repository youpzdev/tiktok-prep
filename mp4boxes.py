# MP4 box tree: parsing, serialization and chunk-offset tables.
#
# Модуль знает только про структуру контейнера. Правки фингерпринта живут в
# mp4mask.py, пайплайн - в app.py.

import struct

# Боксы-контейнеры, в которые нужно спускаться. Остальное - непрозрачные листья.
CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl"}

# Визуальные sample-entry, у которых есть поле compressorname.
VISUAL_ENTRIES = {b"avc1", b"avc3", b"hev1", b"hvc1", b"av01", b"vp09", b"vp08",
                  b"mp4v", b"encv", b"dvav", b"dvhe"}


class Mp4Error(Exception):
    pass


# ---------------------------------------------------------------- box tree

def _parse(data, start, end):
    boxes = []
    i = start
    while i + 8 <= end:
        size = struct.unpack(">I", data[i:i + 4])[0]
        typ = data[i + 4:i + 8]
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[i + 8:i + 16])[0]
            header = 16
        elif size == 0:
            size = end - i
        if size < header or i + size > end:
            raise Mp4Error(f"битый бокс {typ!r} на позиции {i}")
        box = {"type": typ, "header": header, "start": i, "size": size}
        if typ in CONTAINERS:
            box["children"] = _parse(data, i + header, i + size)
        else:
            box["data"] = data[i + header:i + size]  # payload без заголовка
        boxes.append(box)
        i += size
    return boxes


def _serialize(boxes):
    out = bytearray()
    for box in boxes:
        if "children" in box:
            payload = _serialize(box["children"])
            header = 8  # контейнеры всегда пересчитываем как 32-бит
        else:
            payload = box["data"]
            # Листья сохраняют исходную ширину заголовка, чтобы не сдвигать
            # абсолютные оффсеты (критично для mdat).
            header = box["header"]
        total = header + len(payload)
        if header == 16 or total >= 2 ** 32:
            out += struct.pack(">I", 1) + box["type"] + struct.pack(">Q", 16 + len(payload))
        else:
            out += struct.pack(">I", total) + box["type"]
        out += payload
    return bytes(out)


def _find(boxes, typ):
    """Все боксы данного типа во всём поддереве."""
    for b in boxes:
        if b["type"] == typ:
            yield b
        if "children" in b:
            yield from _find(b["children"], typ)


def _child(box, typ):
    for b in box.get("children", []):
        if b["type"] == typ:
            return b
    return None


# ---------------------------------------------------------------- stbl-таблицы

def _stco_read(box):
    """→ (is64, [offsets])"""
    d = box["data"]
    is64 = box["type"] == b"co64"
    count = struct.unpack(">I", d[4:8])[0]
    w = 8 if is64 else 4
    fmt = ">Q" if is64 else ">I"
    offs = [struct.unpack(fmt, d[8 + i * w:8 + i * w + w])[0] for i in range(count)]
    return is64, offs


def _stco_write(box, offs):
    is64 = box["type"] == b"co64"
    fmt = ">Q" if is64 else ">I"
    body = bytearray(box["data"][:4])              # version + flags
    body += struct.pack(">I", len(offs))
    for o in offs:
        body += struct.pack(fmt, o)
    box["data"] = bytes(body)


def _stsz_info(box):
    d = box["data"]
    sample_size, count = struct.unpack(">II", d[4:12])
    return sample_size, count


def _stsz_append(box, n, size):
    """Дописать n сэмплов размера size. Разворачивает constant-size в таблицу."""
    d = bytearray(box["data"])
    sample_size, count = struct.unpack(">II", d[4:12])
    if sample_size != 0:
        # constant-size → превращаем в явную таблицу
        table = bytearray()
        for _ in range(count):
            table += struct.pack(">I", sample_size)
        d = bytearray(d[:4]) + struct.pack(">II", 0, count) + table
    for _ in range(n):
        d += struct.pack(">I", size)
    struct.pack_into(">I", d, 8, count + n)         # обновить sample_count
    box["data"] = bytes(d)


def _stts_last_delta(box):
    d = box["data"]
    count = struct.unpack(">I", d[4:8])[0]
    if count == 0:
        return None
    off = 8 + (count - 1) * 8
    return struct.unpack(">I", d[off + 4:off + 8])[0]


def _stts_append(box, sample_count, delta):
    d = bytearray(box["data"])
    count = struct.unpack(">I", d[4:8])[0]
    d += struct.pack(">II", sample_count, delta)
    struct.pack_into(">I", d, 4, count + 1)
    box["data"] = bytes(d)


def _stsc_count(box):
    return struct.unpack(">I", box["data"][4:8])[0]


def _stsc_append(box, first_chunk, samples_per_chunk, desc_index):
    d = bytearray(box["data"])
    count = struct.unpack(">I", d[4:8])[0]
    d += struct.pack(">III", first_chunk, samples_per_chunk, desc_index)
    struct.pack_into(">I", d, 4, count + 1)
    box["data"] = bytes(d)


AUDIO_ENTRY_HEADER = 36          # до вложенных боксов в AudioSampleEntry
VISUAL_ENTRY_HEADER = 86         # то же для VisualSampleEntry


def _strip_entry_box(stsd_box, drop_type):
    """Убрать вложенный бокс (например btrt) из всех sample-entry в stsd.

    btrt объявляет буфер, максимальный и средний битрейт явными числами. Пока он
    на месте, любой оценщик читает настоящий битрейт прямо из контейнера, и
    никакие ухищрения с длительностью на него не действуют.
    """
    d = bytearray(stsd_box["data"])
    count = struct.unpack(">I", d[4:8])[0]
    i = 8
    removed = 0
    for _ in range(count):
        if i + 8 > len(d):
            break
        esize = struct.unpack(">I", d[i:i + 4])[0]
        etype = bytes(d[i + 4:i + 8])
        if esize < 8:
            break
        inner = i + (VISUAL_ENTRY_HEADER if etype in VISUAL_ENTRIES else AUDIO_ENTRY_HEADER)
        j = inner
        while j + 8 <= i + esize:
            bsize = struct.unpack(">I", d[j:j + 4])[0]
            btype = bytes(d[j + 4:j + 8])
            if bsize < 8 or j + bsize > i + esize:
                break
            if btype == drop_type:
                del d[j:j + bsize]
                esize -= bsize
                d[i:i + 4] = struct.pack(">I", esize)
                removed += 1
                continue
            j += bsize
        i += esize
    stsd_box["data"] = bytes(d)
    return removed


def _set_compressorname(stsd_box, text):
    """Записать compressorname во все визуальные sample-entry.

    Поле длиной 32 байта в формате Pascal-строки: длина, символы, паддинг нулями.
    MediaInfo читает его как Encoded_Library, поэтому имя энкодера живёт именно
    здесь. Пустой text обнуляет поле целиком.
    """
    raw = text.encode("ascii", "ignore")[:31]
    if raw:
        field = bytes([len(raw)]) + raw + bytes(31 - len(raw))
    else:
        field = bytes(32)
    d = bytearray(stsd_box["data"])
    # payload stsd: version+flags(4) + entry_count(4) + sample-entries
    i = 8
    entry_count = struct.unpack(">I", d[4:8])[0]
    written = 0
    for _ in range(entry_count):
        if i + 8 > len(d):
            break
        esize = struct.unpack(">I", d[i:i + 4])[0]
        etype = bytes(d[i + 4:i + 8])
        if etype in VISUAL_ENTRIES:
            # compressorname: смещение 50 внутри visual sample entry, длина 32
            start = i + 50
            if start + 32 <= len(d):
                d[start:start + 32] = field
                written += 1
        if esize < 8:
            break
        i += esize
    stsd_box["data"] = bytes(d)
    return written

