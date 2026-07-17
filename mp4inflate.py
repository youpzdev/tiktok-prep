# MP4 container patcher — реализует itzcrih-метод без реэнкода.
#
# Что делает inflate():
#   1. Дописывает N фиктивных 8-байтных сэмплов в конец mdat.
#   2. Обновляет таблицы видеотрека stsz / stts / stsc / stco (или co64),
#      согласованно пересчитывая все оффсеты чанков во всех треках.
#   3. Обнуляет 32-байтное поле compressorname в stsd.
# Реэнкод не выполняется — H.264/AAC-битстрим остаётся нетронутым.
#
# Ремукс (-c copy) и брендинг-теги делаются на стороне ffmpeg ДО вызова inflate().

import struct

# Боксы-контейнеры, в которые нужно спускаться. Остальное — непрозрачные листья.
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


def _zero_compressorname(stsd_box):
    """Обнулить 32-байтное поле compressorname в первом визуальном sample-entry."""
    d = bytearray(stsd_box["data"])
    # payload stsd: version+flags(4) + entry_count(4) + sample-entries
    i = 8
    entry_count = struct.unpack(">I", d[4:8])[0]
    zeroed = False
    for _ in range(entry_count):
        if i + 8 > len(d):
            break
        esize = struct.unpack(">I", d[i:i + 4])[0]
        etype = bytes(d[i + 4:i + 8])
        if etype in VISUAL_ENTRIES:
            # compressorname: смещение 50 внутри visual sample entry, длина 32
            start = i + 50
            if start + 32 <= len(d):
                d[start:start + 32] = b"\x00" * 32
                zeroed = True
        if esize < 8:
            break
        i += esize
    stsd_box["data"] = bytes(d)
    return zeroed


# ---------------------------------------------------------------- главная операция

def inflate(in_path, out_path, multiplier=9):
    """Пропатчить MP4: раздуть счётчик кадров, обнулить compressorname.

    multiplier — во сколько раз добавить фиктивных кадров к реальным.
    Возвращает dict со статистикой.
    """
    with open(in_path, "rb") as f:
        data = f.read()

    tree = _parse(data, 0, len(data))
    top_types = [b["type"] for b in tree]
    moov = next((b for b in tree if b["type"] == b"moov"), None)
    mdat = next((b for b in tree if b["type"] == b"mdat"), None)
    if moov is None or mdat is None:
        raise Mp4Error("не найден moov или mdat — файл не подходит для патча")

    # --- найти видеотрек
    video_trak = None
    for trak in _find(moov["children"], b"trak"):
        hdlr = None
        mdia = _child(trak, b"mdia")
        if mdia:
            hdlr = _child(mdia, b"hdlr")
        if hdlr and hdlr["data"][8:12] == b"vide":
            video_trak = trak
            break
    if video_trak is None:
        raise Mp4Error("не найден видеотрек")

    stbl = None
    node = video_trak
    for t in (b"mdia", b"minf", b"stbl"):
        node = _child(node, t)
        if node is None:
            raise Mp4Error(f"не найден бокс {t!r} в видеотреке")
    stbl = node

    stsz = _child(stbl, b"stsz")
    stts = _child(stbl, b"stts")
    stsc = _child(stbl, b"stsc")
    stsd = _child(stbl, b"stsd")
    stco = _child(stbl, b"stco") or _child(stbl, b"co64")
    if not all((stsz, stts, stsc, stsd, stco)):
        raise Mp4Error("в видеотреке нет полного набора таблиц stbl")

    _, real_frames = _stsz_info(stsz)
    if real_frames == 0:
        raise Mp4Error("в видеотреке нет сэмплов")
    fake_frames = real_frames * int(multiplier)
    if fake_frames <= 0:
        raise Mp4Error("multiplier должен быть > 0")

    delta = _stts_last_delta(stts)
    if delta is None:
        mdhd = _child(_child(video_trak, b"mdia"), b"mdhd")
        delta = 1  # запасной вариант; на практике stts всегда непустой
        if mdhd:
            delta = struct.unpack(">I", mdhd["data"][12:16])[0] // max(1, real_frames)

    # --- количество существующих (реальных) чанков видеотрека
    is64, existing_offsets = _stco_read(stco)
    real_chunk_count = len(existing_offsets)

    # --- 1. модифицируем таблицы видеотрека (схема itzcrih)
    #   stsz  : +fake_frames сэмплов размера 8  → sample_count 10x
    #   stts  : +один entry (fake_frames, delta) с тем же тиком
    #   stsc  : +один entry (real_chunk_count+1, 1, 1) — по 1 сэмплу на чанк,
    #           правило распространяется на все фиктивные чанки до конца
    #   stco  : +fake_frames чанков, все указывают на один и тот же оффсет
    #   stsd  : обнулить compressorname
    # mdat при этом НЕ растёт: фиктивные чанки ссылаются на хвостовой free-бокс.
    _stsz_append(stsz, fake_frames, 8)
    _stts_append(stts, fake_frames, delta)
    _stsc_append(stsc, real_chunk_count + 1, 1, 1)
    compressor_zeroed = _zero_compressorname(stsd)

    offs = existing_offsets + [0] * fake_frames    # placeholder'ы под фиктивные чанки
    _stco_write(stco, offs)

    # --- 2. на сколько вырос moov (растут только stsz/stts/stsc/stco)
    new_moov_size = len(_serialize([moov]))
    growth = new_moov_size - moov["size"]

    # сдвиг сэмпл-данных = рост боксов, лежащих ФИЗИЧЕСКИ до mdat (только moov)
    moov_idx = top_types.index(b"moov")
    mdat_idx = top_types.index(b"mdat")
    shift = growth if moov_idx < mdat_idx else 0

    # --- 3. оффсет фиктивных чанков = начало хвостового free-бокса, который мы
    #        допишем в самый конец файла = суммарный размер всех текущих боксов
    #        (moov уже с новым размером, mdat не тронут).
    def _box_size(b):
        if "children" in b:
            return len(_serialize([b]))
        return b["header"] + len(b["data"])

    fake_offset = sum(_box_size(b) for b in tree)

    # --- 4. сдвинуть все существующие оффсеты чанков во ВСЕХ треках на рост moov
    for box in list(_find(moov["children"], b"stco")) + list(_find(moov["children"], b"co64")):
        b64, boffs = _stco_read(box)
        _stco_write(box, [o + shift for o in boffs])

    # видеотрек: фиктивные (последние fake_frames) чанки → на хвостовой free-бокс
    b64, boffs = _stco_read(stco)
    for k in range(len(boffs) - fake_frames, len(boffs)):
        boffs[k] = fake_offset
    _stco_write(stco, boffs)

    if not is64 and fake_offset >= 2 ** 32:
        raise Mp4Error("оффсет > 4 ГБ — нужен co64 (файл слишком большой)")

    # --- 5. хвостовой free-бокс (32 байта, как у itzcrih); его первые 8 байт
    #        '00 00 00 20 66 72 65 65' и есть то, что «читают» фиктивные сэмплы.
    tree.append({"type": b"free", "header": 8, "data": b"\x00" * 24})

    out = _serialize(tree)
    with open(out_path, "wb") as f:
        f.write(out)

    return {
        "real_frames": real_frames,
        "fake_frames": fake_frames,
        "total_frames": real_frames + fake_frames,
        "real_chunks": real_chunk_count,
        "total_chunks": real_chunk_count + fake_frames,
        "compressor_zeroed": compressor_zeroed,
        "in_size": len(data),
        "out_size": len(out),
    }


if __name__ == "__main__":
    import sys
    src, dst = sys.argv[1], sys.argv[2]
    mult = int(sys.argv[3]) if len(sys.argv) > 3 else 9
    print(inflate(src, dst, mult))
