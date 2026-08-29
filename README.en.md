[Русский](README.md) · **English**

# TikTok Prep Tool

Local video prep for TikTok: compression plus MP4 container masking.
Quality survives, and the file does not look processed.

Python stdlib + ffmpeg · no cloud, no telemetry

**by youpzdev** - [Telegram](https://t.me/youpzlabnsfw) · [TikTok](https://www.tiktok.com/@youpzdev)

> [!IMPORTANT]
> **This software is free. If anyone charges you for it, you have been scammed.**

---

## The problem

I run a TikTok account and post edits on a specific topic. And I ran into the
dumbest possible problem: **TikTok destroys quality**. Not compresses, destroys.
A 4K/60fps source came out as 720p/30fps at best.

## Looking for a fix

### Attempt 1, upload through TikTok Studio

The first and dumbest idea. A couple of tries later it was clear nothing changes.
The nasty part: a video uploaded from your device stays **in your cache**, so it
looks sharp to you and mangled to everyone else.

I also looked at ready-made tools. Some paid, some free but sketchy: upload your
video to a random site, get no explanation, and receive a patched file back with
the size cut down by compression.

### Attempt 2, my own converter

I wrote a converter that lowered the bitrate, changed the codec and downscaled to
Full HD: **86 MB to 15 MB**. The bitrate changed too. Surprisingly **it did not
help**, the published video still looked awful.

### Attempt 3, frame count inflation

Digging through the metadata of patched videos, I noticed a pattern: the source
had 1073 frames, while the file claimed ten times more. I rebuilt the tool around
that scheme, and quality-wise it worked.

Then a different problem showed up: **TikTok started hiding those videos**. The
file is valid, it plays, it uploads, and it gets no reach. An inflated frame count
produces something a normal export never has: the declared track duration does not
match the actual content. On top of that, ffmpeg signs its own work.

### Attempt 4, masking as a native export

I took the MediaInfo of a real video that performed fine and compared it with my
output field by field. The difference was in the signatures, not in the picture:

| | Native export | My output (before) |
|---|---|---|
| Encoded_Library | `EditingVC1-v1.5.0.2` | `x264 - core 164 ... options: cabac=1 ref=4 crf=...` |
| Encoded_Application | editor JSON | `Lavf61.7.100` |
| Tags | Performer only | `Patched by method.youpzdev - <id>` |
| Frame count | matches duration | inflated tenfold |

The file was literally signed with the word Patched and the full encoder settings
string. Those fields are cleaned now.

An important caveat: the reference is a file **downloaded from TikTok**, meaning
it already went through their transcoder (`te_is_reencode: 1` in its metadata is
their own marker). Matching it means "we look like their output", not "we will be
accepted without re-compression". Those are two different properties.

### Attempt 5, separating the two levers

Frame inflation and the giveaway signatures always shipped together, so there was
no way to tell which one caused the hiding. They are separate now: signatures are
always cleaned, and inflation is a toggle. The combination "inflation plus clean
signatures" had never been tested.

## Why it works (a guess)

I do not know the real reason and will not pretend otherwise, this is not my
stack. My guess: reading metadata is cheaper for the platform than analysing the
picture. An x264 settings string in SEI, `Lavf` in the `©too` tag and a frame
count that does not add up are markers a regular user never produces. With those
gone, the file passes as an ordinary editor export.

## What the tool does

**Step 1, compression.** Downscale to fit without upscaling, x264 high, BT.709 in
the container, AAC 48 kHz audio. Incoming metadata is dropped entirely.

**Step 2, container masking** ([mp4mask.py](mp4mask.py)), editing boxes and the
bitstream without re-encoding:

1. **Encoder SEI.** The stream carries a `user_data_unregistered` payload with the
   full x264 settings string. It is overwritten with `filler_payload` of the same
   length: a native export has no `user_data_unregistered` at all, so the
   signature is removed rather than replaced. NAL length is preserved, so the
   `stsz` and `stco` tables stay valid.
2. **compressorname.** The encoder name goes into the 32-byte field in `stsd`.
   That is where MediaInfo reads `Encoded_Library` from, not from SEI.
3. **The `©too` tag.** ffmpeg always writes `Lavf<version>` there and ignores
   `-metadata encoder=`, so the tag is rewritten afterwards.
4. **File structure.** The empty `free` box ffmpeg leaves after faststart is
   dropped, and a block the size of `moov` is appended to the tail: that is the
   box order a native export has. Chunk offsets in every track are recalculated
   from the actual `mdat` shift.

Decoded frames after masking are bit-for-bit identical to the original, verified
by comparing the MD5 of every frame before and after.

## Frame count inflation

A separate toggle in the UI. Dummy samples are appended to the video track's
`stsz`, `stts`, `stsc` and `stco` tables: the container starts claiming ten times
more frames, `stts` reports 172 seconds instead of 17, and the observed bitrate
drops from 16.2 to 1.63 Mbps. `mvhd` and `mdhd` stay honest, real samples and
`mdat` are untouched, and the dummy chunks point past the end of the file.

The idea is that an estimator computing bitrate as size over duration sees a long
and thin video and does not bother re-compressing it. This used to work before
the algorithm changed, so whether to enable it is a question to verify on your own
account. The cost: players complain about the empty samples, and playback outside
TikTok may be broken.

## Modes

| | Stealth | Max |
|---|---|---|
| Resolution | up to 1080x1920 | up to 3840x2160 |
| Frame rate | up to 60 | uncapped |
| Bits per pixel | 0.207 | 0.26 |
| H.264 level | 4.2 | encoder picks |

Bitrate is driven by bits per pixel rather than CRF: CRF 16 produced about
7.8 Mbps at 1080p60 against 16.1 in the reference, half the picture. The
reference holds roughly 0.207 bits per pixel, so the bitrate is derived from the
actual resolution and frame rate and scales with them.

**Stealth** matches the parameters of a native export. The 1080 and 60 fps caps
are not arbitrary: no mobile editor outputs 4K or 120+ fps, so such a file gives
the processing away by itself.

**Max** is for when quality matters more than blending in. If the stream is
already H.264 8-bit and fits the limits, it is **copied without re-encoding**: the
picture stays bit-for-bit identical and the job takes a fraction of a second.
Re-encoding kicks in only when the video has to be downscaled or converted from
another format. The reason is simple: re-encoding finished H.264 is a second
generation of loss on top of what TikTok adds on upload. Metadata masking still
applies, but a file like this cannot pass as a native export.

Every parameter can be overridden with environment variables, no code edits
needed: `TT_MODE`, `TT_S_CRF`, `TT_M_CRF`, `TT_S_MAXRATE`, `TT_BRAND`, `TT_SEI`,
`TT_PORT` and the rest of the `PROFILES` block in `app.py`.

## Running it

Double-click `start.bat` (or run `python app.py`) and the page opens at
`http://127.0.0.1:8765`. **Drop a video, pick a mode, hit start.**

If the port is taken by another process, the server picks the next free one and
says so in the console. An already running instance is reused instead of starting
a second one.

**ffmpeg** is required, once:

```
winget install Gyan.FFmpeg
```

The app finds ffmpeg in winget, PATH or a local `bin/` folder on its own. There
are no Python dependencies at all, only the standard library.

## Output

Files land next to the source in a `tiktok_ready/` subfolder as
`<name>_tiktok.mp4`. Files dropped into the browser are copied to `incoming/`,
with results in `incoming/tiktok_ready/`.

All processing is **local**: nothing is uploaded anywhere, no telemetry, no
external servers.

---

> This is an arms race. The trick works today, but TikTok keeps tuning its
> algorithms, and nobody can promise it lasts forever.

## Keywords and tags

TikTok Prep Tool is a free local video optimizer for preparing and uploading
clips to TikTok without losing quality. Handles MP4, 4K, Full HD and vertical
video, edits, clips, Shorts and Reels through FFmpeg.

`TikTok` · `Tik Tok` · `TikTok video optimizer` · `TikTok quality` ·
`TikTok upload quality` · `TikTok video quality` · `keep video quality` ·
`TikTok 4K` · `TikTok 60 FPS` · `TikTok Full HD` · `1080p TikTok` ·
`vertical video` · `video prep for TikTok` · `video optimization` ·
`video compression` · `lossless-looking compression` · `video compressor` ·
`video transcoder` · `MP4 optimizer` · `MP4 metadata` · `FFmpeg` ·
`Python video tool` · `local video processing` · `no cloud` · `TikTok edits` ·
`TikTok clips` · `TikTok content creator` · `TikTok uploader` ·
`TikTok compression fix` · `TikTok quality fix` · `TikTok duplicate content` ·
`unique video` · `video fingerprint` · `YouTube Shorts` · `Instagram Reels`

## License

Distributed under a [non-commercial license](LICENSE). Personal, educational and
research use is allowed. Selling, monetizing, use in commercial services, for
business or paying clients is prohibited without written permission from the
author.

For a commercial license: [Telegram](https://t.me/youpzlabnsfw).
Copyright (c) 2026 youpzdev. All rights reserved.
