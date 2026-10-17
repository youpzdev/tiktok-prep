import math
from pathlib import Path
import struct
import tempfile
import unittest

import app


class StealthPipelineTests(unittest.TestCase):
    def setUp(self):
        self.info = {
            "width": 1080, "height": 1080, "fps": 60.0,
            "frames": 1172, "duration": 19.744708,
            "movie_duration": 19.552, "size": 43634756,
            "vcodec": "h264", "pix_fmt": "yuv420p", "acodec": "aac",
            "audio_hz": 48000,
        }

    def command(self, mode="stealth"):
        return app.build_command("input.mp4", "output.mp4", self.info, app.PROFILES[mode])

    def test_stealth_main_profile_and_level(self):
        command = self.command()
        self.assertEqual(command[command.index("-profile:v") + 1], "main")
        self.assertEqual(command[command.index("-level") + 1], "5.2")

    def test_reference_frame_rate_and_rate_budget(self):
        command = self.command()
        self.assertEqual(command[command.index("-r") + 1], "59.357677")
        self.assertEqual(command[command.index("-b:v") + 1], "17853k")
        self.assertEqual(command[command.index("-maxrate") + 1], "35706k")
        self.assertEqual(command[command.index("-bufsize") + 1], "53559k")
        self.assertEqual(command[command.index("-g") + 1], "118")
        self.assertNotEqual(command[command.index("-sc_threshold") + 1], "0")

    def test_reference_sei_and_compressor(self):
        command = self.command()
        filters = command[command.index("-bsf:v") + 1]
        self.assertEqual(filters, "filter_units=remove_types=6,h264_metadata=sei_user_data="
                         "dc45e9bde6d948b7a2cb100000000000+evc0 v1.4.2.2-20260920")
        self.assertIn("encoder=Lavc libx264", command)

    def test_fps_does_not_exceed_limit_or_source(self):
        self.info.update(fps=120.0, frames=2400, duration=20.0)
        command = self.command()
        self.assertEqual(float(command[command.index("-r") + 1]), 60.0)
        self.info.update(fps=24.0, frames=1200, duration=20.0)
        command = self.command()
        self.assertEqual(float(command[command.index("-r") + 1]), 24.0)

    def test_missing_metadata_uses_finite_defaults(self):
        self.info.update(frames=None, duration=0, movie_duration=None, size=0, fps=None)
        command = self.command()
        self.assertTrue(math.isfinite(float(command[command.index("-r") + 1])))
        self.assertGreater(int(command[command.index("-b:v") + 1][:-1]), 0)

    def test_max_uses_reference_reencode(self):
        command = self.command("max")
        self.assertEqual(command[command.index("-c:v") + 1], "libx264")
        self.assertEqual(command[command.index("-bsf:v") + 1], app.REFERENCE_SEI_FILTER)
        self.assertEqual(command[command.index("-r") + 1], "59.357677")

    def test_movie_duration_versions_and_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "duration.mp4"
            for version, duration in [(0, 19552), (1, 19552), (1, (1 << 64) - 1)]:
                payload = (bytes([version, 0, 0, 0]) +
                           (struct.pack(">QQIQ", 0, 0, 1000, duration) if version
                            else struct.pack(">IIII", 0, 0, 1000, duration)))
                mvhd = struct.pack(">I4s", len(payload) + 8, b"mvhd") + payload
                file.write_bytes(struct.pack(">I4s", len(mvhd) + 8, b"moov") + mvhd)
                self.assertEqual(app.movie_duration(file), None if duration == (1 << 64) - 1 else 19.552)
            file.write_bytes(b"invalid")
            self.assertIsNone(app.movie_duration(file))


if __name__ == "__main__":
    unittest.main()
