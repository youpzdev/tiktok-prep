from pathlib import Path
import subprocess
import tempfile
import unittest

import app


class MaxLevelTests(unittest.TestCase):
    def test_real_4k120_obeys_declared_h264_level(self):
        with tempfile.TemporaryDirectory(prefix="max-level-") as directory:
            source = Path(directory) / "source.mp4"
            output = Path(directory) / "encoded.mp4"
            generated = subprocess.run([
                app.FFMPEG, "-v", "error", "-f", "lavfi", "-i",
                "testsrc2=size=3840x2160:rate=120:duration=0.05",
                "-f", "lavfi", "-i", "sine=sample_rate=48000:duration=0.05",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10",
                "-c:a", "aac", "-y", str(source)
            ], capture_output=True, text=True, encoding="utf-8", errors="replace")
            self.assertEqual(generated.returncode, 0, generated.stderr)
            command = app.build_command(str(source), str(output), app.probe(str(source)),
                                        app.PROFILES["max"])
            command[command.index("-loglevel") + 1] = "warning"
            encoded = subprocess.run(command, capture_output=True, text=True,
                                     encoding="utf-8", errors="replace")
            self.assertEqual(encoded.returncode, 0, encoded.stderr)
            self.assertNotIn("level limit", encoded.stderr.lower(),
                             "Max exceeds its declared H.264 level: " + encoded.stderr)
            info = app.probe(str(output))
            self.assertEqual((info["width"], info["height"], info["fps"], info["frames"]),
                             (3840, 2160, 120.0, 6))
            self.assertEqual(info["acodec"], "aac")


if __name__ == "__main__":
    unittest.main()
