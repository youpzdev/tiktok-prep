import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import mp4mask
from mp4boxes import Mp4Error, _child, _find, _parse, _serialize, _stco_read, _stco_write, _stsz_info


def read_tree(path):
    data = Path(path).read_bytes()
    boxes = []
    offset = 0
    while offset + 8 <= len(data):
        size, kind = struct.unpack_from(">I4s", data, offset)
        if kind not in (b"ftyp", b"free", b"skip", b"moov", b"mdat"):
            break
        if size == 1:
            size = struct.unpack_from(">Q", data, offset + 8)[0]
        if not size:
            size = len(data) - offset
        boxes.extend(_parse(data, offset, offset + size))
        offset += size
    return data, boxes, offset


def track(tree, kind):
    return next(t for t in _find(tree, b"trak")
                if _child(_child(t, b"mdia"), b"hdlr")["data"][8:12] == kind)


def sample_table(trak):
    return _child(_child(_child(trak, b"mdia"), b"minf"), b"stbl")


def packets(data, trak, limit=None):
    stbl = sample_table(trak)
    stsz = _child(stbl, b"stsz")
    fixed, count = _stsz_info(stsz)
    sizes = [fixed] * count if fixed else list(struct.unpack_from(">" + "I" * count, stsz["data"], 12))
    count = min(count, limit) if limit is not None else count
    table = _child(stbl, b"stsc")["data"]
    entries = [struct.unpack_from(">III", table, 8 + i * 12)
               for i in range(struct.unpack_from(">I", table, 4)[0])]
    offsets = _stco_read(_child(stbl, b"stco") or _child(stbl, b"co64"))[1]
    result = []
    entry = 0
    index = 0
    for chunk, offset in enumerate(offsets, 1):
        while entry + 1 < len(entries) and entries[entry + 1][0] <= chunk:
            entry += 1
        for _ in range(entries[entry][1]):
            if index >= count:
                return result
            result.append(data[offset:offset + sizes[index]])
            offset += sizes[index]
            index += 1
    return result


class ReferenceMaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = shutil.which("ffmpeg")
        if not cls.ffmpeg:
            raise unittest.SkipTest("ffmpeg unavailable")
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "source.mp4"
        subprocess.run([cls.ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                        "-i", "testsrc2=size=64x64:rate=12:duration=1", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=48000:duration=1", "-c:v", "libx264",
                        "-profile:v", "main", "-c:a", "aac", "-movflags", "+faststart",
                        "-y", str(cls.source)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.out = self.root / (self._testMethodName + ".mp4")

    def run_mask(self, source=None, **kwargs):
        return mp4mask.mask_reference(str(source or self.source), str(self.out), **kwargs)

    def rewritten(self, name, mutate):
        _, tree, _ = read_tree(self.source)
        original_mdat = next(b for b in tree if b["type"] == b"mdat")["start"]
        mutate(tree)
        mdat = next(b for b in tree if b["type"] == b"mdat")
        shift = sum(len(_serialize([b])) for b in tree[:tree.index(mdat)]) - original_mdat
        for box in list(_find(tree, b"stco")) + list(_find(tree, b"co64")):
            _stco_write(box, [value + shift for value in _stco_read(box)[1]])
        path = self.root / name
        path.write_bytes(_serialize(tree))
        return path

    def assert_real_packets(self, source):
        original, before, _ = read_tree(source)
        result, after, _ = read_tree(self.out)
        for kind in (b"vide", b"soun"):
            before_track = track(before, kind)
            after_track = track(after, kind)
            real = _stsz_info(_child(sample_table(before_track), b"stsz"))[1]
            self.assertEqual(packets(original, before_track), packets(result, after_track, real))
            self.assertEqual(_child(sample_table(before_track), b"stsd")["data"],
                             _child(sample_table(after_track), b"stsd")["data"])
            for child in (b"tkhd",):
                self.assertEqual(_child(before_track, child)["data"], _child(after_track, child)["data"])
            self.assertEqual(_child(_child(before_track, b"mdia"), b"mdhd")["data"],
                             _child(_child(after_track, b"mdia"), b"mdhd")["data"])

    def test_single_audio_tenfold_tail_and_unknown_duration(self):
        stats = self.run_mask()
        original, before, _ = read_tree(self.source)
        result, after, tail = read_tree(self.out)
        self.assertEqual(len(list(_find(after, b"trak"))), 2)
        audio_before = sample_table(track(before, b"soun"))
        audio_after = sample_table(track(after, b"soun"))
        count = _stsz_info(_child(audio_before, b"stsz"))[1]
        self.assertEqual(_stsz_info(_child(audio_after, b"stsz"))[1], count * 10)
        self.assertEqual(stats["ghost_samples"], count * 9)
        self.assertEqual(result[tail:], mp4mask.GHOST_SAMPLE_BYTES * count * 9)
        self.assertEqual(_stco_read(_child(audio_after, b"stco"))[1][-1], tail)
        self.assertEqual(struct.unpack_from(">II", _child(audio_after, b"stts")["data"],
                                           len(_child(audio_after, b"stts")["data"]) - 8), (count * 9, 1))
        self.assertEqual(len(list(_find(after, b"edts"))), 0)
        self.assertFalse(any(box["type"] in (b"free", b"skip") for box in after))
        mvhd_before = next(_find(before, b"mvhd"))["data"]
        mvhd_after = next(_find(after, b"mvhd"))["data"]
        self.assertEqual(mvhd_after[0], 1)
        self.assertEqual(mvhd_after[24:32], bytes([255]) * 8)
        self.assertEqual(struct.unpack_from(">QQI", mvhd_after, 4), struct.unpack_from(">III", mvhd_before, 4))
        self.assertEqual(mvhd_after[32:], mvhd_before[20:])
        self.assert_real_packets(self.source)
        decoded = subprocess.run([self.ffmpeg, "-v", "error", "-i", str(self.out), "-map", "0:v:0",
                                  "-f", "null", "-"], capture_output=True)
        self.assertEqual(decoded.returncode, 0, decoded.stderr.decode())
        self.assertEqual(decoded.stderr, b"")

    def test_ghost_off_keeps_normal_timing_and_edit_lists(self):
        for ghost in (0, 1, -1):
            with self.subTest(ghost=ghost):
                self.run_mask(ghost=ghost)
                before, _, _ = read_tree(self.source)
                after, _, tail = read_tree(self.out)
                self.assertEqual(before, after)
                self.assertEqual(tail, len(after))

    def test_no_audio_keeps_finite_movie(self):
        source = self.root / "silent.mp4"
        subprocess.run([self.ffmpeg, "-v", "error", "-i", str(self.source), "-an", "-c:v", "copy",
                        "-y", str(source)], check=True, capture_output=True)
        stats = self.run_mask(source)
        self.assertEqual(stats["ghost_samples"], 0)
        self.assertEqual(source.read_bytes(), self.out.read_bytes())

    def test_co64_and_moov_after_media(self):
        def mutate(tree):
            for box in _find(tree, b"stco"):
                offsets = _stco_read(box)[1]
                box["type"] = b"co64"
                _stco_write(box, offsets)
            moov = next(b for b in tree if b["type"] == b"moov")
            tree.remove(moov)
            tree.append(moov)
        source = self.rewritten("co64.mp4", mutate)
        self.run_mask(source, too_value='{"test":"expanded metadata content"}')
        self.assert_real_packets(source)
        _, tree, _ = read_tree(self.out)
        self.assertEqual(len(list(_find(tree, b"co64"))), 2)
        self.assertEqual(len(list(_find(tree, b"stco"))), 0)

    def test_existing_mvhd_version_one_preserves_fields(self):
        def mutate(tree):
            box = next(_find(tree, b"mvhd"))
            data = box["data"]
            box["data"] = bytes([1]) + data[1:4] + struct.pack(">QQIQ", 2 ** 40, 2 ** 41, 1000, 1000) + data[20:]
        source = self.rewritten("version-one.mp4", mutate)
        self.run_mask(source)
        _, before, _ = read_tree(source)
        _, after, _ = read_tree(self.out)
        old = next(_find(before, b"mvhd"))["data"]
        new = next(_find(after, b"mvhd"))["data"]
        self.assertEqual(new, old[:24] + bytes([255]) * 8 + old[32:])
        self.assert_real_packets(source)

    def test_metadata_growth_and_bitrate_boxes_preserved(self):
        value = '{"creation_id":"' + "a" * 200 + '"}'
        stats = self.run_mask(too_value=value)
        self.assertTrue(stats["too_set"])
        self.assertIn(value.encode(), self.out.read_bytes())
        self.assertGreater(self.source.read_bytes().count(b"btrt"), 0)
        self.assertEqual(self.source.read_bytes().count(b"btrt"), self.out.read_bytes().count(b"btrt"))
        self.assert_real_packets(self.source)

    def test_missing_tables_and_multiple_media_leave_output_unchanged(self):
        for missing in (b"stsz", b"stts", b"stsc", b"stco"):
            with self.subTest(missing=missing):
                def mutate(tree):
                    stbl = sample_table(track(tree, b"soun"))
                    stbl["children"] = [b for b in stbl["children"] if b["type"] != missing]
                source = self.rewritten("missing-" + missing.decode() + ".mp4", mutate)
                self.out.write_bytes(b"existing output")
                with self.assertRaises(Mp4Error):
                    self.run_mask(source)
                self.assertEqual(self.out.read_bytes(), b"existing output")
                self.assertFalse(Path(str(self.out) + ".part").exists())
        source = self.root / "multiple.mp4"
        source.write_bytes(self.source.read_bytes() + struct.pack(">I4s", 8, b"mdat"))
        with self.assertRaises(Mp4Error):
            self.run_mask(source)
        self.assertEqual(self.out.read_bytes(), b"existing output")

    def test_replace_failure_preserves_output_and_cleans_partial(self):
        self.out.write_bytes(b"existing output")
        with patch("mp4mask.os.replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                self.run_mask()
        self.assertEqual(self.out.read_bytes(), b"existing output")
        self.assertFalse(Path(str(self.out) + ".part").exists())

    def test_legacy_mask_retains_old_max_behavior(self):
        stats = mp4mask.mask(str(self.source), str(self.out), ghost=10)
        _, result, _ = read_tree(self.out)
        self.assertEqual(len(list(_find(result, b"trak"))), 3)
        self.assertGreater(stats["btrt_removed"], 0)
        self.assertNotIn(b"btrt", self.out.read_bytes())
        self.assertEqual(next(_find(result, b"mvhd"))["data"][0], 0)


if __name__ == "__main__":
    unittest.main()
