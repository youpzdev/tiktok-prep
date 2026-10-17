import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import app
from mp4boxes import _child, _find, _stsz_info
from tests.test_reference_mask import packets, read_tree, sample_table, track


class MaxPipelineTests(unittest.TestCase):
    def setUp(self):
        self.info = {"width": 1080, "height": 1920, "fps": 60.0,
                     "duration": 2.0, "frames": 120, "size": 1000000,
                     "vcodec": "h264", "pix_fmt": "yuv420p", "acodec": "aac",
                     "audio_hz": 48000}

    def command(self):
        return app.build_command("in.mp4", "out.mp4", self.info, app.PROFILES["max"])

    def test_max_always_reencodes_with_reference_profile(self):
        command = self.command()
        for flag, expected in (("-c:v", "libx264"), ("-profile:v", "main"),
                               ("-level", "5.2"), ("-preset", "slow"), ("-refs", "4"),
                               ("-bsf:v", app.REFERENCE_SEI_FILTER)):
            self.assertIn(flag, command)
            self.assertEqual(command[command.index(flag) + 1], expected)
        self.assertFalse(app.can_copy_stream(self.info, app.PROFILES["max"]))

    def test_max_uses_quality_target_with_bounded_peak(self):
        command = self.command()
        self.assertIn("-crf", command)
        self.assertEqual(command[command.index("-crf") + 1], "14")
        self.assertNotIn("-b:v", command)
        self.assertEqual(command[command.index("-maxrate") + 1], "40M")
        self.assertEqual(command[command.index("-bufsize") + 1], "80M")

    def test_max_limits_resolution_and_fps_without_upscale(self):
        for width, height, fps, scale, expected_fps in (
                (2160, 3840, 120, "scale=1080:1920", 60),
                (3840, 2160, 120, "scale=1920:1080", 60),
                (720, 1280, 24, None, 24),
                (1920, 1920, 59.94, "scale=1080:1080", 59.94)):
            with self.subTest(width=width, height=height, fps=fps):
                self.info.update(width=width, height=height, fps=fps, frames=fps * 2)
                command = self.command()
                self.assertIn("-r", command)
                self.assertEqual(float(command[command.index("-r") + 1]), expected_fps)
                filters = command[command.index("-vf") + 1]
                if scale:
                    self.assertIn(scale, filters)
                else:
                    self.assertNotIn("scale=", filters)

    def run_ffmpeg(self, args):
        result = subprocess.run([app.FFMPEG, "-v", "error", *args], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        return result

    def test_real_job_single_audio_ghosts_and_unchanged_real_packets(self):
        with tempfile.TemporaryDirectory(prefix="max-pipeline-") as directory:
            root = Path(directory)
            source = root / "source.mp4"
            self.run_ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=128x96:rate=120:duration=1",
                             "-f", "lavfi", "-i", "sine=sample_rate=48000:duration=1",
                             "-c:v", "libx264", "-c:a", "aac", "-y", str(source)])
            encoded = root / "encoded.mp4"
            original_mask = app.mp4mask.mask_reference
            def save_encoded(src, dst, **kwargs):
                shutil.copyfile(src, encoded)
                return original_mask(src, dst, **kwargs)
            item = {"src": str(source), "status": "queued"}
            job = {"mode": "max", "ghost": 10, "files": [item]}
            with patch.dict(app.JOBS, {"max-test": job}), patch.object(
                    app.mp4mask, "mask_reference", side_effect=save_encoded):
                app.process_job("max-test")
            self.assertEqual(item["status"], "done", item)
            self.assertFalse(item["copied"])
            output = Path(item["dst"])
            before_data, before, _ = read_tree(encoded)
            data, tree, tail = read_tree(output)
            self.assertEqual(len(list(_find(tree, b"trak"))), 2)
            self.assertEqual(len(list(_find(tree, b"edts"))), 0)
            mvhd = next(_find(tree, b"mvhd"))["data"]
            self.assertEqual(mvhd[0], 1)
            self.assertEqual(mvhd[24:32], b"\xff" * 8)
            for kind in (b"vide", b"soun"):
                previous = track(before, kind)
                current = track(tree, kind)
                count = _stsz_info(_child(sample_table(previous), b"stsz"))[1]
                self.assertEqual(packets(before_data, previous), packets(data, current, count))
                self.assertEqual(_child(_child(previous, b"mdia"), b"mdhd")["data"],
                                 _child(_child(current, b"mdia"), b"mdhd")["data"])
            audio_count = _stsz_info(_child(sample_table(track(before, b"soun")), b"stsz"))[1]
            self.assertEqual(_stsz_info(_child(sample_table(track(tree, b"soun")), b"stsz"))[1],
                             audio_count * 10)
            self.assertEqual(data[tail:], app.mp4mask.GHOST_SAMPLE_BYTES * audio_count * 9)
            info = app.probe(str(output))
            self.assertEqual((info["width"], info["height"], info["fps"]), (128, 96, 60.0))
            self.assertEqual(info["frames"], 60)
            for mapping in ("0:v:0", "0:a:0"):
                decoded = self.run_ffmpeg(["-i", str(encoded), "-map", mapping, "-f", "null", "-"])
                self.assertEqual(decoded.stderr, b"")
            decoded = self.run_ffmpeg(["-i", str(output), "-map", "0:v:0", "-f", "null", "-"])
            self.assertEqual(decoded.stderr, b"")
            streams = json.loads(subprocess.run([
                app.FFPROBE, "-v", "quiet", "-show_streams", "-of", "json", str(encoded)
            ], capture_output=True, text=True, encoding="utf-8", check=True).stdout)["streams"]
            video, audio = streams
            self.assertEqual(video["profile"], "Main")
            self.assertEqual(video["level"], 52)
            self.assertAlmostEqual(float(video["start_time"]), float(audio["start_time"]), delta=0.03)
            self.assertAlmostEqual(float(video["duration"]), float(audio["duration"]), delta=0.03)
            masked_streams = json.loads(subprocess.run([
                app.FFPROBE, "-v", "quiet", "-show_streams", "-of", "json", str(output)
            ], capture_output=True, text=True, encoding="utf-8", check=True).stdout)["streams"]
            self.assertAlmostEqual(float(masked_streams[0]["start_time"]),
                                   float(masked_streams[1]["start_time"]), delta=0.05)

    def test_real_silent_job_does_not_create_audio(self):
        with tempfile.TemporaryDirectory(prefix="max-silent-") as directory:
            source = Path(directory) / "source.mp4"
            self.run_ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=64x64:rate=24:duration=0.5",
                             "-c:v", "libx264", "-y", str(source)])
            item = {"src": str(source), "status": "queued"}
            with patch.dict(app.JOBS, {"silent-test": {"mode": "max", "ghost": 10, "files": [item]}}):
                app.process_job("silent-test")
            self.assertEqual(item["status"], "done", item)
            self.assertIsNone(item["after"]["acodec"])
            self.assertEqual(item["after"]["fps"], 24.0)
            _, tree, _ = read_tree(item["dst"])
            self.assertEqual(len(list(_find(tree, b"trak"))), 1)
            self.assertEqual(item["patch"]["ghost_samples"], 0)

    def test_real_downscale_and_frame_limit(self):
        with tempfile.TemporaryDirectory(prefix="max-scale-") as directory:
            source = Path(directory) / "source.mp4"
            output = Path(directory) / "encoded.mp4"
            self.run_ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=2048x1152:rate=120:duration=0.25",
                             "-c:v", "libx264", "-preset", "ultrafast", "-y", str(source)])
            result = subprocess.run(app.build_command(str(source), str(output), app.probe(str(source)),
                                    app.PROFILES["max"]), capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            info = app.probe(str(output))
            self.assertEqual((info["width"], info["height"], info["fps"], info["frames"]),
                             (1920, 1080, 60.0, 15))


if __name__ == "__main__":
    unittest.main()
