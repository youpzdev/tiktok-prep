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
    bpp: "бит/пкс",
    ghost_name: "фиктивная аудиодорожка",
    ghost_note: "добавляет копию звука с десятикратным числом сэмплов: оценщик видит 172 секунды вместо 17 и занижает битрейт. видео не трогается, fps честный, файл играется нормально",
    tag_ghost: "звук раздут",
    unit_min: " мин", unit_sec: " с",
    gb: "гб", mb: "мб", kb: "кб",
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
    bpp: "bpp",
    ghost_name: "ghost audio track",
    ghost_note: "adds a copy of the audio with ten times the sample count: an estimator sees 172 seconds instead of 17 and underrates the bitrate. video is untouched, fps stays honest, the file plays fine",
    tag_ghost: "audio inflated",
    unit_min: " min", unit_sec: " s",
    gb: "gb", mb: "mb", kb: "kb",
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
      setText(txt, "ffmpeg " + (s.version || "").split("-")[0]);
      setText($("#foot-engine"), s.ffmpeg_path || "");
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

function modeSpec(m) {
  const res = m.max_long + "x" + m.max_short;
  const fps = m.max_fps ? Math.round(m.max_fps) + "fps" : t("fps_uncapped");
  const rate = m.bpp ? m.bpp.toFixed(3) + " " + t("bpp") : "";
  return [res, fps, rate].filter(Boolean);
}

function renderModes() {
  const box = $("#modes");
  if (!box) return;
  box.textContent = "";
  for (const m of state.modes) {
    const on = m.id === state.mode;
    const btn = el("button", "mode" + (on ? " on" : ""));
    btn.type = "button";
    btn.dataset.mode = m.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", on);
    const spec = el("span", "mode-spec");
    modeSpec(m).forEach((chunk, i) => {
      if (i) spec.appendChild(el("span", "sep", "·"));
      spec.appendChild(el("span", null, chunk));
    });
    btn.append(
      el("span", "mode-name", m.label),
      spec,
      el("span", "mode-note", t("mode_" + m.id + "_note")),
    );
    const tick = el("span", "mode-tick");
    tick.setAttribute("aria-hidden", "true");
    tick.appendChild(icon("i-check", ""));
    btn.appendChild(tick);
    box.appendChild(btn);
  }
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

  li.append(name, side, meta, bar, warn, err);
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
    p.meta.append(el("span", "sep", "→"), el("span", null, fmtSpec(item.after)));
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

  setText($("#queue-count"), String(state.queue.length));
  $("#empty").hidden = state.queue.length > 0;

  const pending = state.queue.filter((q) => RESTARTABLE.has(q.status)).length;
  const start = $("#btn-start");
  start.disabled = state.running || !pending || state.engineOk === false;

  const clear = $("#btn-clear");
  setText(clear.lastElementChild, state.running ? t("btn_cancel") : t("btn_clear"));
  clear.classList.toggle("danger", state.running);
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

  $("#btn-files").addEventListener("click", (e) => browse("files", e.currentTarget));
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
