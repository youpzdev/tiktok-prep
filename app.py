# TikTok Video Prep Tool - local server + ffmpeg pipeline
# Zero external Python dependencies (stdlib only).

import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
import webbrowser
from glob import glob
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import mp4mask

def _int_env(name, default):
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INCOMING_DIR = BASE_DIR / "incoming"   # files that arrive via browser drag&drop
OUTPUT_SUBDIR = "tiktok_ready"
PORT = _int_env("TT_PORT", 8765)
PORT_SCAN = 20

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".flv", ".ts", ".mts", ".m2ts", ".3gp", ".mpg", ".mpeg"}

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# ---------------------------------------------------------------- ffmpeg discovery

def find_binary(name: str):
    p = shutil.which(name)
    if p:
        return p
    candidates = []
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        candidates.append(os.path.join(local, "Microsoft", "WinGet", "Links", name + ".exe"))
        candidates += glob(os.path.join(local, "Microsoft", "WinGet", "Packages",
                                        "Gyan.FFmpeg*", "**", "bin", name + ".exe"), recursive=True)
    candidates += glob(str(BASE_DIR / "bin" / (name + ".exe")))
    candidates += glob(r"C:\ffmpeg\bin\%s.exe" % name)
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


FFMPEG = find_binary("ffmpeg")
FFPROBE = find_binary("ffprobe")


def refresh_binaries():
    global FFMPEG, FFPROBE
    if not FFMPEG:
        FFMPEG = find_binary("ffmpeg")
    if not FFPROBE:
        FFPROBE = find_binary("ffprobe")


def ffmpeg_version():
    if not FFMPEG:
        return None
    try:
        out = subprocess.run([FFMPEG, "-version"], capture_output=True, text=True,
                             creationflags=CREATE_NO_WINDOW, timeout=10).stdout
        m = re.search(r"ffmpeg version (\S+)", out)
        return m.group(1) if m else "unknown"
    except Exception:
        return None

# ---------------------------------------------------------------- probing


def probe(path: str):
    refresh_binaries()
    if not FFPROBE:
        return {"path": path, "error": "ffprobe не найден"}
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            creationflags=CREATE_NO_WINDOW, timeout=60)
        data = json.loads(out.stdout or "{}")
    except Exception as e:
        return {"path": path, "error": str(e)}

    fmt = data.get("format", {})
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        return {"path": path, "error": "видеодорожка не найдена"}

    def fps_of(stream):
        for key in ("avg_frame_rate", "r_frame_rate"):
            raw = stream.get(key, "")
            if raw and raw != "0/0":
                try:
                    num, den = raw.split("/")
                    if float(den) != 0:
                        return round(float(num) / float(den), 3)
                except ValueError:
                    pass
        return None

    try:
        size = os.path.getsize(path)
    except OSError:
        size = int(fmt.get("size", 0) or 0)

    def as_int(x):
        try:
            return int(x)
        except (TypeError, ValueError):
            return None

    return {
        "path": path,
        "name": os.path.basename(path),
        "size": size,
        "duration": float(fmt.get("duration", 0) or 0),
        "bitrate": int(fmt.get("bit_rate", 0) or 0),
        "width": v.get("width"),
        "height": v.get("height"),
        "fps": fps_of(v),
        "frames": as_int(v.get("nb_frames")),
        "vcodec": v.get("codec_name"),
        "pix_fmt": v.get("pix_fmt"),
        "acodec": a.get("codec_name") if a else None,
        "audio_hz": int(a.get("sample_rate", 0) or 0) if a else None,
    }

# ---------------------------------------------------------------- processing jobs

JOBS = {}
JOBS_LOCK = threading.Lock()

def _env(name, default, cast=str):
    raw = os.environ.get("TT_" + name)
    if raw is None or raw == "":
        return default
    try:
        return cast(raw)
    except ValueError:
        return default


# Апскейл запрещён в обоих режимах: кадры и пиксели не выдумываем.
SCALE_FLAGS = _env("SWS", "lanczos+accurate_rnd+full_chroma_int")
BRAND = _env("BRAND", "youpzdev")

# Два режима с разными целями - совместить их в одном профиле нельзя.
#
# stealth: выход должен быть неотличим от нативного экспорта мобильного редактора.
#   Эталон (MediaInfo, 2026-08-29): 1080×1200@60 CFR, AVC High L4.2, refs 4, CABAC,
#   16.1 Мбит/с при потолке 31 948 000, BT.709 в контейнере, AAC LC CBR ~200 кбит/с,
#   Encoded_Library "EditingVC1-v1.5.0.2", Encoded_Application - JSON редактора.
#   Отсюда потолок 1080/60 и уровень 4.2: 4K или fps выше 60 такому экспорту
#   не соответствуют ни одним полем и сами по себе выдают обработку.
#
# max: качество важнее незаметности - до 4K и fps без ограничения (до 300).
#   Уровень H.264 отдаётся энкодеру, маскировка метаданных остаётся, но
#   выдать такой файл за нативный экспорт невозможно.
PROFILES = {
    "stealth": {
        "label": "Stealth",
        "max_short": _env("S_SHORT", 1080, int),
        "max_long": _env("S_LONG", 1920, int),
        "max_fps": _env("S_FPS", 60.0, float),
        "crf": _env("S_CRF", 16, int),
        "bpp": _env("S_BPP", 0.207, float),
        "maxrate": _env("S_MAXRATE", "31948k"),
        "bufsize": _env("S_BUFSIZE", "63896k"),
        "preset": _env("S_PRESET", "slow"),
        "refs": _env("S_REFS", 4, int),
        "level": _env("S_LEVEL", "4.2"),
        "audio_bitrate": _env("S_ABR", "200k"),
        "reencode": "always",
        "footer": True,
    },
    "max": {
        "label": "Max",
        "max_short": _env("M_SHORT", 2160, int),
        "max_long": _env("M_LONG", 3840, int),
        "max_fps": _env("M_FPS", 0.0, float),      # 0 - не ограничивать
        "crf": _env("M_CRF", 14, int),
        "bpp": _env("M_BPP", 0.26, float),
        "maxrate": _env("M_MAXRATE", "120M"),
        "bufsize": _env("M_BUFSIZE", "240M"),
        "preset": _env("M_PRESET", "slow"),
        "refs": _env("M_REFS", 4, int),
        "level": _env("M_LEVEL", ""),              # пусто - уровень выбирает x264
        "audio_bitrate": _env("M_ABR", "320k"),
        "reencode": _env("M_REENCODE", "auto"),
        "footer": False,
    },
}
DEFAULT_MODE = _env("MODE", "stealth")
if DEFAULT_MODE not in PROFILES:
    DEFAULT_MODE = "stealth"

# Раздувание счётчика кадров: контейнер заявляет во столько раз больше кадров,
# из-за чего наблюдаемый битрейт выглядит низким и файл реже пережимают. Приём
# работал до тех пор, пока файл заодно был подписан "Patched by ..." и строкой
# настроек x264 - тогда ролики начали прятать. Подписей больше нет, так что
# рычаг вынесен отдельным переключателем и проверяется независимо.
INFLATE_DEFAULT = _env("INFLATE", 0, int)

# Строка энкодера, которая уходит в SEI вместо настроек x264, и шаблон ©too.
MASK_SEI = _env("SEI", "EditingVC1-v1.5.0.2")
MASK_MAXRATE_BPS = _env("MASK_MAXRATE", 31948000, int)

# 0xC0000005 access violation: флаки-сборки ffmpeg / Raptor Lake иногда падают
# посреди энкода - та же команда обычно проходит с ретрая.
CRASH_CODES = {3221225477, -1073741819}
ENCODE_ATTEMPTS = 3

LOG_FILE = BASE_DIR / "logs" / "ffmpeg.log"


def log_ffmpeg(cmd, returncode, stderr):
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] exit={returncode}\n")
            f.write("  cmd: " + subprocess.list2cmdline(cmd) + "\n")
            if stderr:
                f.write("  stderr: " + stderr.strip()[-2000:] + "\n")
    except OSError:
        pass


def _safe_rm(path):
    try:
        os.remove(path)
    except OSError:
        pass



COPY_VCODECS = {"h264"}
COPY_PIX_FMTS = {"yuv420p", "yuvj420p"}
COPY_ACODECS = {"aac"}


def can_copy_stream(info: dict, profile: dict):
    """Можно ли отдать видеопоток как есть.

    Реэнкод уже сжатого H.264 - это вторая генерация потерь поверх той, что
    TikTok добавит при заливке. Если поток и так вписывается в лимиты профиля,
    копирование сохраняет картинку побитово и занимает доли секунды.
    """
    if profile.get("reencode") != "auto":
        return False
    if info.get("vcodec") not in COPY_VCODECS:
        return False
    if info.get("pix_fmt") not in COPY_PIX_FMTS:
        return False
    w, h = info.get("width") or 0, info.get("height") or 0
    if not w or not h:
        return False
    if min(w, h) > profile["max_short"] or max(w, h) > profile["max_long"]:
        return False
    fps_cap = profile["max_fps"]
    if fps_cap and (info.get("fps") or 0) > fps_cap + 0.05:
        return False
    return True


def build_copy_command(src: str, dst: str, info: dict, audio_bitrate: str = "200k"):
    """Ремукс без реэнкода: видео остаётся байт в байт, меняется только контейнер."""
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
           "-progress", "pipe:1", "-nostats",
           "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy"]
    # Звук приводится к 48 кГц всегда: у нативного экспорта другой частоты не
    # бывает, а перекодирование дорожки стоит доли секунды и видео не трогает.
    if info.get("acodec") in COPY_ACODECS and info.get("audio_hz") == 48000:
        cmd += ["-c:a", "copy"]
    elif info.get("acodec"):
        cmd += ["-c:a", "aac", "-profile:a", "aac_low", "-ar", "48000",
                "-b:a", audio_bitrate, "-ac", "2"]
    cmd += ["-map_metadata", "-1", "-metadata", f"artist={BRAND}",
            "-movflags", "+faststart", dst]
    return cmd


def build_command(src: str, dst: str, info: dict, profile: dict):
    """Команда первого шага: копирование потока, если профиль это допускает,
    иначе полный реэнкод."""
    if can_copy_stream(info, profile):
        return build_copy_command(src, dst, info, profile["audio_bitrate"])
    return build_reencode_command(src, dst, info, profile)


def target_rate_args(info: dict, profile: dict):
    """Целевой битрейт вместо чистого CRF.

    CRF 16 на 1080p60 давал около 7.8 Мбит/с при 16.1 у эталона, то есть вдвое
    беднее картинку. Эталон держит примерно 0.207 бита на пиксель, поэтому
    битрейт считается от фактического разрешения и частоты кадров и растёт
    вместе с ними. CRF остаётся запасным вариантом, если размеры неизвестны.
    """
    bpp = profile.get("bpp") or 0
    w, h = info.get("width") or 0, info.get("height") or 0
    fps = info.get("fps") or 0
    factor = min(1.0, profile["max_short"] / min(w, h), profile["max_long"] / max(w, h)) if w and h else 1.0
    fps_cap = profile["max_fps"]
    out_fps = min(fps, fps_cap) if fps_cap and fps else fps
    if not (bpp and w and h and out_fps):
        return ["-crf", str(profile["crf"])]
    bits = bpp * (w * factor) * (h * factor) * out_fps
    return ["-b:v", f"{int(bits / 1000)}k"]


def build_reencode_command(src: str, dst: str, info: dict, profile: dict):
    """Реэнкод под выбранный профиль: вписывание в кадр без апскейла, x264 high,
    BT.709 в контейнере, AAC 48 кГц. Входные метаданные отбрасываются, тег
    автора ставится здесь, остальная маскировка - на втором шаге."""
    vf = []
    w, h = info.get("width") or 0, info.get("height") or 0
    if w and h:
        factor = min(1.0,
                     profile["max_short"] / min(w, h),
                     profile["max_long"] / max(w, h))
        if factor < 1.0:
            tw = round(w * factor / 2) * 2
            th = round(h * factor / 2) * 2
            vf.append(f"scale={tw}:{th}")
        elif w % 2 or h % 2:
            vf.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
    fps_cap = profile["max_fps"]
    if fps_cap and (info.get("fps") or 0) > fps_cap + 0.05:
        vf.append(f"fps={fps_cap:g}")

    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
           "-progress", "pipe:1", "-nostats",
           "-i", src, "-map", "0:v:0", "-map", "0:a:0?"]
    if vf:
        cmd += ["-vf", ",".join(vf), "-sws_flags", SCALE_FLAGS]
    cmd += ["-c:v", "libx264", "-profile:v", "high",
            "-preset", profile["preset"]]
    cmd += target_rate_args(info, profile)
    cmd += ["-maxrate", profile["maxrate"], "-bufsize", profile["bufsize"],
            "-refs", str(profile["refs"]),
            "-pix_fmt", "yuv420p", "-fps_mode", "cfr",
            # эталон помечает BT.709 в контейнере - без этого плеер/TikTok угадывает
            "-color_primaries", "bt709", "-color_trc", "bt709",
            "-colorspace", "bt709", "-color_range", "tv",
            "-c:a", "aac", "-profile:a", "aac_low", "-ar", "48000",
            "-b:a", profile["audio_bitrate"], "-ac", "2",
            "-map_metadata", "-1", "-metadata", f"artist={BRAND}"]
    if profile["level"]:
        cmd += ["-level", profile["level"]]
    cmd += ["-movflags", "+faststart", dst]
    return cmd


def process_job(job_id: str):
    job = JOBS[job_id]
    profile = PROFILES[job.get("mode", DEFAULT_MODE)]
    inflate = int(job.get("inflate", 0) or 0)
    for item in job["files"]:
        if job.get("cancelled"):
            item["status"] = "cancelled"
            continue
        src = item["src"]
        info = probe(src)
        if "error" in info:
            item["status"] = "error"
            item["message"] = info["error"]
            continue
        item["before"] = info

        out_dir = Path(src).parent / OUTPUT_SUBDIR
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = str(out_dir / (Path(src).stem + "_tiktok.mp4"))
        item["dst"] = dst
        item["status"] = "processing"

        tmp = str(out_dir / (Path(src).stem + f".enc.{uuid.uuid4().hex[:8]}.mp4"))
        duration = info.get("duration") or 0
        item["copied"] = can_copy_stream(info, profile)

        # Копирование потока годится не для любого h264: Annex-B без in-band
        # SPS/PPS и часть .ts/.avi ffmpeg отказывается класть в mp4. Такой отказ
        # не должен ронять файл - он откатывается на честный реэнкод.
        plans = [build_command(src, tmp, info, profile)]
        if item["copied"]:
            plans.append(build_reencode_command(src, tmp, info, profile))

        returncode, stderr, spawn_error, patch, mask_error = None, "", None, None, None
        for plan_index, cmd in enumerate(plans):
            if plan_index:
                item["copied"] = False
                log_ffmpeg(cmd, -1, "копирование потока не подошло, откат на реэнкод")
            returncode, stderr, spawn_error, patch, mask_error = None, "", None, None, None
            for attempt in range(1, ENCODE_ATTEMPTS + 1):
                item["attempt"] = attempt
                item["progress"] = 0.0
                try:
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                            text=True, encoding="utf-8", errors="replace",
                                            creationflags=CREATE_NO_WINDOW)
                except Exception as e:
                    spawn_error = str(e)
                    break
                job["proc"] = proc
                for line in proc.stdout:
                    if job.get("cancelled"):
                        proc.terminate()
                        break
                    line = line.strip()
                    if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                        try:
                            us = int(line.split("=")[1])
                            if duration > 0:
                                item["progress"] = min(0.95, (us / 1_000_000) / duration * 0.9)
                        except ValueError:
                            pass
                    elif line.startswith("speed="):
                        item["speed"] = line.split("=")[1].strip()
                stderr = proc.stderr.read() if proc.stderr else ""
                proc.wait()
                job["proc"] = None
                returncode = proc.returncode
                if returncode != 0:
                    log_ffmpeg(cmd, returncode, stderr)
                if job.get("cancelled") or returncode == 0 or returncode not in CRASH_CODES:
                    break
            if job.get("cancelled") or spawn_error is not None:
                break
            if returncode == 0:
                # маскировка входит в план: если она не смогла разобрать результат
                # копирования, честнее пережать, чем отдать файл с ошибкой
                item["progress"] = 0.97
                try:
                    patch = mp4mask.mask(
                        tmp, dst, sei_text=MASK_SEI,
                        too_value=mp4mask.encoder_json(MASK_MAXRATE_BPS,
                                                       random.randint(10 ** 8, 10 ** 9 - 1),
                                                       time.time()),
                        footer=profile.get("footer", False),
                        inflate=inflate)
                    break
                except Exception as e:
                    # mask() пишет через .part и переименовывает, так что готовый
                    # файл от прошлого прогона здесь цел - удалять dst нельзя.
                    log_ffmpeg(["mp4mask", tmp, dst], -1, str(e))
                    mask_error = str(e)
            _safe_rm(tmp)

        if job.get("cancelled"):
            item["status"] = "cancelled"
            _safe_rm(tmp)
            continue
        if spawn_error is not None:
            item["status"] = "error"
            item["message"] = spawn_error
            _safe_rm(tmp)
            continue
        if returncode != 0:
            item["status"] = "error"
            if returncode in CRASH_CODES:
                item["message"] = (f"ffmpeg аварийно завершился (access violation) {ENCODE_ATTEMPTS} раза. "
                                   "Подробности в logs/ffmpeg.log")
            else:
                item["message"] = (stderr or "").strip()[-400:] or f"ffmpeg exited {returncode}"
            _safe_rm(tmp)
            continue

        if patch is None:
            item["status"] = "error"
            item["message"] = f"маскировка контейнера: {mask_error}"
            _safe_rm(tmp)
            continue
        item["patch"] = patch
        if patch.get("encoder_left") or not patch.get("too_set"):
            item["warning"] = "mask_incomplete"
        _safe_rm(tmp)

        item["progress"] = 1.0
        item["after"] = probe(dst)
        item["status"] = "done"
    job["status"] = "cancelled" if job.get("cancelled") else "done"

# ---------------------------------------------------------------- file dialogs

DIALOG_SCRIPT = r"""
import sys, tkinter as tk
from tkinter import filedialog
root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
mode = sys.argv[1]
if mode == 'folder':
    p = filedialog.askdirectory(title='Выберите папку с видео')
    print(p or '')
else:
    ps = filedialog.askopenfilenames(title='Выберите видео', filetypes=[
        ('Видео', '*.mp4 *.mov *.mkv *.avi *.webm *.m4v *.wmv *.flv *.ts *.mts *.m2ts *.3gp *.mpg *.mpeg'),
        ('Все файлы', '*.*')])
    for p in ps: print(p)
"""


def native_dialog(mode: str):
    try:
        out = subprocess.run([sys.executable, "-c", DIALOG_SCRIPT, mode],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=600)
        return [line.strip() for line in out.stdout.splitlines() if line.strip()]
    except Exception:
        return []

# ---------------------------------------------------------------- HTTP server

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("X-App", SERVER_SIGNATURE)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    # ---------------- GET

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/status":
            refresh_binaries()
            return self.send_json({
                "app": SERVER_SIGNATURE,
                "ffmpeg": bool(FFMPEG), "ffprobe": bool(FFPROBE),
                "version": ffmpeg_version(), "ffmpeg_path": FFMPEG,
                "default_mode": DEFAULT_MODE,
                "inflate_default": INFLATE_DEFAULT,
                "modes": [{"id": k,
                           "label": v["label"],
                           "max_short": v["max_short"],
                           "max_long": v["max_long"],
                           "max_fps": v["max_fps"],
                           "bpp": v.get("bpp"),
                           "copies": v.get("reencode") == "auto"} for k, v in PROFILES.items()],
            })
        if path.startswith("/api/job/"):
            job_id = path.rsplit("/", 1)[1]
            job = JOBS.get(job_id)
            if not job:
                return self.send_json({"error": "job not found"}, 404)
            with JOBS_LOCK:
                files = [dict(f) for f in job["files"]]
            return self.send_json({"status": job["status"], "files": files})
        # static
        if path == "/":
            path = "/index.html"
        file = (STATIC_DIR / path.lstrip("/")).resolve()
        if not file.is_relative_to(STATIC_DIR) or not file.is_file():
            return self.send_json({"error": "not found"}, 404)
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(file.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---------------- POST

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/browse":
            data = self.read_json()
            mode = data.get("mode", "files")
            picked = native_dialog(mode)
            cancelled = not picked          # пустой выбор из диалога - это отмена,
            paths = picked                  # а не "в папке нет видео"
            if mode == "folder" and picked:
                folder = picked[0]
                paths = sorted(str(p) for p in Path(folder).iterdir()
                               if p.is_file() and p.suffix.lower() in VIDEO_EXTS)
            return self.send_json({"paths": paths, "cancelled": cancelled})

        if path == "/api/probe":
            data = self.read_json()
            return self.send_json({"files": [probe(p) for p in data.get("paths", [])]})

        if path == "/api/upload":
            name = urllib.parse.unquote(self.headers.get("X-Filename", "upload.mp4"))
            name = os.path.basename(name).replace("..", "_") or "upload.mp4"
            INCOMING_DIR.mkdir(parents=True, exist_ok=True)
            dst = INCOMING_DIR / name
            i = 1
            while dst.exists():
                dst = INCOMING_DIR / f"{Path(name).stem}_{i}{Path(name).suffix}"
                i += 1
            length = int(self.headers.get("Content-Length", 0) or 0)
            remaining = length
            with open(dst, "wb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
            return self.send_json({"path": str(dst)})

        if path == "/api/process":
            refresh_binaries()
            if not FFMPEG or not FFPROBE:
                return self.send_json({"error": "ffmpeg не найден"}, 400)
            data = self.read_json()
            paths = [p for p in data.get("paths", []) if os.path.isfile(p)]
            if not paths:
                return self.send_json({"error": "нет файлов"}, 400)
            mode = data.get("mode") or DEFAULT_MODE
            if mode not in PROFILES:
                return self.send_json({"error": f"неизвестный режим: {mode}"}, 400)
            try:
                inflate = max(0, min(30, int(data.get("inflate", INFLATE_DEFAULT))))
            except (TypeError, ValueError):
                inflate = INFLATE_DEFAULT
            job_id = uuid.uuid4().hex[:12]
            job = {
                "status": "running",
                "mode": mode,
                "inflate": inflate,
                "files": [{"src": p, "name": os.path.basename(p),
                           "status": "queued", "progress": 0.0} for p in paths],
            }
            with JOBS_LOCK:
                JOBS[job_id] = job
            threading.Thread(target=process_job, args=(job_id,), daemon=True).start()
            return self.send_json({"job": job_id})

        if path == "/api/cancel":
            data = self.read_json()
            job = JOBS.get(data.get("job", ""))
            if job:
                job["cancelled"] = True
                proc = job.get("proc")
                if proc:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
            return self.send_json({"ok": True})

        if path == "/api/reveal":
            data = self.read_json()
            target = data.get("path", "")
            if target and os.path.exists(target):
                folder = target if os.path.isdir(target) else os.path.dirname(target)
                try:
                    subprocess.Popen(["explorer", "/select,", target] if os.path.isfile(target)
                                     else ["explorer", folder])
                except Exception:
                    pass
                return self.send_json({"ok": True})
            return self.send_json({"error": "path not found"}, 404)

        return self.send_json({"error": "unknown endpoint"}, 404)

# ---------------------------------------------------------------- main


SERVER_SIGNATURE = "tiktok-prep-tool"


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


def our_server_on(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=1.0) as r:
            return r.headers.get("X-App") == SERVER_SIGNATURE
    except Exception:
        return False


def resolve_port():
    free = None
    for port in range(PORT, PORT + PORT_SCAN):
        if not port_in_use(port):
            if free is None:
                free = port
            continue
        if our_server_on(port):
            return port, True
    if free is None:
        raise SystemExit(f"Не нашёл свободный порт в диапазоне {PORT}-{PORT + PORT_SCAN - 1}")
    return free, False


def main():
    port, running = resolve_port()
    if running:
        url = f"http://127.0.0.1:{port}/"
        print(f"Сервер уже запущен - открываю {url}")
        webbrowser.open(url)
        return
    if port != PORT:
        print(f"Порт {PORT} занят чужим процессом - беру {port}")
    url = f"http://127.0.0.1:{port}/"
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"TikTok Video Prep Tool - {url}")
    print(f"ffmpeg: {FFMPEG or 'НЕ НАЙДЕН'}")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
