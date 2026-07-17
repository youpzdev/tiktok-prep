/* TIKTOK PREP — frontend logic */
"use strict";

const $ = (s) => document.querySelector(s);

const state = {
  queue: [],          // {path, name, info, status, progress, before, after, dst, message, patch}
  job: null,
  running: false,
};

/* ---------------- i18n ---------------- */

const I18N = {
  ru: {
    // разметка
    hero_sub: "Лёгкая компрессия + патч MP4-контейнера — размер меньше, качество почти без потерь.<br>Обходит автодетект повторного контента: меняет фингерпринт, счётчик кадров и метаданные.",
    chip_1: "СЖАТИЕ ~5×", chip_2: "РАЗДУВ КАДРОВ ×10", chip_3: "НОВЫЙ ФИНГЕРПРИНТ",
    dz_title: "Перетащите видео сюда",
    dz_hint: "MP4 на выходе · MOV · MKV · WEBM на входе — загрузи и жми START",
    dz_files: "Выбрать файлы", dz_folder: "Папка целиком",
    method_title: "ЧТО&nbsp;ДЕЛАЕТ&nbsp;ПАТЧ",
    method_note: "сначала компрессия, затем патч",
    method_1: "<b>Компрессия.</b> Даунскейл во вписывание в кадр TikTok (до 1080p) + x264 CRF&nbsp;22, VBV&nbsp;15&nbsp;Мбит/с, аудио AAC&nbsp;48&nbsp;кГц — размер падает в разы, качество почти без потерь.",
    method_2: "<b>Раздувание счётчика кадров.</b> Дописываются фиктивные сэмплы, таблицы <span class=\"mono\">stsz / stts / stsc / stco</span> пересчитываются — контейнер показывает ×10 кадров, реальные данные целы.",
    method_3: "<b>Чистка отпечатка.</b> Обнуляется <span class=\"mono\">compressorname</span>, метаданные переписываются под новый уникальный ID — хэш и фингерпринт меняются.",
    queue_title: "ОЧЕРЕДЬ",
    sum_count: "ПРОПАТЧЕНО", sum_before: "КАДРОВ БЫЛО", sum_after: "СТАЛО", sum_saved: "РАЗДУВ",
    foot_left: "TIKTOK&nbsp;PREP&nbsp;·&nbsp;СЖАТИЕ&nbsp;+&nbsp;ПАТЧ&nbsp;MP4",
    // динамика
    btn_start: "START&nbsp;PROCESSING", btn_processing: "ОБРАБОТКА…",
    btn_clear: "Очистить", btn_cancel: "Отменить",
    engine_check: "ПРОВЕРКА&nbsp;ДВИЖКА…", engine_notfound: "FFMPEG НЕ НАЙДЕН", engine_offline: "СЕРВЕР ОФЛАЙН",
    st_queued: "в очереди", st_probing: "анализ", st_processing: "патч",
    st_done: "готово", st_error: "ошибка", st_cancelled: "отменено", st_uploading: "загрузка",
    retry: "ретрай", remove: "Убрать", frames: "кадров", reveal: "показать в папке",
    speed: "скорость", err: "ошибка",
    upload: "ЗАГРУЗКА {i}/{n} — {name}",
    t_noffmpeg: "ffmpeg не найден — установите: winget install Gyan.FFmpeg",
    t_nofolder: "В папке нет видеофайлов", t_novideo: "Нет подходящих видеофайлов",
    t_uploaderr: "Ошибка загрузки {name}", t_cancel: "Отмена…",
    t_done: "Готово: {n} файл(ов) → папка tiktok_ready", t_finished: "Обработка завершена",
    gb: "ГБ", mb: "МБ", kb: "КБ", mbits: "Мбит/с",
  },
  en: {
    hero_sub: "Light compression + MP4 container patch — smaller size, almost no quality loss.<br>Beats duplicate-content detection: changes the fingerprint, frame count and metadata.",
    chip_1: "~5× SMALLER", chip_2: "×10 FRAME COUNT", chip_3: "NEW FINGERPRINT",
    dz_title: "Drop your video here",
    dz_hint: "MP4 out · MOV · MKV · WEBM in — drop it and hit START",
    dz_files: "Pick files", dz_folder: "Whole folder",
    method_title: "WHAT&nbsp;THE&nbsp;PATCH&nbsp;DOES",
    method_note: "compress first, then patch",
    method_1: "<b>Compression.</b> Downscale to fit the TikTok frame (up to 1080p) + x264 CRF&nbsp;22, VBV&nbsp;15&nbsp;Mbps, AAC&nbsp;48&nbsp;kHz audio — size drops several times over, quality stays nearly intact.",
    method_2: "<b>Frame count inflation.</b> Dummy samples are appended and the <span class=\"mono\">stsz / stts / stsc / stco</span> tables are recalculated — the container reports ×10 frames while the real data stays untouched.",
    method_3: "<b>Fingerprint wipe.</b> The <span class=\"mono\">compressorname</span> field is zeroed and metadata is rewritten with a fresh unique ID — hash and fingerprint change.",
    queue_title: "QUEUE",
    sum_count: "PATCHED", sum_before: "FRAMES BEFORE", sum_after: "AFTER", sum_saved: "INFLATED",
    foot_left: "TIKTOK&nbsp;PREP&nbsp;·&nbsp;COMPRESS&nbsp;+&nbsp;MP4&nbsp;PATCH",
    btn_start: "START&nbsp;PROCESSING", btn_processing: "PROCESSING…",
    btn_clear: "Clear", btn_cancel: "Cancel",
    engine_check: "ENGINE&nbsp;CHECK…", engine_notfound: "FFMPEG NOT FOUND", engine_offline: "SERVER OFFLINE",
    st_queued: "queued", st_probing: "probing", st_processing: "patching",
    st_done: "done", st_error: "error", st_cancelled: "cancelled", st_uploading: "uploading",
    retry: "retry", remove: "Remove", frames: "frames", reveal: "show in folder",
    speed: "speed", err: "error",
    upload: "UPLOADING {i}/{n} — {name}",
    t_noffmpeg: "ffmpeg not found — install it: winget install Gyan.FFmpeg",
    t_nofolder: "No video files in that folder", t_novideo: "No supported video files",
    t_uploaderr: "Upload failed: {name}", t_cancel: "Cancelling…",
    t_done: "Done: {n} file(s) → tiktok_ready folder", t_finished: "Processing finished",
    gb: "GB", mb: "MB", kb: "KB", mbits: "Mbps",
  },
};

let LANG = localStorage.getItem("lang") ||
           ((navigator.language || "").startsWith("ru") ? "ru" : "en");
if (!I18N[LANG]) LANG = "ru";

function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || (I18N.ru[key] ?? key);
  if (vars) for (const k in vars) s = s.replaceAll("{" + k + "}", vars[k]);
  return s;
}

function applyLang(lang) {
  if (!I18N[lang]) return;
  LANG = lang;
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18n);
  });
  document.querySelectorAll("#lang button").forEach((b) =>
    b.classList.toggle("on", b.dataset.lang === lang));
  render();
  checkEngine();
}

/* ---------------- helpers ---------------- */

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " " + t("gb");
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " " + t("mb");
  return Math.round(bytes / 1e3) + " " + t("kb");
}
function fmtBitrate(bps) {
  return bps ? (bps / 1e6).toFixed(1) + " " + t("mbits") : "—";
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
    txt.textContent = t("engine_notfound");
    toast(t("t_noffmpeg"));
  } catch {
    el.className = "engine bad";
    txt.textContent = t("engine_offline");
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
        <span><b>${fmtFrames(rf)}</b> ${t("frames")} · ${fmtSize(b.size)}</span>
        <span class="to">→</span>
        <span><b>${fmtFrames(tf)}</b> ${t("frames")} · ${fmtSize(a.size)}</span>
        <button class="qreveal" data-reveal="${idx}">${t("reveal")}</button>
        <span class="qsave">×${mult}</span>
      </div>`;
  } else if (item.status === "error") {
    stats = `<div class="qerr">${(item.message || t("err")).replace(/</g, "&lt;")}</div>`;
  } else if (item.status === "processing" && item.speed) {
    stats = `<div class="qstats"><span>${t("speed")} <b>${item.speed}</b></span></div>`;
  }
  const pct = Math.round((item.progress || 0) * 100);
  const status = t("st_" + item.status) +
    (item.status === "processing" && item.attempt > 1 ? ` · ${t("retry")} ${item.attempt}` : "");
  return `<div class="glass qcard ${item.status}" data-i="${idx}">
      <div class="qrow">
        <div class="qname" title="${item.path}">${item.name}</div>
        <span class="qmeta">${meta}</span>
        <span class="qstatus">${status}</span>
        ${state.running ? "" : `<button class="qx" data-x="${idx}" title="${t("remove")}">×</button>`}
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
  $("#btn-start").innerHTML = '<span class="btn-sheen"></span>' +
    (state.running ? t("btn_processing") : t("btn_start"));
  $("#btn-clear").textContent = state.running ? t("btn_cancel") : t("btn_clear");
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
  toast(done ? t("t_done", { n: done }) : t("t_finished"));
}

async function clearOrCancel() {
  if (state.running) {
    await api("/api/cancel", { job: state.job });
    toast(t("t_cancel"));
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
    else if (mode === "folder" && r.paths) toast(t("t_nofolder"));
  } finally { btn.disabled = false; }
}

function uploadFiles(files) {
  const list = [...files].filter((f) => /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|ts|mts|m2ts|3gp|mpe?g)$/i.test(f.name));
  if (!list.length) { toast(t("t_novideo")); return; }
  const box = $("#dz-upload"), fill = $("#dz-upload-fill"), txt = $("#dz-upload-text");
  box.hidden = false;
  let i = 0;
  const next = () => {
    if (i >= list.length) { box.hidden = true; return; }
    const file = list[i++];
    txt.textContent = t("upload", { i, n: list.length, name: file.name });
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
    xhr.onerror = () => { toast(t("t_uploaderr", { name: file.name })); next(); };
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
  $("#lang").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (b) applyLang(b.dataset.lang);
  });

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

  applyLang(LANG);          // проставит тексты, класс .on и запустит checkEngine()
  setInterval(checkEngine, 15000);
  attachGlassSheen();
}

document.addEventListener("DOMContentLoaded", init);
