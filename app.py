# TikTok Video Prep Tool — local server + ffmpeg pipeline
# Zero external Python dependencies (stdlib only).

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
import webbrowser
from glob import glob
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import mp4inflate

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INCOMING_DIR = BASE_DIR / "incoming"   # files that arrive via browser drag&drop
OUTPUT_SUBDIR = "tiktok_ready"
PORT = 8765

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
                             creationflags=CREATE_NO_WINDOW).stdout
        m = re.search(r"ffmpeg version (\S+)", out)
        return m.group(1) if m else "unknown"
    except Exception:
        return None

# ---------------------------------------------------------------- probing


def probe(path: str):
    refresh_binaries()
    if not FFPROBE:
        return {"error": "ffprobe not found"}
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            creationflags=CREATE_NO_WINDOW, timeout=60)
        data = json.loads(out.stdout or "{}")
    except Exception as e:
        return {"error": str(e)}

    fmt = data.get("format", {})
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        return {"error": "no video stream"}

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
        "acodec": a.get("codec_name") if a else None,
        "audio_hz": int(a.get("sample_rate", 0) or 0) if a else None,
    }

# ---------------------------------------------------------------- processing jobs

JOBS = {}
JOBS_LOCK = threading.Lock()

# Во сколько раз добавить фиктивных кадров к реальным (itzcrih ≈ ×9 → ×10 всего).
FRAME_MULTIPLIER = 9

# Параметры компрессии (совпадают с itzcrih: x264 high/CRF22, VBV 15 Мбит/с).
CRF = 22
MAXRATE = 15            # Мбит/с (vbv_maxrate/vbv_bufsize)
PRESET = "medium"
AUDIO_BITRATE = "320k"  # itzcrih перекодирует аудио в AAC 48 кГц ~320 кбит/с

# Брендинг-теги (переписываются на выходе, меняют фингерпринт).
BRAND = "youpzdev"
BRAND_TAGS = {
    "artist": BRAND,
    "album": f"{BRAND} Method",
    "composer": BRAND,
    "grouping": f"method.{BRAND}",
}

# 0xC0000005 access violation: флаки-сборки ffmpeg / Raptor Lake иногда падают
# посреди энкода — та же команда обычно проходит с ретрая.
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


def _patch_id():
    """ID вида <unix_ts>_<8 hex> — как у itzcrih (1784278661_2661d735)."""
    return f"{int(time.time())}_{uuid.uuid4().hex[:8]}"


def build_command(src: str, dst: str, info: dict, uid: str):
    """Компрессия без заметной потери качества: даунскейл во вписывание в кадр
    TikTok + x264 CRF 22 (VBV 15 Мбит/с) + AAC 48 кГц. Метаданные обнуляются и
    переписываются под брендинг."""
    vf = []
    w, h = info.get("width") or 0, info.get("height") or 0
    if w and h:
        # fit: короткая сторона ≤1080, длинная ≤1920 (2160×2160 → 1080×1080)
        factor = min(1.0, 1080 / min(w, h), 1920 / max(w, h))
        if factor < 1.0:
            tw = round(w * factor / 2) * 2
            th = round(h * factor / 2) * 2
            vf.append(f"scale={tw}:{th}")
        elif w % 2 or h % 2:
            vf.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
    if (info.get("fps") or 0) > 60.05:
        vf.append("fps=60")

    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
           "-progress", "pipe:1", "-nostats",
           "-i", src, "-map", "0:v:0", "-map", "0:a:0?"]
    if vf:
        cmd += ["-vf", ",".join(vf)]
    cmd += ["-c:v", "libx264", "-profile:v", "high", "-preset", PRESET, "-crf", str(CRF),
            "-maxrate", f"{MAXRATE}M", "-bufsize", f"{MAXRATE}M", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "48000", "-b:a", AUDIO_BITRATE, "-ac", "2",
            "-map_metadata", "-1"]
    for k, v in BRAND_TAGS.items():
        cmd += ["-metadata", f"{k}={v}"]
    cmd += ["-metadata", f"copyright={BRAND} - {uid}",
            "-metadata", f"comment=Patched by method.{BRAND} - {uid}"]
    cmd += ["-movflags", "+faststart", dst]
    return cmd


def process_job(job_id: str):
    job = JOBS[job_id]
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

        uid = _patch_id()
        tmp = str(out_dir / (Path(src).stem + f".enc.{uuid.uuid4().hex[:8]}.mp4"))
        duration = info.get("duration") or 0
        cmd = build_command(src, tmp, info, uid)

        # --- шаг 1: компрессия (реэнкод) с прогрессом и ретраем на краш ffmpeg
        returncode, stderr, spawn_error = None, "", None
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

        if job.get("cancelled"):
            item["status"] = "cancelled"
            _safe_rm(tmp)
            continue
        if spawn_error is not None:
            item["status"] = "error"
            item["message"] = spawn_error
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

        # --- шаг 2: патч контейнера (раздувание кадров + обнуление compressorname)
        item["progress"] = 0.97
        try:
            stats = mp4inflate.inflate(tmp, dst, FRAME_MULTIPLIER)
            item["patch"] = stats
        except Exception as e:
            log_ffmpeg(["mp4inflate", tmp, dst], -1, str(e))
            item["status"] = "error"
            item["message"] = f"патч контейнера: {e}"
            _safe_rm(tmp)
            _safe_rm(dst)
            continue
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
                "ffmpeg": bool(FFMPEG), "ffprobe": bool(FFPROBE),
                "version": ffmpeg_version(), "ffmpeg_path": FFMPEG,
            })
        if path.startswith("/api/job/"):
            job_id = path.rsplit("/", 1)[1]
            job = JOBS.get(job_id)
            if not job:
                return self.send_json({"error": "job not found"}, 404)
            return self.send_json({
                "status": job["status"],
                "files": [{k: v for k, v in f.items() if k != "proc"} for f in job["files"]],
            })
        # static
        if path == "/":
            path = "/index.html"
        file = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(file).startswith(str(STATIC_DIR)) or not file.is_file():
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
            paths = native_dialog(mode)
            if mode == "folder" and paths:
                folder = paths[0]
                paths = sorted(str(p) for p in Path(folder).iterdir()
                               if p.is_file() and p.suffix.lower() in VIDEO_EXTS)
            return self.send_json({"paths": paths})

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
            job_id = uuid.uuid4().hex[:12]
            job = {
                "status": "running",
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


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    url = f"http://127.0.0.1:{PORT}/"
    if port_in_use(PORT):
        print(f"Сервер уже запущен — открываю {url}")
        webbrowser.open(url)
        return
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"TikTok Video Prep Tool — {url}")
    print(f"ffmpeg: {FFMPEG or 'НЕ НАЙДЕН'}")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
