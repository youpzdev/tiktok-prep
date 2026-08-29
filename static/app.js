/* TikTok Prep - frontend */
"use strict";

const $ = (s) => document.querySelector(s);

const RESTARTABLE = new Set(["queued", "cancelled", "error"]);

const state = {
  queue: [],
  batch: [],
  job: null,
  running: false,
  mode: null,
  modes: [],
  engineOk: null,
  outDir: "",
};

/* ---------------- i18n ---------------- */

const I18N = {
  ru: {
    brand_sub: "компрессия и маскировка контейнера",
    modes_title: "режим",
    queue_title: "очередь",
    btn_files: "файлы",
    btn_folder: "папка",
    btn_clear: "очистить",
    btn_cancel: "отменить",
    btn_start: "старт",
    btn_open: "открыть папку",
    empty_title: "перетащи видео в окно",
    empty_hint: "mp4, mov, mkv, webm и другие. на выходе mp4 в папке tiktok_ready рядом с исходником",
    drop_now: "отпускай",
    engine_check: "проверка движка",
    engine_notfound: "ffmpeg не найден",
    engine_offline: "сервер офлайн",
    engine_hint: "поставь: winget install Gyan.FFmpeg",
    mode_stealth_note: "выход по параметрам нативного экспорта редактора. потолок 1080 и 60 кадров: выше уже не похоже на телефон",
    mode_max_note: "качество в приоритете, до 4k и без потолка по кадрам. если поток уже влезает в лимиты, он копируется без пережатия. под нативный экспорт такой файл не выдать",
    tag_copied: "без пережатия",
    st_queued: "в очереди",
    st_probing: "анализ",
    st_uploading: "загрузка",
    st_processing: "обработка",
    st_done: "готово",
    st_error: "ошибка",
    st_cancelled: "отменено",
    phase_encode: "компрессия",
    phase_mask: "маскировка",
    attempt: "попытка",
    remove: "убрать",
    retry: "повторить",
    show_error: "подробности ошибки",
    job_progress: "{done} из {total} · {pct}%",
    job_left: "осталось ~{time}",
    result_done: "{n} готово, сэкономлено {saved}",
    result_plain: "{n} готово",
    result_none: "готовых файлов нет",
    upload_one: "загрузка {i} из {n}: {name}",
    err_nofolder: "в папке нет видео",
    err_novideo: "нет подходящих видеофайлов",
    err_upload: "не удалось загрузить {name}",
    err_generic: "ошибка",
    err_probe: "не удалось прочитать файл",
    warn_mask_incomplete: "маскировка неполная: подпись энкодера осталась в файле",
    fps_uncapped: "fps без потолка",
    unit_min: " мин", unit_sec: " с",
    gb: "гб", mb: "мб", kb: "кб", mbits: "мбит/с",
  },
  en: {
    brand_sub: "compression and container masking",
    modes_title: "mode",
    queue_title: "queue",
    btn_files: "files",
    btn_folder: "folder",
    btn_clear: "clear",
    btn_cancel: "cancel",
    btn_start: "start",
    btn_open: "open folder",
    empty_title: "drop video anywhere in the window",
    empty_hint: "mp4, mov, mkv, webm and more. output is mp4 in a tiktok_ready folder next to the source",
    drop_now: "drop it",
    engine_check: "checking engine",
    engine_notfound: "ffmpeg not found",
    engine_offline: "server offline",
    engine_hint: "install it: winget install Gyan.FFmpeg",
    mode_stealth_note: "output matches a native editor export. capped at 1080 and 60 fps: anything above stops looking like a phone",
    mode_max_note: "quality first, up to 4k with no frame rate cap. a stream that already fits the limits is copied without re-encoding. a file like this cannot pass as a native export",
    tag_copied: "stream copied",
    st_queued: "queued",
    st_probing: "probing",
    st_uploading: "uploading",
    st_processing: "processing",
    st_done: "done",
    st_error: "error",
    st_cancelled: "cancelled",
    phase_encode: "encoding",
    phase_mask: "masking",
    attempt: "attempt",
    remove: "remove",
    retry: "retry",
    show_error: "error details",
    job_progress: "{done} of {total} · {pct}%",
    job_left: "~{time} left",
    result_done: "{n} done, {saved} saved",
    result_plain: "{n} done",
    result_none: "no finished files",
    upload_one: "uploading {i} of {n}: {name}",
    err_nofolder: "no video files in that folder",
    err_novideo: "no supported video files",
    err_upload: "upload failed: {name}",
    err_generic: "error",
    err_probe: "could not read the file",
    warn_mask_incomplete: "masking incomplete: the encoder signature is still in the file",
    fps_uncapped: "uncapped fps",
    unit_min: " min", unit_sec: " s",
    gb: "gb", mb: "mb", kb: "kb", mbits: "mbps",
  },
};

let LANG = localStorage.getItem("lang") ||
           ((navigator.language || "").startsWith("ru") ? "ru" : "en");
if (!I18N[LANG]) LANG = "ru";

function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || I18N.ru[key] || key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

function applyLang(lang) {
  if (!I18N[lang]) return;
  LANG = lang;
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("#lang button").forEach((b) =>
    b.classList.toggle("on", b.dataset.lang === lang));
  renderModes();
  render();
}

/* ---------------- helpers ---------------- */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function fmtSize(bytes) {
  if (!bytes) return "0";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " " + t("gb");
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " " + t("mb");
  return Math.round(bytes / 1e3) + " " + t("kb");
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? m + t("unit_min") : s + t("unit_sec");
}

function fmtSpec(info) {
  if (!info || !info.width) return "";
  const fps = info.fps ? " · " + Math.round(info.fps) + "fps" : "";
  return info.width + "x" + info.height + fps + " · " + fmtSize(info.size);
}

async function api(path, body) {
  const res = await fetch(path, body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {});
  return res.json();
}

/* ---------------- engine ---------------- */

async function checkEngine() {
  const el = $("#engine"), txt = $("#engine-text");
  try {
    const s = await api("/api/status");
    if (!state.modes.length && s.modes) {
      state.modes = s.modes;
      state.mode = localStorage.getItem("mode") || s.default_mode;
      if (!state.modes.some((m) => m.id === state.mode)) state.mode = s.default_mode;
      renderModes();
    }
    if (s.ffmpeg && s.ffprobe) {
      el.className = "engine ok";
      txt.textContent = "ffmpeg " + (s.version || "").split("-")[0];
      $("#foot-engine").textContent = s.ffmpeg_path || "";
      state.engineOk = true;
      render();
      return true;
    }
    el.className = "engine bad";
    txt.textContent = t("engine_notfound");
    $("#foot-engine").textContent = t("engine_hint");
  } catch {
    el.className = "engine bad";
    txt.textContent = t("engine_offline");
    $("#foot-engine").textContent = "";
  }
  state.engineOk = false;
  render();
  return false;
}

/* ---------------- modes ---------------- */

function modeSpec(m) {
  const res = m.max_long + "x" + m.max_short;
  const fps = m.max_fps ? Math.round(m.max_fps) + "fps" : t("fps_uncapped");
  return res + " · " + fps + " · crf " + m.crf;
}

function renderModes() {
  const box = $("#modes");
  if (!box) return;
  box.innerHTML = state.modes.map((m) => `
    <button type="button" class="mode ${m.id === state.mode ? "on" : ""}" data-mode="${esc(m.id)}"
            aria-pressed="${m.id === state.mode}">
      <span class="mode-name">${esc(m.label)}</span>
      <span class="mode-spec">${esc(modeSpec(m))}</span>
      <span class="mode-note">${esc(t("mode_" + m.id + "_note"))}</span>
    </button>`).join("");
}

/* ---------------- queue ---------------- */

function addPaths(paths) {
  const fresh = paths.filter((p) => p && !state.queue.some((q) => q.path === p));
  if (!fresh.length) return;
  for (const p of fresh) {
    state.queue.push({ path: p, name: p.split(/[\\/]/).pop(), status: "probing", progress: 0 });
  }
  render();
  api("/api/probe", { paths: fresh }).then((r) => {
    (r.files || []).forEach((info, i) => {
      const item = state.queue.find((q) => q.path === (info.path || fresh[i]));
      if (!item) return;
      if (info.error) {
        item.status = "error";
        item.message = info.error;
      } else {
        item.info = info;
        item.status = "queued";
      }
    });
    for (const p of fresh) {
      const item = state.queue.find((q) => q.path === p);
      if (item && item.status === "probing") {
        item.status = "error";
        item.message = t("err_probe");
      }
    }
    render();
  }).catch(() => {
    for (const p of fresh) {
      const item = state.queue.find((q) => q.path === p);
      if (item && item.status === "probing") {
        item.status = "error";
        item.message = t("err_probe");
      }
    }
    render();
  });
}

function statusText(item) {
  if (item.status === "processing") {
    const phase = item.progress >= 0.96 ? t("phase_mask") : t("phase_encode");
    const attempt = item.attempt > 1 ? " · " + t("attempt") + " " + item.attempt : "";
    return phase + attempt;
  }
  return t("st_" + item.status);
}

function rowHTML(item, idx) {
  const info = item.before || item.info;
  const parts = [];
  if (info) parts.push(fmtSpec(info));
  if (item.status === "done" && item.after) {
    parts.push("&rarr; " + fmtSpec(item.after));
    const saved = (info ? info.size : 0) - item.after.size;
    if (saved > 0) parts.push("<b>-" + fmtSize(saved) + "</b>");
    if (item.copied) parts.push(esc(t("tag_copied")));
  }
  const meta = parts.length ? `<div class="row-meta">${parts.join("<span></span>")}</div>` : "";

  const warn = item.warning
    ? `<div class="row-warn">${esc(t("warn_" + item.warning))}</div>`
    : "";

  const err = item.status === "error"
    ? `<details class="row-err"><summary>${esc(t("show_error"))}</summary><pre>${esc(item.message || t("err_generic"))}</pre></details>`
    : "";

  const pct = Math.round((item.progress || 0) * 100);
  const bar = item.status === "processing"
    ? `<div class="row-bar"><div class="row-bar-fill" style="width:${pct}%"></div></div>`
    : "";

  const canRemove = !state.running;
  return `<li class="row ${esc(item.status)}" data-i="${idx}">
      <div class="row-name" title="${esc(item.path)}">${esc(item.name)}</div>
      <div class="row-side">
        <span class="row-status">${esc(statusText(item))}</span>
        ${canRemove ? `<button type="button" class="icon-btn" data-x="${idx}" aria-label="${esc(t("remove"))}">&times;</button>` : ""}
      </div>
      ${meta}
      ${bar}
      ${warn}
      ${err}
    </li>`;
}

function render() {
  const queue = state.queue;
  const open = new Set([...document.querySelectorAll(".row-err[open]")]
    .map((d) => d.closest(".row").dataset.i));
  $("#queue").innerHTML = queue.map(rowHTML).join("");
  for (const i of open) {
    const d = document.querySelector(`.row[data-i="${i}"] .row-err`);
    if (d) d.open = true;
  }
  $("#queue-count").textContent = queue.length;
  $("#empty").hidden = queue.length > 0;

  const pending = queue.filter((q) => RESTARTABLE.has(q.status)).length;
  const start = $("#btn-start");
  start.disabled = state.running || !pending || state.engineOk === false;
  start.textContent = t("btn_start");
  $("#btn-clear").textContent = state.running ? t("btn_cancel") : t("btn_clear");
  $("#btn-clear").disabled = !queue.length && !state.running;

  renderJobLine();
  renderResult();
}

function renderJobLine() {
  const line = $("#jobline");
  line.hidden = !state.running;
  if (!state.running) return;
  const batch = state.batch.length
    ? state.queue.filter((q) => state.batch.includes(q.path))
    : state.queue;
  const total = batch.length;
  const finished = (q) => q.status === "done" || q.status === "error" || q.status === "cancelled";
  const done = batch.filter(finished).length;
  const sum = batch.reduce((s, q) =>
    s + (finished(q) ? 1 : q.status === "processing" ? (q.progress || 0) : 0), 0);
  const pct = total ? Math.round((sum / total) * 100) : 0;
  $("#jobbar-fill").style.width = pct + "%";
  let text = t("job_progress", { done, total, pct });
  const eta = etaSeconds(sum, total);
  if (eta) text += " · " + t("job_left", { time: fmtTime(eta) });
  $("#jobtext").textContent = text;
}

let jobStarted = 0;
function etaSeconds(sum, total) {
  if (!jobStarted || sum <= 0.02) return 0;
  const elapsed = (Date.now() - jobStarted) / 1000;
  return (elapsed / sum) * (total - sum);
}

function renderResult() {
  const done = state.queue.filter((q) => q.status === "done" && q.after);
  const box = $("#result");
  box.hidden = state.running || !state.queue.length ||
               state.queue.some((q) => q.status === "queued" || q.status === "probing");
  if (box.hidden) return;
  if (!done.length) {
    $("#result-text").textContent = t("result_none");
    $("#btn-open").hidden = true;
    return;
  }
  const saved = done.reduce((s, q) => s + Math.max(0, (q.before ? q.before.size : 0) - q.after.size), 0);
  $("#result-text").textContent = saved > 0
    ? t("result_done", { n: done.length, saved: fmtSize(saved) })
    : t("result_plain", { n: done.length });
  $("#btn-open").hidden = false;
  state.outDir = done[done.length - 1].dst || "";
  $("#foot-out").textContent = state.outDir;
}

/* ---------------- processing ---------------- */

let starting = false;

async function start() {
  if (starting || state.running) return;
  const batch = state.queue.filter((q) => RESTARTABLE.has(q.status));
  if (!batch.length) return;
  starting = true;
  $("#btn-start").disabled = true;
  try {
    if (!(await checkEngine())) return;
    const r = await api("/api/process", { paths: batch.map((q) => q.path), mode: state.mode });
    if (r.error) {
      showNotice(r.error);
      return;
    }
    for (const q of batch) {
      q.status = "queued";
      q.progress = 0;
      q.message = null;
      q.warning = null;
    }
    state.batch = batch.map((q) => q.path);
    state.job = r.job;
    state.running = true;
    jobStarted = Date.now();
    poll();
  } finally {
    starting = false;
    render();
  }
}

function showNotice(msg) {
  const el = $("#notice");
  el.textContent = msg;
  el.hidden = !msg;
  clearTimeout(showNotice._t);
  showNotice._t = setTimeout(() => { el.hidden = true; }, 6000);
}

async function poll() {
  if (!state.job) return;
  let job;
  try {
    job = await api("/api/job/" + state.job);
  } catch {
    setTimeout(poll, 1200);
    return;
  }
  for (const f of job.files || []) {
    const item = state.queue.find((q) => q.path === f.src);
    if (item) Object.assign(item, {
      status: f.status, progress: f.progress, before: f.before, after: f.after,
      dst: f.dst, message: f.message, patch: f.patch, attempt: f.attempt,
      copied: f.copied, warning: f.warning,
    });
  }
  render();
  if (job.status === "running") {
    setTimeout(poll, 500);
    return;
  }
  state.running = false;
  state.job = null;
  jobStarted = 0;
  render();
}

async function clearOrCancel() {
  if (state.running) {
    await api("/api/cancel", { job: state.job });
    return;
  }
  state.queue = [];
  render();
}

/* ---------------- input ---------------- */

async function browse(mode, btn) {
  btn.disabled = true;
  try {
    const r = await api("/api/browse", { mode });
    if (r.paths && r.paths.length) addPaths(r.paths);
    else if (mode === "folder" && r.cancelled === false) showNotice(t("err_nofolder"));
  } finally {
    btn.disabled = false;
  }
}

function uploadFiles(files) {
  const list = [...files].filter((f) =>
    /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|ts|mts|m2ts|3gp|mpe?g)$/i.test(f.name));
  if (!list.length) {
    showNotice(t("err_novideo"));
    return;
  }
  let i = 0;
  const next = () => {
    if (i >= list.length) {
      $("#upload").hidden = true;
      return;
    }
    const file = list[i++];
    $("#upload").hidden = false;
    $("#upload").textContent = t("upload_one", { i, n: list.length, name: file.name });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $("#upload").textContent = t("upload_one", { i, n: list.length, name: file.name }) + " " + pct + "%";
    };
    xhr.onload = () => {
      try { addPaths([JSON.parse(xhr.responseText).path]); }
      catch { showNotice(t("err_upload", { name: file.name })); }
      next();
    };
    xhr.onerror = () => {
      showNotice(t("err_upload", { name: file.name }));
      next();
    };
    xhr.send(file);
  };
  next();
}

/* ---------------- init ---------------- */

function init() {
  $("#lang").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (b) applyLang(b.dataset.lang);
  });

  $("#modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || state.running) return;
    state.mode = b.dataset.mode;
    localStorage.setItem("mode", state.mode);
    renderModes();
  });

  $("#btn-files").addEventListener("click", (e) => browse("files", e.currentTarget));
  $("#btn-folder").addEventListener("click", (e) => browse("folder", e.currentTarget));
  $("#btn-start").addEventListener("click", start);
  $("#btn-clear").addEventListener("click", clearOrCancel);
  $("#btn-open").addEventListener("click", () => {
    if (state.outDir) api("/api/reveal", { path: state.outDir });
  });

  $("#queue").addEventListener("click", (e) => {
    const x = e.target.closest("[data-x]");
    if (x && !state.running) {
      state.queue.splice(+x.dataset.x, 1);
      render();
    }
  });

  const veil = $("#drop-veil");
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    veil.hidden = false;
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) { dragDepth = 0; veil.hidden = true; }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    veil.hidden = true;
    uploadFiles(e.dataTransfer.files);
  });

  applyLang(LANG);
  checkEngine();
  setInterval(() => { if (!state.running) checkEngine(); }, 15000);
}

document.addEventListener("DOMContentLoaded", init);
