/* TIKTOK PREP — frontend logic */
"use strict";

const $ = (s) => document.querySelector(s);

const state = {
  queue: [],          // {path, name, info, status, progress, before, after, dst, message, patch}
  job: null,
  running: false,
};

/* ---------------- helpers ---------------- */

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " ГБ";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " МБ";
  return Math.round(bytes / 1e3) + " КБ";
}
function fmtBitrate(bps) {
  return bps ? (bps / 1e6).toFixed(1) + " Мбит/с" : "—";
}
function fmtRes(f) {
  return f && f.width ? `${f.width}×${f.height}` : "—";
}
function fmtFps(f) {
  return f && f.fps ? Math.round(f.fps) + "fps" : "";
}

async function api(path, body) {
  const res = await fetch(path, body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {});
  return res.json();
}

let toastEl;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ---------------- engine status ---------------- */

async function checkEngine() {
  const el = $("#engine"), txt = $("#engine-text");
  try {
    const s = await api("/api/status");
    if (s.ffmpeg && s.ffprobe) {
      el.className = "engine ok";
      txt.textContent = "FFMPEG " + ((s.version || "READY").split("-")[0]);
      $("#foot-engine").textContent = (s.ffmpeg_path || "").toUpperCase().slice(0, 60);
      return true;
    }
    el.className = "engine bad";
    txt.textContent = "FFMPEG НЕ НАЙДЕН";
    toast("ffmpeg не найден — установите: winget install Gyan.FFmpeg");
  } catch {
    el.className = "engine bad";
    txt.textContent = "СЕРВЕР ОФЛАЙН";
  }
  return false;
}

/* ---------------- queue ---------------- */

function addPaths(paths) {
  const fresh = paths.filter((p) => p && !state.queue.some((q) => q.path === p));
  if (!fresh.length) return;
  for (const p of fresh) {
    state.queue.push({ path: p, name: p.split(/[\\/]/).pop(), status: "queued", progress: 0 });
  }
  render();
  api("/api/probe", { paths: fresh }).then((r) => {
    for (const info of r.files || []) {
      const item = state.queue.find((q) => q.path === info.path);
      if (!item) continue;
      if (info.error) { item.status = "error"; item.message = info.error; }
      else item.info = info;
    }
    const first = state.queue.find((q) => q.info);
    if (first) $("#tag-src").textContent =
      `${fmtRes(first.info)} / ${fmtFps(first.info).toUpperCase() || "?"}`;
    render();
  });
}

const STATUS_RU = {
  queued: "в очереди", probing: "анализ", processing: "патч",
  done: "готово", error: "ошибка", cancelled: "отменено", uploading: "загрузка",
};

function fmtFrames(n) {
  if (!n && n !== 0) return "—";
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K" : String(n);
}

function cardHTML(item, idx) {
  const info = item.before || item.info;
  const meta = info ? `${fmtRes(info)} · ${fmtFps(info)} · ${fmtSize(info.size)}` : "…";
  let stats = "";
  if (item.status === "done" && item.after) {
    const b = item.before, a = item.after;
    const rf = (item.patch && item.patch.real_frames) || b.frames;
    const tf = (item.patch && item.patch.total_frames) || a.frames;
    const mult = rf ? Math.round(tf / rf) : 0;
    stats = `<div class="qstats">
        <span><b>${fmtFrames(rf)}</b> кадров · ${fmtSize(b.size)}</span>
        <span class="to">→</span>
        <span><b>${fmtFrames(tf)}</b> кадров · ${fmtSize(a.size)}</span>
        <button class="qreveal" data-reveal="${idx}">показать в папке</button>
        <span class="qsave">×${mult}</span>
      </div>`;
  } else if (item.status === "error") {
    stats = `<div class="qerr">${(item.message || "ошибка").replace(/</g, "&lt;")}</div>`;
  } else if (item.status === "processing" && item.speed) {
    stats = `<div class="qstats"><span>скорость <b>${item.speed}</b></span></div>`;
  }
  const pct = Math.round((item.progress || 0) * 100);
  return `<div class="glass qcard ${item.status}" data-i="${idx}">
      <div class="qrow">
        <div class="qname" title="${item.path}">${item.name}</div>
        <span class="qmeta">${meta}</span>
        <span class="qstatus">${(STATUS_RU[item.status] || item.status) + (item.status === "processing" && item.attempt > 1 ? " · ретрай " + item.attempt : "")}</span>
        ${state.running ? "" : `<button class="qx" data-x="${idx}" title="Убрать">×</button>`}
      </div>
      <div class="qbar"><div class="qbar-fill" style="width:${item.status === "done" ? 100 : pct}%"></div></div>
      ${stats}
    </div>`;
}

function render() {
  const wrap = $("#queue-wrap");
  wrap.hidden = state.queue.length === 0;
  $("#queue-count").textContent = state.queue.length;
  $("#queue").innerHTML = state.queue.map(cardHTML).join("");
  $("#btn-start").disabled = state.running || !state.queue.some((q) => q.status === "queued");
  $("#btn-start").innerHTML = state.running
    ? '<span class="btn-sheen"></span>ОБРАБОТКА…'
    : '<span class="btn-sheen"></span>START&nbsp;PROCESSING';
  $("#btn-clear").textContent = state.running ? "Отменить" : "Очистить";
  attachGlassSheen();
  renderSummary();
}

function renderSummary() {
  const done = state.queue.filter((q) => q.status === "done" && q.after);
  const el = $("#summary");
  el.hidden = done.length === 0;
  if (!done.length) return;
  const framesOf = (q, key) =>
    (q.patch && q.patch[key === "before" ? "real_frames" : "total_frames"]) ||
    (q[key] && q[key].frames) || 0;
  const before = done.reduce((s, q) => s + framesOf(q, "before"), 0);
  const after = done.reduce((s, q) => s + framesOf(q, "after"), 0);
  $("#sum-count").textContent = done.length;
  $("#sum-before").textContent = fmtFrames(before);
  $("#sum-after").textContent = fmtFrames(after);
  $("#sum-saved").textContent = before ? "×" + Math.round(after / before) : "—";
}

/* ---------------- processing ---------------- */

async function start() {
  const paths = state.queue.filter((q) => q.status === "queued").map((q) => q.path);
  if (!paths.length) return;
  if (!(await checkEngine())) return;
  const r = await api("/api/process", { paths });
  if (r.error) { toast(r.error); return; }
  state.job = r.job;
  state.running = true;
  document.querySelector(".stage-v").classList.add("rush");
  render();
  poll();
}

async function poll() {
  if (!state.job) return;
  let job;
  try { job = await api("/api/job/" + state.job); }
  catch { setTimeout(poll, 1200); return; }
  if (job.files) {
    for (const f of job.files) {
      const item = state.queue.find((q) => q.path === f.src);
      if (item) Object.assign(item, {
        status: f.status, progress: f.progress, before: f.before,
        after: f.after, dst: f.dst, message: f.message, patch: f.patch,
      });
    }
  }
  render();
  if (job.status === "running") { setTimeout(poll, 500); return; }
  state.running = false;
  state.job = null;
  document.querySelector(".stage-v").classList.remove("rush");
  render();
  const done = state.queue.filter((q) => q.status === "done").length;
  toast(done ? `Готово: ${done} файл(ов) → папка tiktok_ready` : "Обработка завершена");
}

async function clearOrCancel() {
  if (state.running) {
    await api("/api/cancel", { job: state.job });
    toast("Отмена…");
  } else {
    state.queue = [];
    render();
  }
}

/* ---------------- pick / drop ---------------- */

async function browse(mode, btn) {
  btn.disabled = true;
  try {
    const r = await api("/api/browse", { mode });
    if (r.paths && r.paths.length) addPaths(r.paths);
    else if (mode === "folder" && r.paths) toast("В папке нет видеофайлов");
  } finally { btn.disabled = false; }
}

function uploadFiles(files) {
  const list = [...files].filter((f) => /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|ts|mts|m2ts|3gp|mpe?g)$/i.test(f.name));
  if (!list.length) { toast("Нет подходящих видеофайлов"); return; }
  const box = $("#dz-upload"), fill = $("#dz-upload-fill"), txt = $("#dz-upload-text");
  box.hidden = false;
  let i = 0;
  const next = () => {
    if (i >= list.length) { box.hidden = true; return; }
    const file = list[i++];
    txt.textContent = `ЗАГРУЗКА ${i}/${list.length} — ${file.name}`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) fill.style.width = (e.loaded / e.total) * 100 + "%";
    };
    xhr.onload = () => {
      try { addPaths([JSON.parse(xhr.responseText).path]); } catch {}
      fill.style.width = "0%";
      next();
    };
    xhr.onerror = () => { toast("Ошибка загрузки " + file.name); next(); };
    xhr.send(file);
  };
  next();
}

/* ---------------- glass sheen follows cursor ---------------- */

function attachGlassSheen() {
  document.querySelectorAll(".glass").forEach((el) => {
    if (el._sheen) return;
    el._sheen = true;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    });
  });
}

/* ---------------- init ---------------- */

function init() {
  checkEngine();
  setInterval(checkEngine, 15000);

  const dz = $("#dropzone");
  $("#btn-files").addEventListener("click", (e) => { e.stopPropagation(); browse("files", e.currentTarget); });
  $("#btn-folder").addEventListener("click", (e) => { e.stopPropagation(); browse("folder", e.currentTarget); });
  dz.addEventListener("click", () => browse("files", $("#btn-files")));

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  $("#btn-start").addEventListener("click", start);
  $("#btn-clear").addEventListener("click", clearOrCancel);

  $("#queue").addEventListener("click", (e) => {
    const x = e.target.closest("[data-x]");
    if (x && !state.running) { state.queue.splice(+x.dataset.x, 1); render(); return; }
    const rv = e.target.closest("[data-reveal]");
    if (rv) {
      const item = state.queue[+rv.dataset.reveal];
      if (item && item.dst) api("/api/reveal", { path: item.dst });
    }
  });

  attachGlassSheen();
}

document.addEventListener("DOMContentLoaded", init);
