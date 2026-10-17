[Русский](README.md) | **English**

# TikTok Prep Tool

Local video preparation for TikTok: ffmpeg encoding and MP4 container editing.
Python standard library, no cloud, no telemetry.

**by youpzdev** - [Telegram](https://t.me/youpzlabnsfw) | [TikTok](https://www.tiktok.com/@youpzdev)

The software is free. Terms of use: [non-commercial license](LICENSE).

## What has been verified

On 17 October 2026, the user confirmed successful Stealth publishing with ghost
audio samples. Local checks cover the container, video stream and preservation
of real audio samples. On 18 October 2026, the author confirmed a Max upload
retaining 4K and 120 FPS. This is the result of his check, not a guarantee
for every upload.

TikTok decides how to process uploaded video. Matching the reference metadata
does not guarantee resolution, frame rate or reach. Some settings of the other
encoder remain unknown; this tool does not claim to reproduce its entire output
byte for byte.

## Running it

Python 3 and ffmpeg are required. No Python packages need to be installed.

To install ffmpeg on Windows:

```
winget install Gyan.FFmpeg
```

The app looks for ffmpeg and ffprobe in PATH, the winget installation and a
`bin/` folder next to the app.

Open `start.bat` or run `py -3 app.py`. A browser opens at
`http://127.0.0.1:8765`. Add files or a folder, choose a mode and click
"Process videos". You can also drop files into the browser window.

If another app occupies the port, the server picks the next free one.
Launching again reuses the running instance.

## Modes

Default settings:

| Parameter | Stealth | Max |
|---|---|---|
| Dimensions | short side up to 1080, long side up to 1920 | short side up to 2160, long side up to 3840 |
| Frame rate | no higher than source or 60, may be fractional | no higher than source or 120, may be fractional |
| Video | always H.264 Main L5.2 | always H.264 Main L6.0 |
| Bitrate | based on input file size and duration | CRF14, 240 Mbit/s peak limit, slow |
| Audio when encoding | AAC LC, 48 kHz, stereo, 200 kbit/s | AAC LC, 48 kHz, stereo, 320 kbit/s |

Video is not upscaled. Missing audio is not created.

### Stealth

Frame rate is calculated by dividing video frame count by the format duration
reported by ffprobe, then capped at the source rate and the profile limit. If
the calculated reduction exceeds 5%, or the required data is unavailable, the
source rate is used with the same cap. The output may therefore be 59.357677 FPS
instead of 60. Video timestamps are stretched slightly for the fractional rate.

Target video bitrate is `input file size * 8 / mvhd duration`, rounded down to
kbit/s. If `mvhd` duration is unknown, ffprobe duration is used. When usable
input data is unavailable, a fallback calculation uses 0.232 bits per pixel.
By default, `maxrate` is twice the target and `bufsize` is three times the target.
These are encoder settings; the actual encoded bitrate may differ.

Encoding uses Main L5.2, the x264 refs=1 setting and up to three B-frames. The maximum
keyframe interval is about two seconds; scene changes can add earlier keyframes.
The x264 settings SEI is replaced with `evc0 v1.4.2.2-20260920` at keyframes.
The `compressorname` field contains `Lavc libx264`, and `btrt` boxes are retained.
The `©too` tag receives compact JSON with `libevc=0`, `trans_type=-2`, target
bitrate and maximum bitrate.

With the dummy audio samples option enabled:

- There is still one audio track. Nine dummy samples are added per real AAC
  sample, making the total sample count ten times higher.
- Each dummy sample is eight bytes, `0000000400000000`, with a one-tick duration.
  All dummy samples occupy one chunk after the MP4 boxes, outside `mdat`.
- `mdhd` and `tkhd` retain their real durations while the `stts` sum includes
  the dummy tail. Both tracks lose `edts`; version 1 `mvhd` is assigned an
  unknown duration.
- The empty `free` box before `mdat` is removed and chunk offsets are recalculated.
  Real video and audio bytes do not change during this step.

The dummy tail is not valid AAC audio and causes decoding errors. It is part of
an experimental container, so a clean video decode must not be presented as a
clean decode of the entire audio track. Real samples are checked separately.

When the option is off, or the source has no audio, no dummy tail is added,
durations stay ordinary and edit lists are retained. The selected Stealth
encoding profile and its metadata still apply.

### Max

Max always encodes video: H.264 Main L6.0, slow preset, refs=4, CRF14,
240M maxrate and 240M bufsize. Variable bitrate follows image complexity.
Limits are 2160 on the short side, 3840 on the long side, and 120 FPS.
Lower source resolution and frame rate are not increased. SEI and container
rules match Stealth.
Ghost samples use a single audio track without a clone. Encoding takes longer
and may produce a larger file. On 18 October 2026, the author confirmed a Max
upload retaining 4K/120. Results may differ for other uploads.

## Settings

Set environment variables before launching. The full set is in `app.py`.

| Variable | Purpose |
|---|---|
| `TT_MODE` | default mode: `stealth` or `max` |
| `TT_PORT` | starting port, 8765 by default |
| `TT_S_SHORT`, `TT_S_LONG`, `TT_S_FPS` | Stealth limits |
| `TT_S_MAXRATE`, `TT_S_BUFSIZE` | explicit rate limits instead of the 2x and 3x defaults |
| `TT_S_PRESET`, `TT_S_REFS`, `TT_S_LEVEL`, `TT_S_X264`, `TT_S_ABR` | Stealth encoder settings |
| `TT_M_CRF`, `TT_M_MAXRATE`, `TT_M_BUFSIZE` | Max encoding settings |
| `TT_GHOST` | default dummy sample multiplier, 10 |
| `TT_BRAND` | artist tag value |

## Output

Results are saved next to the source in `tiktok_ready/`, named
`<name>_tiktok.mp4`. Files sent through the browser are first copied to
`incoming/`, with results in `incoming/tiktok_ready/`.

Processing runs on your computer. The app does not publish video, send it to
external services or collect telemetry.

## Why the algorithm changed

An August 2026 test of the old method produced a successful 1080p60 publication,
but in September the user reported 480p30. A comparison with a newer successful
reference found Main L5.2, retained `btrt`, SEI and one inflated audio track
instead of a clone. That comparison does not support the old claim that every
successful file must have all SEI and `btrt` removed.

The cause of the earlier publication quality difference remains unknown. The user
has confirmed that the current Stealth method works. The updated Max needs its
own publishing comparison. Task details are in [project state](docs/project-state.md).

## License

Distributed under a [non-commercial license](LICENSE). Personal, educational and
research use is allowed. Selling, monetizing, use in commercial services, for
business or paying clients is prohibited without written permission from the
author.

For a commercial license: [Telegram](https://t.me/youpzlabnsfw).
Copyright (c) 2026 youpzdev. All rights reserved.
