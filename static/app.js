"use strict";

const $ = selector => document.querySelector(selector);
const messages = {
  nav_process: ["Обработать видео", "Prepare a video"],
  eyebrow: ["Подготовка видео к публикации", "Video preparation for upload"],
  hero_first: ["Подготовь видео", "Prepare your video"], hero_second: ["к TikTok.", "for TikTok."],
  hero_description: ["Добавь видео, выбери Stealth или Max и забери готовый MP4.", "Add a video, choose Stealth or Max, and get the finished MP4."],
  workspace_title: ["Подготовить видео", "Prepare a video"], queue_title: ["Очередь", "Queue"],
  engine_check: ["Проверка ffmpeg", "Checking ffmpeg"], engine_ready: ["Готов к обработке", "Ready to process"],
  engine_missing: ["Нужен ffmpeg", "ffmpeg required"], engine_offline: ["Нет соединения", "Disconnected"],
  engine_restart: ["Перезапусти сервер", "Restart the server"],
  engine_restart_help: ["Работает прежний сервер. Закрой его окно и запусти start.bat заново.", "The previous server is running. Close its window and run start.bat again."],
  engine_help: ["Для обработки установи ffmpeg: winget install Gyan.FFmpeg", "Install ffmpeg to process videos: winget install Gyan.FFmpeg"],
  retry: ["Повторить", "Retry"], btn_files: ["Добавить ещё", "Add more"], btn_folder: ["Или выбери папку", "Or choose a folder"],
  empty_title: ["Перетащи видео сюда", "Drop your videos here"],
  modes_title: ["Выбранный режим", "Selected mode"], mode_choice: ["Режим обработки", "Processing mode"], settings: ["Настройки", "Settings"],
  mode_stealth_note: ["Stealth перекодирует видео в H.264 Main с обычной скоростью. Размер и частота кадров не увеличиваются.", "Stealth encodes H.264 Main at standard speed. Resolution and frame rate are never increased."],
  mode_max_note: ["Max использует более тщательное кодирование с переменным битрейтом. Обработка дольше, файл может стать больше.", "Max uses more thorough encoding with variable bitrate. Processing takes longer, and the file may be larger."],
  size_label: ["Размер", "Dimensions"], fps_label: ["Частота", "Frame rate"], up_to: ["до {value}", "up to {value}"],
  ghost_name: ["Фиктивные аудиосэмплы", "Ghost audio samples"],
  ghost_note: ["В одной аудиодорожке число сэмплов увеличивается в 10 раз. Реальный звук сохраняется. Фиктивный хвост может влиять на совместимость с плеерами.", "The sample count grows tenfold in a single audio track. Real audio is preserved. The ghost tail may affect player compatibility."],
  btn_clear: ["Очистить", "Clear"], btn_cancel: ["Отменить", "Cancel"],
  btn_choose: ["Выбрать видео", "Choose videos"], btn_start_count: ["Обработать ({n})", "Process ({n})"], btn_working: ["Обработка", "Processing"],
  btn_starting: ["Запуск", "Starting"], btn_open: ["Открыть папку", "Open folder"],
  guide_one_title: ["Для обычной подготовки", "For regular preparation"],
  guide_one: ["Текущий метод с фиктивными аудиосэмплами. Подготовка видео до 1080p60.", "The current ghost sample method. Video preparation up to 1080p60."],
  guide_two_title: ["Когда можно подождать", "When you can wait a little"],
  guide_two: ["Тот же метод с более тщательным кодированием. Обработка дольше, файл может стать больше.", "The same method with more thorough encoding. Processing takes longer, and the file may be larger."],
  local_processing: ["Обработка на твоём компьютере", "Processed on your computer"], footer_note: ["Бесплатно для личного использования", "Free for personal use"],
  drop_now: ["Отпусти, чтобы добавить", "Drop to add videos"],
  queued: ["В очереди", "Queued"], probing: ["Анализ", "Analyzing"], processing: ["Кодирование", "Encoding"],
  done: ["Готово", "Done"], error: ["Ошибка", "Error"], cancelled: ["Отменено", "Cancelled"],
  patching: ["Контейнер", "Container"], remove: ["Убрать", "Remove"], show_error: ["Подробности ошибки", "Error details"],
  result: ["Готово: {n}", "Finished: {n}"], result_none: ["Готовых файлов пока нет", "No finished files yet"],
  progress: ["{done} из {total} / {percent}%", "{done} of {total} / {percent}%"],
  upload: ["Загрузка {i} из {n}: {name}", "Uploading {i} of {n}: {name}"],
  no_video: ["Нет поддерживаемых видеофайлов. Выбери MP4, MOV, MKV или WEBM.", "No supported videos. Choose MP4, MOV, MKV, or WEBM."],
  no_folder: ["В выбранной папке нет видео. Выбери другую папку.", "No videos in this folder. Choose another folder."],
  failed: ["{operation}: {reason}", "{operation}: {reason}"],
  probe_missing: ["Сервер не вернул данные файла", "The server returned no file data"],
  job_connection: ["Не удалось обновить прогресс: {reason}. Обработка может продолжаться; восстанавливаю связь.", "Could not refresh progress: {reason}. Processing may still be running; reconnecting."],
  job_missing: ["Сервер больше не хранит задачу {job}. Проверь папку результата перед повторным запуском. Очередь сохранена.", "The server no longer has job {job}. Check the output folder before retrying. Your queue is preserved."],
  start_uncertain: ["Ответ запуска не получен: {reason}. Нажми \"Повторить запуск\", чтобы восстановить ту же задачу.", "No start response: {reason}. Select \"Retry start\" to recover the same job."],
  retry_start: ["Повторить запуск", "Retry start"],
  server_restarted: ["Сервер был перезапущен. Итог прошлого запуска неизвестен: проверь папку результата перед новой обработкой.", "The server restarted. The previous outcome is unknown: check the output folder before processing again."],
  warning_mask_incomplete: ["Подпись кодировщика осталась в контейнере", "The encoder signature remains in the container"],
  close: ["Закрыть", "Close"], saved_job: ["Не удалось восстановить задачу: {reason}", "Could not restore the job: {reason}"], result_location: ["Где сохранён файл", "File location"],
};
let language = localStorage.getItem("lang") || (navigator.language.startsWith("ru") ? "ru" : "en");
if (!["ru", "en"].includes(language)) language = "ru";
const state = { queue: [], modes: [], mode: localStorage.getItem("mode") || "stealth", engine: false, running: false, starting: false, job: null, batch: [], out: "", uploading: false, pending: null };
const restartable = new Set(["queued", "error", "cancelled"]);
const rowNodes = new Map();
let pollTimer;
let uploadChain = Promise.resolve();
let uploadBatches = 0;

function t(key, values = {}) {
  let value = messages[key]?.[language === "ru" ? 0 : 1] || key;
  for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

function text(node, value) { if (node.textContent !== value) node.textContent = value; }
function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function icon(name) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("class", "ico"); node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(node.namespaceURI, "use"); use.setAttribute("href", `#i-${name}`); node.append(use);
  return node;
}
function showNotice(message = "") { text($("#notice-text"), message); $("#notice").hidden = !message; }
function report(operation, error) { showNotice(t("failed", { operation, reason: error.message || String(error) })); }

async function request(path, body, timeout = 15000) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`${path}: HTTP ${response.status}, invalid JSON`); }
  if (!response.ok || data.error) {
    const error = new Error(data.error || `${path}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function applyLanguage(value) {
  language = value; localStorage.setItem("lang", value); document.documentElement.lang = value;
  document.querySelectorAll("[data-i18n]").forEach(node => text(node, t(node.dataset.i18n)));
  document.querySelectorAll("[data-lang]").forEach(button => { const active = button.dataset.lang === value; button.classList.toggle("on", active); button.setAttribute("aria-pressed", String(active)); });
  $("#notice-close").setAttribute("aria-label", t("close"));
  $("#settings-close").setAttribute("aria-label", t("close"));
  $("#modes").setAttribute("aria-label", t("mode_choice"));
  $("#queue").setAttribute("aria-label", t("queue_title"));
  text($("#engine-text"), t(state.engine ? "engine_ready" : $("#engine").dataset.status || "engine_check"));
  renderModes(); render();
}

async function checkEngine() {
  try {
    const status = await request("/api/status");
    state.modes = status.modes || [];
    if (!state.modes.some(mode => mode.id === state.mode)) state.mode = status.default_mode;
    state.instance = status.instance_id || null;
    if (state.pending && state.pending.instance !== state.instance) {
      for (const item of state.queue) if (state.pending.body.paths.includes(item.path)) Object.assign(item, { status: "error", message: t("server_restarted") });
      state.pending = null; sessionStorage.removeItem("pending-job"); showNotice(t("server_restarted"));
    }
    const compatible = typeof status.instance_id === "string";
    state.engine = !!(status.ffmpeg && status.ffprobe && compatible);
    const engineStatus = !compatible ? "engine_restart" : state.engine ? "engine_ready" : "engine_missing";
    $("#engine").className = `engine ${state.engine ? "ok" : "bad"}`;
    $("#engine").dataset.status = engineStatus;
    text($("#engine-text"), t(engineStatus));
    text($("#foot-engine"), t(!compatible ? "engine_restart_help" : state.engine ? "local_processing" : "engine_help"));
  } catch (error) {
    state.engine = false; $("#engine").className = "engine bad"; $("#engine").dataset.status = "engine_offline";
    text($("#engine-text"), t("engine_offline"));
    $("#engine").title = `/api/status: ${error.message}`;
  }
  $("#btn-reconnect").hidden = state.engine;
  renderModes(); render();
  return state.engine;
}

function renderModes() {
  const container = $("#modes");
  const ids = state.modes.map(mode => mode.id).join(",");
  if (container.dataset.ids !== ids) {
    container.dataset.ids = ids;
    container.replaceChildren(...state.modes.map(mode => {
      const button = element("button", "mode");
      button.type = "button"; button.dataset.mode = mode.id; button.setAttribute("role", "radio");
      button.textContent = mode.label;
      return button;
    }));
  }
  const buttons = [...container.querySelectorAll("button")];
  buttons.forEach(button => {
    const mode = state.modes.find(item => item.id === button.dataset.mode);
    button.classList.toggle("on", mode.id === state.mode);
    button.setAttribute("aria-checked", String(mode.id === state.mode)); button.tabIndex = mode.id === state.mode ? 0 : -1;
    button.disabled = state.running || state.starting || !!state.pending;
  });
  container.style.setProperty("--mode-index", String(Math.max(0, state.modes.findIndex(mode => mode.id === state.mode))));
  const selected = state.modes.find(mode => mode.id === state.mode);
  text($("#mode-note"), t(`mode_${state.mode}_note`));
  text($("#mode-size"), selected ? t("up_to", { value: `${selected.max_short} x ${selected.max_long}` }) : "-");
  text($("#mode-fps"), selected?.max_fps ? t("up_to", { value: `${selected.max_fps} fps` }) : "-");
}

function fileSpec(info) {
  if (!info?.width) return "";
  return `${info.width}x${info.height} / ${Number((info.fps || 0).toFixed(2))} fps / ${(info.size / 1e6).toFixed(1)} MB`;
}
function createRow(item) {
  const row = element("li", "row");
  const name = element("div", "row-name"), meta = element("div", "row-meta"), side = element("div", "row-side"), status = element("span", "row-status");
  const remove = element("button", "icon-btn"); remove.type = "button"; remove.append(icon("close"));
  remove.addEventListener("click", () => { if (!state.running && !state.starting && !state.pending) { state.queue = state.queue.filter(file => file.path !== item.path); render(); } });
  side.append(status, remove);
  const bar = element("div", "row-bar"), fill = element("div", "row-bar-fill"); bar.append(fill);
  const error = element("details", "row-err"), summary = element("summary"), detail = element("pre"), warning = element("div", "row-warn"); error.append(summary, detail);
  row.append(icon("file"), name, side, meta, bar, error, warning);
  return { row, name, meta, status, remove, bar, fill, error, summary, detail, warning };
}

function render() {
  document.body.classList.toggle("has-files", state.queue.length > 0);
  $("#workspace").classList.toggle("is-processing", state.running);
  $("#workspace").classList.toggle("is-uploading", state.uploading);
  text($("#queue-count"), String(state.queue.length).padStart(2, "0"));
  const paths = new Set(state.queue.map(item => item.path));
  for (const [path, parts] of rowNodes) if (!paths.has(path)) {
    rowNodes.delete(path);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) parts.row.remove();
    else {
      parts.row.classList.add("leaving"); parts.row.setAttribute("aria-hidden", "true");
      parts.row.querySelectorAll("button").forEach(button => { button.disabled = true; });
      setTimeout(() => parts.row.remove(), 180);
    }
  }
  for (const item of state.queue) {
    if (!rowNodes.has(item.path)) { const parts = createRow(item); rowNodes.set(item.path, parts); $("#queue").append(parts.row); }
    const p = rowNodes.get(item.path);
    const previousStatus = p.row.dataset.status;
    p.row.className = `row ${item.status}`; p.row.title = item.path; p.row.dataset.status = item.status;
    p.row.querySelector(".ico use").setAttribute("href", item.status === "done" ? "#i-check" : "#i-file");
    if (previousStatus && previousStatus !== item.status && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      p.row.getAnimations().forEach(animation => animation.cancel());
      p.row.animate([{ opacity: .45, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 280, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
    text(p.name, item.name);
    text(p.status, item.status === "processing" ? `${t(item.progress >= .96 ? "patching" : "processing")} ${Math.round((item.progress || 0) * 100)}%` : t(item.status));
    const before = fileSpec(item.before || item.info), after = fileSpec(item.after);
    text(p.meta, after || before);
    p.remove.hidden = state.running || state.starting || !!state.pending; p.remove.setAttribute("aria-label", `${t("remove")}: ${item.name}`);
    p.bar.hidden = item.status !== "processing"; p.fill.style.width = `${Math.round((item.progress || 0) * 100)}%`;
    p.error.hidden = item.status !== "error"; text(p.summary, t("show_error")); text(p.detail, item.message || "");
    p.warning.hidden = !item.warning; text(p.warning, item.warning ? t(`warning_${item.warning}`) : "");
  }
  $("#empty").hidden = state.queue.length > 0;
  $("#queue-head").hidden = state.queue.length === 0;
  const locked = state.running || state.starting || !!state.pending;
  for (const id of ["#btn-files", "#btn-folder"]) $(id).disabled = locked;
  $("#ghost").disabled = locked;
  $("#modes").querySelectorAll("button").forEach(button => { button.disabled = locked; });
  const pending = state.queue.filter(item => restartable.has(item.status)).length;
  const adding = !pending && !state.pending && !state.running && !state.starting;
  $("#btn-start").dataset.action = adding ? "add" : "process";
  $("#btn-start").disabled = state.running || state.starting || (!adding && !state.engine) || state.uploading || state.queue.some(item => item.status === "probing");
  text($("#btn-start span"), t(state.starting ? "btn_starting" : state.running ? "btn_working" : state.pending ? "retry_start" : pending ? "btn_start_count" : "btn_choose", { n: pending }));
  $("#btn-clear").hidden = !state.queue.length && !state.running;
  $("#btn-clear").disabled = state.starting || (!state.queue.length && !state.running);
  $("#btn-clear").classList.toggle("danger", state.running || !!state.pending);
  text($("#btn-clear span"), t(state.running || state.pending ? "btn_cancel" : "btn_clear"));
  const completed = state.queue.filter(item => item.status === "done");
  $("#result").hidden = state.running || !completed.length || state.queue.some(item => ["queued", "probing"].includes(item.status));
  text($("#result-text"), completed.length ? t("result", { n: completed.length }) : t("result_none"));
  state.out = completed.at(-1)?.dst || ""; text($("#foot-out"), state.out); $("#btn-open").hidden = !state.out;
  $("#jobline").hidden = !state.running;
  if (state.running) {
    const batch = state.queue.filter(item => state.batch.includes(item.path));
    const finished = item => ["done", "error", "cancelled"].includes(item.status);
    const sum = batch.reduce((total, item) => total + (finished(item) ? 1 : item.progress || 0), 0);
    const percent = batch.length ? Math.round(sum * 100 / batch.length) : 0;
    $("#jobbar-fill").style.width = `${percent}%`;
    text($("#jobtext"), t("progress", { done: batch.filter(finished).length, total: batch.length, percent }));
  }
}

async function addPaths(paths) {
  const fresh = [...new Set(paths)].filter(path => typeof path === "string" && path && !state.queue.some(item => item.path === path));
  if (!fresh.length) return;
  for (const path of fresh) state.queue.push({ path, name: path.split(/[\\/]/).at(-1), status: "probing", progress: 0 });
  render();
  try {
    const result = await request("/api/probe", { paths: fresh });
    for (const [index, path] of fresh.entries()) {
      const item = state.queue.find(file => file.path === path);
      if (!item) continue;
      const info = result.files?.[index];
      if (!info || info.error) { item.status = "error"; item.message = info?.error || t("probe_missing"); }
      else { item.info = info; item.status = "queued"; }
    }
  } catch (error) {
    for (const item of state.queue) if (fresh.includes(item.path) && item.status === "probing") { item.status = "error"; item.message = `/api/probe: ${error.message}`; }
    report("/api/probe", error);
  }
  render();
}

async function browse(mode, button) {
  if (state.running || state.starting || state.pending) return;
  button.disabled = true; showNotice();
  try {
    const result = await request("/api/browse", { mode }, 120000);
    if (result.paths?.length) await addPaths(result.paths);
    else if (mode === "folder" && result.cancelled === false) showNotice(t("no_folder"));
  } catch (error) { report("/api/browse", error); }
  finally { button.disabled = false; render(); }
}

async function start(cancelAfterStart = false) {
  if (state.starting || state.running || state.uploading) return;
  const pendingRequest = state.pending;
  const batch = state.queue.filter(item => state.pending ? state.pending.body.paths.includes(item.path) : restartable.has(item.status));
  if (!batch.length) return;
  state.starting = true; showNotice(); render();
  try {
    if (!await checkEngine()) return;
    if (pendingRequest && !state.pending) return;
    if (!state.pending) {
      const body = { paths: batch.map(item => item.path), mode: state.mode, ghost: $("#ghost").checked ? 10 : 0, request_id: crypto.randomUUID().replaceAll("-", "") };
      state.pending = { body, queue: state.queue, mode: state.mode, instance: state.instance };
      sessionStorage.setItem("pending-job", JSON.stringify(state.pending));
    }
    const result = await request("/api/process", state.pending.body);
    if (!result.job) throw new Error("/api/process: missing job id");
    for (const item of batch) Object.assign(item, { status: "queued", progress: 0, message: "", warning: null, after: null, dst: null });
    state.job = result.job; state.batch = batch.map(item => item.path); state.running = true;
    state.pending = null; sessionStorage.removeItem("pending-job");
    sessionStorage.setItem("active-job", JSON.stringify({ job: state.job, batch: state.batch, queue: state.queue, mode: state.mode }));
    if (cancelAfterStart) {
      try { await request("/api/cancel", { job: state.job }); }
      catch (error) { report("/api/cancel", error); }
    }
    void poll();
  } catch (error) {
    if (error.status && error.status >= 400 && error.status < 500) { state.pending = null; sessionStorage.removeItem("pending-job"); }
    if (state.pending) showNotice(t("start_uncertain", { reason: error.message }));
    else report("/api/process", error);
    if (state.running) void poll();
  }
  finally { state.starting = false; render(); }
}

async function poll() {
  clearTimeout(pollTimer);
  const jobId = state.job;
  if (!jobId) return;
  try {
    const job = await request(`/api/job/${jobId}`);
    if (state.job !== jobId) return;
    if (!Array.isArray(job.files) || !job.status) throw new Error(`job ${jobId}: incomplete response`);
    for (const file of job.files) {
      const item = state.queue.find(entry => entry.path === file.src);
      if (item) Object.assign(item, file);
    }
    if (job.status !== "running") {
      state.running = false; state.job = null; sessionStorage.removeItem("active-job");
      showNotice(); render(); return;
    }
    if (poll.connectionError) { showNotice(); poll.connectionError = false; }
  } catch (error) {
    if (error.status === 404) {
      const message = t("job_missing", { job: jobId });
      for (const item of state.queue) if (state.batch.includes(item.path) && !["done", "error", "cancelled"].includes(item.status)) Object.assign(item, { status: "error", message });
      state.running = false; state.job = null; poll.connectionError = false;
      sessionStorage.removeItem("active-job"); showNotice(message); render(); return;
    }
    poll.connectionError = true;
    showNotice(t("job_connection", { reason: error.message }));
  }
  render(); pollTimer = setTimeout(poll, poll.connectionError ? 1500 : 500);
}

async function clearOrCancel() {
  if (state.starting) return;
  if (state.pending && !state.running) { await start(true); return; }
  if (!state.running) { state.queue = []; showNotice(); render(); return; }
  $("#btn-clear").disabled = true;
  try { await request("/api/cancel", { job: state.job }); }
  catch (error) { report("/api/cancel", error); }
  finally { render(); }
}

function uploadFiles(files) {
  if (state.running || state.starting || state.pending) { showNotice(t("failed", { operation: "/api/upload", reason: t("btn_working") })); return; }
  const supported = [...files].filter(file => /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|ts|mts|m2ts|3gp|mpe?g)$/i.test(file.name));
  if (!supported.length) { showNotice(t("no_video")); return; }
  uploadBatches++; state.uploading = true; render();
  uploadChain = uploadChain.then(async () => {
    for (const [index, file] of supported.entries()) {
      $("#upload").hidden = false; text($("#upload"), t("upload", { i: index + 1, n: supported.length, name: file.name }));
      try {
        const response = await fetch("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(300000) });
        const result = await response.json();
        if (!response.ok || result.error || !result.path) throw new Error(result.error || `HTTP ${response.status}, missing path`);
        await addPaths([result.path]);
      } catch (error) { report(`/api/upload (${file.name})`, error); }
    }
  }).finally(() => { uploadBatches--; state.uploading = uploadBatches > 0; $("#upload").hidden = !state.uploading; render(); });
}

$("#lang").addEventListener("click", event => { const button = event.target.closest("[data-lang]"); if (button) applyLanguage(button.dataset.lang); });
$("#ghost").checked = localStorage.getItem("ghost") !== "0";
$("#ghost").addEventListener("change", () => localStorage.setItem("ghost", $("#ghost").checked ? "1" : "0"));
function selectMode(id) { state.mode = id; localStorage.setItem("mode", id); renderModes(); }
$("#modes").addEventListener("click", event => { const button = event.target.closest("[data-mode]"); if (button && !state.running && !state.starting && !state.pending) selectMode(button.dataset.mode); });
$("#modes").addEventListener("keydown", event => {
  if (state.running || state.starting || state.pending || !state.modes.length || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); const count = state.modes.length, index = state.modes.findIndex(mode => mode.id === state.mode);
  const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + count) % count;
  selectMode(state.modes[next].id); $("#modes .on").focus();
});
$("#btn-files").addEventListener("click", event => browse("files", event.currentTarget));
$("#btn-folder").addEventListener("click", event => browse("folder", event.currentTarget));
$("#btn-start").addEventListener("click", event => {
  if (event.currentTarget.dataset.action === "add") void browse("files", event.currentTarget);
  else void start();
});
$("#btn-clear").addEventListener("click", clearOrCancel);
$("#btn-open").addEventListener("click", async () => { try { await request("/api/reveal", { path: state.out }); } catch (error) { report("/api/reveal", error); } });
$("#btn-reconnect").addEventListener("click", checkEngine); $("#notice-close").addEventListener("click", () => showNotice());
let dragDepth = 0;
window.addEventListener("dragenter", event => { event.preventDefault(); dragDepth++; $("#drop-veil").hidden = false; });
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#drop-veil").hidden = true; });
window.addEventListener("drop", event => { event.preventDefault(); dragDepth = 0; $("#drop-veil").hidden = true; uploadFiles(event.dataTransfer?.files || []); });
$("#btn-settings").addEventListener("click", () => $("#settings-dialog").showModal());
$("#settings-close").addEventListener("click", () => $("#settings-dialog").close());
$("#settings-dialog").addEventListener("click", event => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
});
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#settings-dialog").open) { showNotice(); dragDepth = 0; $("#drop-veil").hidden = true; } });
try {
  const pending = JSON.parse(sessionStorage.getItem("pending-job") || "null");
  if (pending?.body?.request_id && Array.isArray(pending.queue)) { state.pending = pending; state.queue = pending.queue; state.mode = pending.mode; showNotice(t("start_uncertain", { reason: "/api/process" })); }
  const saved = JSON.parse(sessionStorage.getItem("active-job") || "null");
  if (saved?.job && Array.isArray(saved.queue) && Array.isArray(saved.batch)) { Object.assign(state, saved, { running: true, pending: null }); sessionStorage.removeItem("pending-job"); void poll(); }
} catch (error) { sessionStorage.removeItem("active-job"); showNotice(t("saved_job", { reason: error.message })); }
applyLanguage(language); void checkEngine();
setInterval(() => { if (!state.running && !state.starting) void checkEngine(); }, 15000);
