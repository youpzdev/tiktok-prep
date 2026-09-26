import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import app


class StealthTimingTests(unittest.TestCase):
    def test_delayed_video_keeps_audio_alignment(self):
        if not app.FFMPEG or not app.FFPROBE:
            self.skipTest("ffmpeg and ffprobe required")
        with tempfile.TemporaryDirectory(prefix="stealth-timing-") as directory:
            source = str(Path(directory) / "delayed.mp4")
            output = str(Path(directory) / "encoded.mp4")
            subprocess.run([
                app.FFMPEG, "-v", "error", "-f", "lavfi", "-i",
                "testsrc2=size=64x64:rate=30:duration=2", "-f", "lavfi", "-i",
                "sine=sample_rate=48000:duration=3", "-vf", "setpts=PTS+1/TB",
                "-fps_mode", "passthrough", "-c:v", "libx264", "-c:a", "aac",
                "-y", source,
            ], check=True, capture_output=True)
            source_info = app.probe(source)
            source_times = self.frame_times(source)
            self.assertAlmostEqual(source_times[0], 1.0, places=5)
            subprocess.run(app.build_command(source, output, source_info, app.PROFILES["stealth"]),
                           check=True, capture_output=True)
            output_times = self.frame_times(output)
            frame_duration = 1 / source_info["fps"]
            self.assertAlmostEqual(output_times[-1], source_times[-1], delta=frame_duration)

    def test_variable_frame_rate_keeps_last_frame_time(self):
        if not app.FFMPEG or not app.FFPROBE:
            self.skipTest("ffmpeg and ffprobe required")
        with tempfile.TemporaryDirectory(prefix="stealth-timing-") as directory:
            source = str(Path(directory) / "variable.mp4")
            output = str(Path(directory) / "encoded.mp4")
            subprocess.run([
                app.FFMPEG, "-v", "error", "-f", "lavfi", "-i",
                "testsrc2=size=64x64:rate=10:duration=2", "-vf",
                "setpts='if(lt(N,10),N*0.05/TB,(0.5+(N-10)*0.15)/TB)'",
                "-fps_mode", "vfr", "-c:v", "libx264", "-y", source,
            ], check=True, capture_output=True)
            source_info = app.probe(source)
            source_times = self.frame_times(source)
            intervals = {round(b - a, 4) for a, b in zip(source_times, source_times[1:])}
            self.assertGreater(len(intervals), 1)
            subprocess.run(app.build_command(source, output, source_info, app.PROFILES["stealth"]),
                           check=True, capture_output=True)
            output_times = self.frame_times(output)
            frame_duration = 1 / source_info["fps"]
            self.assertAlmostEqual(output_times[-1], source_times[-1], delta=frame_duration)

    @staticmethod
    def frame_times(path):
        result = subprocess.run([
            app.FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", path,
        ], check=True, capture_output=True, text=True, encoding="utf-8")
        return [float(frame["best_effort_timestamp_time"])
                for frame in json.loads(result.stdout)["frames"]]


if __name__ == "__main__":
    unittest.main()
