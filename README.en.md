[Русский](README.md) · **English**

# TikTok Prep Tool

Local video prep for TikTok: light compression + MP4 container patch.
Quality survives, and every file is unique for duplicate-content detection.

Python stdlib + ffmpeg · no cloud, no telemetry

**by youpzdev** — [Telegram](https://t.me/youpzlabnsfw) · [TikTok](https://www.tiktok.com/@youpzdev)

---

## 💊 The problem

I run a TikTok account posting edits on a certain topic. And I ran into the
dumbest possible problem — **TikTok absolutely destroys quality**. It doesn't
just compress it, it eats it. A 4K/60fps source came out as 720p/30fps at best.

## 🔍 Looking for a fix

### Attempt 1 — upload via TikTok Studio

The dumbest solution that came to mind first. After a couple of tries I realised
it changes nothing. And the nastiest part: when you upload from your own device,
the video stays **in your cache** — it looks crisp to you and like garbage to
everyone else. A nice little trap.

I googled for ready-made solutions — there are paid ones and free ones, but all
sketchy: you upload your video to some random site, nobody explains anything, and
after a wait it hands you back a patched file. The size drops a lot thanks to
compression.

### Attempt 2 — my own converter

I wrote a converter that lowered the bitrate, changed the codec and downgraded
the video to FullHD: from **86 MB down to 15 MB**. The bitrate changed too. But
surprisingly, **it didn't help** — after publishing, the video still looked like
garbage.

### Attempt 3 — patching the metadata ✅

I started digging through the metadata of patched videos and noticed an
interesting pattern. Say the source video has **1073 frames** — but the file
claims there are **10× more**. That was the piece I had been missing.

So I reworked my tool: the app strips every marker, gets around the repeat-upload
detection, and writes in its own tag with a unique number so that every video is
one of a kind. And, drum roll... **it worked.**

## 🤔 Why it works (a guess)

I don't know the exact reason and I won't claim anything — this isn't my stack at
all. But here's my guess.

TikTok seems to decide whether a video needs compressing **based on bitrate**:

| | What TikTok sees | Reaction |
|---|---|---|
| **Without the patch** | 16 MB ÷ 18 sec ≈ **7.5 Mbps** | "too fat" → compresses immediately |
| **With the patch** | 16 MB ÷ "178 sec" ≈ **0.7 Mbps** | "already trash" → leaves it alone |

Because of the inflated frame counter, the file pretends to be long and skinny.
The algorithm decides the video is already low quality and **doesn't touch it**.
Meanwhile the real 1080p sits inside and reaches the feed almost untouched.

## ⚙️ What the tool does

**Step 1 — compression.** Downscale to fit the TikTok frame (short side ≤1080,
long side ≤1920; 2160×2160 → 1080×1080) + x264 high / preset medium / CRF 22 /
VBV 15 Mbps + AAC 48 kHz audio. Metadata is wiped and rewritten with branding and
a unique ID. **~89 MB → ~16 MB.**

**Step 2 — container patch** ([mp4inflate.py](mp4inflate.py)) — editing the MP4
boxes directly, with no re-encoding:

1. **Frame count inflation** — ×9 dummy samples of size 8 are appended to `stsz`,
   and an entry `(9657, 256)` to `stts`. The container now reports ×10 frames.
2. **Dummy chunks** — one chunk per dummy sample is added to `stco` (all pointing
   at the trailing `free` box), and `stsc` gets an entry `(real_chunks+1, 1, 1)`.
   `mdat` doesn't grow at all, and the real chunk offsets are consistently shifted
   by however much `moov` grew.
3. **Fingerprint wipe** — the 32-byte `compressorname` field in `stsd` is zeroed,
   and a unique ID of the form `<timestamp>_<hex>` goes into the tags — so no two
   outputs are ever identical, even from the same source.

Everything is exposed as constants at the top of `app.py`: `FRAME_MULTIPLIER`,
`CRF`, `MAXRATE`, `PRESET`, `AUDIO_BITRATE`, `BRAND`.

## 🚀 Running it

Double-click `start.bat` (or run `python app.py`) — it opens
`http://127.0.0.1:8765`. **Drop a video → hit START → grab the result.**

You need **ffmpeg** (one-time install):

```
winget install Gyan.FFmpeg
```

The app finds ffmpeg on its own via winget, PATH, or a `bin/` folder next to it.
There are no Python dependencies at all — standard library only.

## 📦 Output

Files land next to the source in a `tiktok_ready/` subfolder, named
`<name>_tiktok.mp4`. Files dropped into the browser are copied to `incoming/`,
with results in `incoming/tiktok_ready/`.

All processing is **local**: nothing is uploaded anywhere, no telemetry, no
external servers.

---

> ⚠️ This is an arms race. The trick works today, but TikTok keeps tuning its
> algorithms — nobody can promise it lasts forever.

## 📄 License

This project is distributed under the [MIT License](LICENSE). Copyright © 2026
youpzdev.
