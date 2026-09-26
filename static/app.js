/* TikTok Prep - frontend */
"use strict";

const $ = (s) => document.querySelector(s);

const RESTARTABLE = new Set(["queued", "cancelled", "error"]);
const GHOST_MULT = 10;           // во столько раз клон заявляет больше сэмплов
const STAGGER_STEP = 45;         // мс между появлением соседних строк
const STAGGER_BUDGET = 270;      // потолок суммарной задержки входа
const ROW_IN_MS = 380;           // держать в паре с row-in в style.css
const ROW_OUT_MS = 200;          // то же для row-out

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
    brand_sub: "Подготовка видео",
    modes_title: "Обработка",
    queue_title: "Очередь",
    btn_files: "Добавить файлы",
    btn_folder: "Папка",
    btn_clear: "Очистить",
    btn_cancel: "Отменить",
    btn_start: "Обработать видео",
    btn_open: "Открыть папку",
    empty_title: "Перетащи видео сюда",
    empty_hint: "MP4, MOV, MKV, WEBM и другие",
    drop_now: "Отпусти, чтобы добавить",
    engine_check: "Проверка",
    engine_notfound: "Нет ffmpeg",
    engine_offline: "Нет соединения",
    engine_hint: "поставь: winget install Gyan.FFmpeg",
    mode_stealth_note: "H.264, до 1080 по короткой стороне и до 60 fps. Видео перекодируется, метаданные контейнера меняются.",
    mode_max_note: "До 4K без ограничения fps. Совместимое видео копируется без перекодирования, остальное приводится к параметрам режима.",
    tag_copied: "без пережатия",
    st_queued: "В очереди",
    st_probing: "Анализ",
    st_uploading: "Загрузка",
    st_processing: "Обработка",
    st_done: "Готово",
    st_error: "Ошибка",
    st_cancelled: "Отменено",
    phase_encode: "Сжатие",
    phase_mask: "Метаданные",
    attempt: "попытка",
    remove: "убрать",
    show_error: "Подробности ошибки",
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
    bpp: "бит/пкс",
    ghost_name: "Фиктивная аудиодорожка",
    ghost_note: "Добавляет копию звука с десятикратным числом сэмплов. Может влиять на совместимость файла. Сохранение качества после загрузки в TikTok не гарантировано.",
    tag_ghost: "звук раздут",
    unit_min: " мин", unit_sec: " с",
    gb: "ГБ", mb: "МБ", kb: "КБ",
    engine_ready: "Локально",
    size_label: "Размер",
    fps_label: "Частота кадров",
    up_to: "до {value}",
    ghost_short: "Экспериментальный метод",
    details_label: "Подробнее о режиме",
    output_label: "Результат в папке",
    local_processing: "Обработка на этом компьютере",
    btn_start_count: "Обработать видео ({n})",
    btn_working: "Обработка...",
    btn_starting: "Запуск...",
  },
  en: {
    brand_sub: "Video preparation",
    modes_title: "Processing",
    queue_title: "Queue",
    btn_files: "Add files",
    btn_folder: "Folder",
    btn_clear: "Clear",
    btn_cancel: "Cancel",
    btn_start: "Process videos",
    btn_open: "Open folder",
    empty_title: "Drop your videos here",
    empty_hint: "MP4, MOV, MKV, WEBM and more",
    drop_now: "Drop to add files",
    engine_check: "Checking",
    engine_notfound: "ffmpeg missing",
    engine_offline: "Disconnected",
    engine_hint: "install it: winget install Gyan.FFmpeg",
    mode_stealth_note: "H.264, up to 1080 on the short side and 60 fps. Video is re-encoded and container metadata is changed.",
    mode_max_note: "Up to 4K with no frame rate cap. Compatible video is copied without re-encoding; other files are converted.",
    tag_copied: "stream copied",
    st_queued: "Queued",
    st_probing: "Analyzing",
    st_uploading: "Uploading",
    st_processing: "processing",
    st_done: "Done",
    st_error: "Error",
    st_cancelled: "Cancelled",
    phase_encode: "Encoding",
    phase_mask: "Metadata",
    attempt: "attempt",
    remove: "remove",
    show_error: "Error details",
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
    bpp: "bpp",
    ghost_name: "Ghost audio track",
    ghost_note: "Adds an audio copy with ten times the sample count. This can affect file compatibility. Quality after uploading to TikTok is not guaranteed.",
    tag_ghost: "audio inflated",
    unit_min: " min", unit_sec: " s",
    gb: "GB", mb: "MB", kb: "KB",
    engine_ready: "Local",
    size_label: "Dimensions",
    fps_label: "Frame rate",
    up_to: "up to {value}",
    ghost_short: "Experimental method",
    details_label: "About this mode",
    output_label: "Output folder",
    local_processing: "Processed on this computer",
    btn_start_count: "Process videos ({n})",
    btn_working: "Processing...",
    btn_starting: "Starting...",
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
  const seg = $("#lang");
  const buttons = [...seg.querySelectorAll("[data-lang]")];
  buttons.forEach((b, i) => {
    const on = b.dataset.lang === lang;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    if (on) seg.dataset.index = i;
  });
  renderModes();
  if (state.engineOk === true) setText($("#engine-text"), t("engine_ready"));
  render();
}

/* ---------------- helpers ---------------- */

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

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function icon(id, cls) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls || "ico");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + id);
  svg.appendChild(use);
  return svg;
}

/** Довести дело после анимации. Событие animationend не приходит, пока окно
    свёрнуто или вкладка в фоне: анимации там замораживаются. Поэтому уборка
    висит ещё и на таймере - иначе строка, помеченная на удаление, остаётся в
    документе навсегда. */
function afterAnim(node, ms, fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fn();
  };
  node.addEventListener("animationend", run, { once: true });
  const timer = setTimeout(run, ms);
}

/** Меняет текст только когда он реально другой: иначе браузер сбрасывает
    выделение и мигает подпиксельным рендером на каждом опросе. */
function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

async function api(path, body) {
  const res = await fetch(path, body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {});
  return res.json();
}

/* ---------------- engine ---------------- */

async function checkEngine() {
  const box = $("#engine"), txt = $("#engine-text");
  try {
    const s = await api("/api/status");
    if (!state.modes.length && s.modes) {
      state.modes = s.modes;
      state.mode = localStorage.getItem("mode") || s.default_mode;
      if (!state.modes.some((m) => m.id === state.mode)) state.mode = s.default_mode;
      renderModes();
    }
    if (s.ffmpeg && s.ffprobe) {
      box.className = "engine ok";
      setText(txt, t("engine_ready"));
      box.title = "ffmpeg " + (s.version || "") + " | " + (s.ffmpeg_path || "");
      setText($("#foot-engine"), t("local_processing"));
      state.engineOk = true;
      render();
      return true;
    }
    box.className = "engine bad";
    setText(txt, t("engine_notfound"));
    setText($("#foot-engine"), t("engine_hint"));
  } catch {
    box.className = "engine bad";
    setText(txt, t("engine_offline"));
    setText($("#foot-engine"), "");
  }
  state.engineOk = false;
  render();
  return false;
}

/* ---------------- modes ---------------- */

function renderModes() {
  const box = $("#modes");
  box.textContent = "";
  for (const m of state.modes) {
    const on = m.id === state.mode;
    const btn = el("button", "mode" + (on ? " on" : ""));
    btn.type = "button";
    btn.dataset.mode = m.id;
    btn.disabled = state.running;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", on);
    btn.tabIndex = on ? 0 : -1;
    btn.appendChild(el("span", "mode-name", m.label));
    box.appendChild(btn);
  }
  const selected = state.modes.find((mode) => mode.id === state.mode);
  if (!selected) return;
  const dimensions = selected.max_short + " x " + selected.max_long;
  setText($("#mode-size"), t("up_to", { value: dimensions }));
  setText($("#mode-fps"), selected.max_fps
    ? t("up_to", { value: Math.round(selected.max_fps) + " fps" }) : t("fps_uncapped"));
  setText($("#mode-note"), t("mode_" + selected.id + "_note"));
}

/* ---------------- queue ---------------- */

function addPaths(paths) {
  const fresh = paths.filter((p) => p && !state.queue.some((q) => q.path === p));
  if (!fresh.length) return;
  for (const p of fresh) {
    state.queue.push({ path: p, name: p.split(/[\\/]/).pop(), status: "probing", progress: 0 });
  }
  render();

  const failRest = () => {
    for (const p of fresh) {
      const item = state.queue.find((q) => q.path === p);
      if (item && item.status === "probing") {
        item.status = "error";
        item.message = t("err_probe");
      }
    }
    render();
  };

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
    failRest();
  }).catch(failRest);
}

function statusText(item) {
  if (item.status === "processing") {
    const phase = item.progress >= 0.96 ? t("phase_mask") : t("phase_encode");
    const attempt = item.attempt > 1 ? " · " + t("attempt") + " " + item.attempt : "";
    return phase + attempt;
  }
  return t("st_" + item.status);
}

/* Строки живут между опросами: сервер дёргает нас дважды в секунду, и
   пересборка списка убивала бы и анимацию входа, и плавность прогресса. */
const rows = new Map();

function buildRow(item) {
  const li = el("li", "row");
  li.dataset.path = item.path;

  const name = el("div", "row-name");
  const side = el("div", "row-side");
  const status = el("span", "row-status");
  const remove = el("button", "icon-btn");
  remove.type = "button";
  remove.appendChild(icon("i-close"));
  side.append(status, remove);

  const meta = el("div", "row-meta");
  const bar = el("div", "row-bar");
  const fill = el("div", "row-bar-fill");
  bar.appendChild(fill);
  const warn = el("div", "row-warn");
  const err = el("details", "row-err");
  const summary = el("summary");
  const pre = el("pre");
  err.append(summary, pre);

  const fileIcon = el("span", "row-icon");
  fileIcon.appendChild(icon("i-file"));
  li.append(fileIcon, name, side, meta, bar, warn, err);
  li.parts = { name, status, remove, meta, bar, fill, warn, err, summary, pre };

  remove.addEventListener("click", () => {
    if (state.running) return;
    const i = state.queue.findIndex((q) => q.path === li.dataset.path);
    if (i < 0) return;
    state.queue.splice(i, 1);
    render();
  });

  return li;
}

function updateRow(li, item) {
  const p = li.parts;

  if (li.dataset.status !== item.status) {
    li.dataset.status = item.status;
    li.className = "row " + item.status + (li.classList.contains("enter") ? " enter" : "");
  }

  setText(p.name, item.name);
  li.title = item.path;
  setText(p.status, statusText(item));

  p.remove.hidden = state.running;
  p.remove.setAttribute("aria-label", t("remove") + ": " + item.name);

  const info = item.before || item.info;
  p.meta.textContent = "";
  if (info) p.meta.appendChild(el("span", null, fmtSpec(info)));
  if (item.status === "done" && item.after) {
    p.meta.append(el("span", "sep", "/"), el("span", null, fmtSpec(item.after)));
    const saved = (info ? info.size : 0) - item.after.size;
    if (saved > 0) p.meta.appendChild(el("span", "saved", "-" + fmtSize(saved)));
    if (item.copied) p.meta.appendChild(el("span", "tag", t("tag_copied")));
    if (item.patch && item.patch.ghost_samples) p.meta.appendChild(el("span", "tag", t("tag_ghost")));
  }
  p.meta.hidden = !p.meta.childNodes.length;

  const running = item.status === "processing";
  p.bar.hidden = !running;
  if (running) p.fill.style.width = Math.round((item.progress || 0) * 100) + "%";

  setText(p.warn, item.warning ? t("warn_" + item.warning) : "");
  p.warn.hidden = !item.warning;

  const failed = item.status === "error";
  p.err.hidden = !failed;
  if (failed) {
    setText(p.summary, t("show_error"));
    setText(p.pre, item.message || t("err_generic"));
  }
}

function render() {
  const list = $("#queue");
  const seen = new Set();
  let entering = 0;

  state.queue.forEach((item) => {
    seen.add(item.path);
    let li = rows.get(item.path);
    if (!li) {
      li = buildRow(item);
      rows.set(item.path, li);
      const delay = Math.min(entering++ * STAGGER_STEP, STAGGER_BUDGET);
      li.classList.add("enter");
      li.style.animationDelay = delay + "ms";
      afterAnim(li, delay + ROW_IN_MS + 120, () => {
        li.classList.remove("enter");
        li.style.animationDelay = "";
      });
    }
    updateRow(li, item);
  });

  for (const [path, li] of rows) {
    if (seen.has(path)) continue;
    rows.delete(path);
    li.classList.add("leave");
    afterAnim(li, ROW_OUT_MS + 120, () => li.remove());
  }

  // порядок в DOM подтягиваем к состоянию, не трогая уже стоящие на месте узлы
  let anchor = null;
  for (const item of state.queue) {
    const li = rows.get(item.path);
    const next = anchor ? anchor.nextElementSibling : list.firstElementChild;
    if (next !== li) list.insertBefore(li, next);
    anchor = li;
  }

  setText($("#queue-count"), "(" + String(state.queue.length).padStart(2, "0") + ")");
  $("#empty").classList.toggle("compact", state.queue.length > 0);
  $("#empty").hidden = state.running;

  const pending = state.queue.filter((q) => RESTARTABLE.has(q.status)).length;
  const start = $("#btn-start");
  start.disabled = starting || state.running || !pending || state.engineOk !== true;
  setText(start.lastElementChild, state.running ? t("btn_working") : starting ? t("btn_starting")
    : pending ? t("btn_start_count", { n: pending }) : t("btn_start"));
  $("#ghost").disabled = state.running;
  $("#modes").querySelectorAll("button").forEach((button) => { button.disabled = state.running; });

  const clear = $("#btn-clear");
  setText(clear.lastElementChild, state.running ? t("btn_cancel") : t("btn_clear"));
  clear.classList.toggle("danger", state.running);
  clear.setAttribute("aria-label", state.running ? t("btn_cancel") : t("btn_clear"));
  clear.disabled = !state.queue.length && !state.running;
  $("#clear-ico").firstElementChild
    .setAttribute("href", state.running ? "#i-stop" : "#i-broom");

  renderJobLine();
  renderResult();
}

function renderJobLine() {
  const line = $("#jobline");
  if (!state.running) {
    line.hidden = true;
    line.classList.remove("slide-in");
    return;
  }
  if (line.hidden) {
    line.hidden = false;
    line.classList.add("slide-in");
  }
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
  setText($("#jobtext"), text);
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
  const hide = state.running || !state.queue.length ||
               state.queue.some((q) => q.status === "queued" || q.status === "probing");
  if (hide) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (!done.length) {
    setText($("#result-text"), t("result_none"));
    $("#btn-open").hidden = true;
    return;
  }
  const saved = done.reduce((s, q) => s + Math.max(0, (q.before ? q.before.size : 0) - q.after.size), 0);
  setText($("#result-text"), saved > 0
    ? t("result_done", { n: done.length, saved: fmtSize(saved) })
    : t("result_plain", { n: done.length }));
  $("#btn-open").hidden = false;
  state.outDir = done[done.length - 1].dst || "";
  setText($("#foot-out"), state.outDir);
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
    const r = await api("/api/process", {
      paths: batch.map((q) => q.path),
      mode: state.mode,
      ghost: $("#ghost").checked ? GHOST_MULT : 0,
    });
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
  const box = $("#notice");
  setText(box, msg || "");
  box.classList.remove("slide-in");
  if (msg) {
    void box.offsetWidth;               // рестарт анимации на повторном показе
    box.classList.add("slide-in");
  }
  box.hidden = !msg;
  clearTimeout(showNotice._t);
  if (msg) showNotice._t = setTimeout(() => { box.hidden = true; }, 6000);
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
  const box = $("#upload");
  let i = 0;
  const next = () => {
    if (i >= list.length) {
      box.hidden = true;
      box.classList.remove("slide-in");
      return;
    }
    const file = list[i++];
    if (box.hidden) {
      box.hidden = false;
      box.classList.add("slide-in");
    }
    const label = (extra) => setText(box, t("upload_one", { i, n: list.length, name: file.name }) + extra);
    label("");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) label(" " + Math.round((e.loaded / e.total) * 100) + "%");
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

  const ghostBox = $("#ghost");
  ghostBox.checked = localStorage.getItem("ghost") !== "0";
  ghostBox.addEventListener("change", () =>
    localStorage.setItem("ghost", ghostBox.checked ? "1" : "0"));

  $("#modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || state.running) return;
    state.mode = b.dataset.mode;
    localStorage.setItem("mode", state.mode);
    renderModes();
  });

  $("#modes").addEventListener("keydown", (e) => {
    if (state.running || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const modes = state.modes;
    if (!modes.length) return;
    const current = modes.findIndex((mode) => mode.id === state.mode);
    const direction = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? modes.length - 1
      : (current + direction + modes.length) % modes.length;
    state.mode = modes[next].id;
    localStorage.setItem("mode", state.mode);
    renderModes();
    $("#modes .on").focus();
  });

  $("#btn-files").addEventListener("click", (e) => browse("files", e.currentTarget));
  $("#empty").addEventListener("click", (e) => browse("files", e.currentTarget));
  $("#btn-folder").addEventListener("click", (e) => browse("folder", e.currentTarget));
  $("#btn-start").addEventListener("click", start);
  $("#btn-clear").addEventListener("click", clearOrCancel);
  $("#btn-open").addEventListener("click", () => {
    if (state.outDir) api("/api/reveal", { path: state.outDir });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") showNotice("");
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
