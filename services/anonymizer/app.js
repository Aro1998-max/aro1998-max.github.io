// Обезличиватель документов — страница сервиса.
import { Engine, loadPython } from "./engine.js?v=2";

// Все библиотеки лежат рядом со страницей: сервис не зависит от внешних CDN,
// а после первого открытия работает и без интернета (см. sw.js).
const BASE = new URL(".", import.meta.url).href;
const PYODIDE = BASE + "lib/pyodide/";
const MUPDF = BASE + "lib/mupdf/mupdf.js";
const JSZIP = BASE + "lib/jszip.min.js";
const MAX_BYTES = 60 * 1024 * 1024;
const BLOCK = "██████";

const COLORS = {
  "ФИО": "#3b46b8", "ОРГ": "#9a6208", "ОБЪЕКТ": "#a81448", "КАДАСТР": "#22662a", "СУММА": "#b45309",
  "НОМЕР": "#6d34a3", "ЛОГИН": "#2d3a86", "ИНН": "#0b6b5c", "КПП": "#0b6b5c", "ОГРН": "#0b6b5c",
  "БИК": "#0b6b5c", "СЧЁТ": "#0b6b5c", "СНИЛС": "#982954", "ПАСПОРТ": "#982954", "ТЕЛ": "#175f92",
  "EMAIL": "#175f92", "САЙТ": "#175f92", "АДРЕС": "#2f6c22", "ШИФР": "#6d34a3", "ДОГОВОР": "#6d34a3",
  "ДАТА": "#4a5260", "ЧИСЛО": "#4a5260", "ЦИФРЫ": "#4a5260", "РУЧНОЕ": "#a81448",
};
const col = (c) => COLORS[c] || "#4a5260";
const tint = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const S = {
  eng: null, files: [], cur: null, rejected: new Set(), manual: {}, images: {}, undo: [],
  zoom: "fit", cats: null, enabled: null, words: [], results: [],
};

// ------------------------------------------------------------------ загрузка модулей
let booting = null;
function boot() {
  if (booting) return booting;
  $("#boot").classList.remove("hidden");
  const step = (t) => { $("#bootText").textContent = t; };
  booting = (async () => {
    step("Загружаю модуль PDF…");
    const mupdf = await import(MUPDF);
    step("Загружаю модуль поиска (около 25 МБ, только первый раз — дальше работает и без интернета)…");
    await loadScript(PYODIDE + "pyodide.js");
    const py = await globalThis.loadPyodide({ indexURL: PYODIDE });
    await loadPython(py, BASE, step);
    S.eng = new Engine(mupdf, py);
    S.cats = JSON.parse(S.eng.call("categories"));
    S.enabled = new Set(S.cats.on);
    $("#boot").classList.add("hidden");
  })();
  booting.catch((e) => {
    step("Не удалось загрузить модуль: " + e.message + ". Обновите страницу.");
    booting = null;
  });
  return booting;
}
function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error("нет связи с " + new URL(src).host));
    document.head.appendChild(s);
  });
}
const pause = () => new Promise((r) => setTimeout(r, 0));
function status(t) { $("#status").textContent = t; }

// ------------------------------------------------------------------ добавление файлов
async function addFiles(list) {
  const arr = [...list];
  if (!arr.length) return;
  await boot();
  $("#start").classList.add("hidden");
  $("#work").classList.remove("hidden");
  for (const file of arr) {
    const ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    const f = { id: Math.random().toString(36).slice(2, 10), name: file.name, ext, err: "" };
    S.files.push(f);
    renderFiles();
    if (file.size > MAX_BYTES) { f.err = "файл больше 60 МБ"; renderFiles(); continue; }
    if (![".pdf", ".docx", ".xlsx", ".xlsm", ".txt", ".md", ".csv"].includes(ext)) {
      f.err = { ".doc": "сохраните как .docx", ".xls": "сохраните как .xlsx", ".rtf": "сохраните как .docx" }[ext]
        || "этот формат не поддерживается";
      renderFiles(); continue;
    }
    status(`Читаю ${file.name}…`);
    await pause();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ext === ".pdf") {
        f.kind = "pdf";
        f.pages = S.eng.scanPdf(f.id, f.name, bytes, (i, n) => status(`Читаю ${file.name}: лист ${i} из ${n}`));
        S.images[f.id] = new Set(f.pages.flatMap((p) => p.images.filter((im) => im.sign).map((im) => im.key)));
        S.manual[f.id] = {};
      } else {
        f.kind = "text";
        const r = S.eng.scanOffice(f.id, f.name, bytes);
        f.text = r.text; f.ents = r.ents;
      }
    } catch (e) {
      f.err = "не удалось прочитать: " + (e.message || e).toString().split("\n").slice(-2).join(" ");
    }
    renderFiles();
    if (!S.cur && !f.err) select(f.id);
  }
  // значения, найденные в одном файле, ищутся во всех
  refreshAll();
  status(`Документов: ${S.files.length}. Проверьте список справа и нажмите «Обезличить».`);
}

function refreshAll() {
  for (const f of S.files) {
    if (f.err || !f.kind) continue;
    if (f.kind === "pdf") f.pages = S.eng.refreshPdf(f.id);
    else { const r = S.eng.refreshOffice(f.id); f.text = r.text; f.ents = r.ents; }
  }
  renderAll();
}

function hitsOf(f) {
  if (f.kind === "pdf") return f.pages.flatMap((p) => p.hits);
  return f.ents || [];
}

// ------------------------------------------------------------------ отрисовка
function renderAll() { renderFiles(); renderView(); renderFound(); }

function renderFiles() {
  const ul = $("#fileList");
  ul.innerHTML = "";
  for (const f of S.files) {
    const li = document.createElement("li");
    li.className = f.id === S.cur ? "on" : "";
    const n = f.kind ? new Set(hitsOf(f).filter((h) => !S.rejected.has(h.key)).map((h) => h.key)).size : "";
    li.innerHTML = `<span class="fn" title="${esc(f.name)}">${esc(f.name)}</span><span class="fc">${f.kind ? n : f.err ? "" : "…"}</span>`
      + (f.err ? `<span class="x">${esc(f.err)}</span>` : "");
    li.onclick = () => { if (!f.err && f.kind) select(f.id); };
    ul.appendChild(li);
  }
}

function select(id) {
  S.cur = id;
  S.zoom = "fit";
  renderAll();
  $("#view").scrollTop = 0;
}

let observer = null;
function renderView() {
  const view = $("#view");
  const f = S.files.find((x) => x.id === S.cur);
  view.innerHTML = "";
  view.classList.toggle("res", $("#asResult").checked);
  $("#warn").classList.add("hidden");
  if (!f) { $("#docTitle").textContent = "—"; return; }
  $("#docTitle").textContent = f.name;
  if (f.kind === "pdf") return renderPdf(f, view);
  $("#pageInfo").textContent = "";
  $("#zLbl").textContent = "";
  const div = document.createElement("div");
  div.className = "textdoc";
  const t = f.text || "";
  let pos = 0, html = "";
  for (const e of (f.ents || []).slice().sort((a, b) => a.s - b.s)) {
    if (e.s < pos) continue;
    html += esc(t.slice(pos, e.s));
    const off = S.rejected.has(e.key);
    html += `<mark data-key="${esc(e.key)}" class="${off ? "off" : ""}" style="background:${tint(col(e.cat), .16)};color:${col(e.cat)}" title="${esc(S.cats.names[e.cat] || e.cat)} — клик: ${off ? "скрыть" : "оставить"}">${esc(t.slice(e.s, e.e))}</mark>`;
    pos = e.e;
  }
  html += esc(t.slice(pos));
  div.innerHTML = html || "<i>В документе нет текста</i>";
  div.onclick = (ev) => { const m = ev.target.closest("mark"); if (m) toggleKey(m.dataset.key); };
  view.appendChild(div);
}

function pdfZoom(f) {
  const w = Math.max(...f.pages.map((p) => p.bounds[2] - p.bounds[0]));
  const avail = $("#view").clientWidth - 40;
  return S.zoom === "fit" ? Math.max(0.3, Math.min(3, avail / w)) : S.zoom;
}

function renderPdf(f, view) {
  const z = pdfZoom(f);
  $("#zLbl").textContent = S.zoom === "fit" ? "по ширине" : Math.round(z * 100) + "%";
  const empty = f.pages.filter((p) => p.chars < 20).length;
  if (empty) {
    $("#warn").textContent = `Листов без текстового слоя: ${empty}. Если это скан — текст на нём не распознаётся, закройте нужное рамкой мышью.`;
    $("#warn").classList.remove("hidden");
  }
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((items) => {
    for (const it of items) {
      if (!it.isIntersecting) continue;
      const el = it.target;
      observer.unobserve(el);
      drawPageImage(f, +el.dataset.page, el, z);
    }
  }, { root: view, rootMargin: "600px 0px" });
  for (const p of f.pages) {
    const [bx0, by0, bx1, by1] = p.bounds;
    const el = document.createElement("div");
    el.className = "page";
    el.dataset.page = p.page;
    el.style.width = (bx1 - bx0) * z + "px";
    el.style.height = (by1 - by0) * z + "px";
    const ov = document.createElement("div");
    ov.className = "ov";
    const box = (r, cls) => {
      const d = document.createElement("div");
      d.className = cls;
      d.style.left = (r[0] - bx0) * z + "px"; d.style.top = (r[1] - by0) * z + "px";
      d.style.width = Math.max(2, (r[2] - r[0]) * z) + "px"; d.style.height = Math.max(2, (r[3] - r[1]) * z) + "px";
      ov.appendChild(d);
      return d;
    };
    for (const im of p.images) {
      const on = S.images[f.id].has(im.key);
      const d = box(im.rect, "img" + (on ? " on" : ""));
      d.title = on ? "Картинка будет закрыта — клик, чтобы оставить" : "Картинка останется — клик, чтобы закрыть";
      d.onmousedown = (e) => e.stopPropagation();
      d.onclick = (e) => { e.stopPropagation(); pushUndo(); on ? S.images[f.id].delete(im.key) : S.images[f.id].add(im.key); renderAll(); };
    }
    for (const h of p.hits) {
      const off = S.rejected.has(h.key);
      const d = box(h.plate, "hit" + (off ? " off" : ""));
      d.style.background = tint(col(h.cat), .34);
      d.style.color = col(h.cat);
      d.title = `${S.cats.names[h.cat] || h.cat}: ${h.val}\nклик — ${off ? "скрыть" : "оставить"}`;
      d.onmousedown = (e) => e.stopPropagation();
      d.onclick = (e) => { e.stopPropagation(); toggleKey(h.key); };
    }
    (S.manual[f.id][p.page] || []).forEach((r, k) => {
      const d = box(r, "man");
      d.title = "Область будет закрыта — клик, чтобы убрать";
      d.onmousedown = (e) => e.stopPropagation();
      d.onclick = (e) => { e.stopPropagation(); pushUndo(); S.manual[f.id][p.page].splice(k, 1); renderAll(); };
    });
    ov.onmousedown = (e) => startRubber(e, f, p, ov, z);
    el.appendChild(ov);
    const no = document.createElement("span");
    no.className = "no"; no.textContent = `лист ${p.page + 1}`;
    el.appendChild(no);
    view.appendChild(el);
    observer.observe(el);
  }
  view.onscroll = () => {
    const pages = view.querySelectorAll(".page");
    let cur = 0;
    for (const el of pages) { if (el.offsetTop - view.offsetTop <= view.scrollTop + view.clientHeight * .35) cur = +el.dataset.page; }
    $("#pageInfo").textContent = `лист ${cur + 1} из ${f.pages.length}`;
  };
  view.onscroll();
}

const imgCache = new Map();
function drawPageImage(f, i, el, z) {
  const key = `${f.id}:${i}:${z.toFixed(3)}`;
  let url = imgCache.get(key);
  if (!url) {
    const scale = z * (window.devicePixelRatio || 1);
    const png = S.eng.renderPage(f.id, i, Math.min(scale, 4));
    url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    imgCache.set(key, url);
  }
  const img = document.createElement("img");
  img.src = url; img.alt = "";
  el.insertBefore(img, el.firstChild);
}

function startRubber(e, f, p, ov, z) {
  if (e.button !== 0) return;
  const r0 = ov.getBoundingClientRect();
  const x0 = e.clientX - r0.left, y0 = e.clientY - r0.top;
  const rb = document.createElement("div");
  rb.className = "rubber";
  ov.appendChild(rb);
  const move = (ev) => {
    const x1 = ev.clientX - r0.left, y1 = ev.clientY - r0.top;
    Object.assign(rb.style, { left: Math.min(x0, x1) + "px", top: Math.min(y0, y1) + "px",
      width: Math.abs(x1 - x0) + "px", height: Math.abs(y1 - y0) + "px" });
  };
  const up = (ev) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    rb.remove();
    const x1 = ev.clientX - r0.left, y1 = ev.clientY - r0.top;
    if (Math.abs(x1 - x0) < 5 || Math.abs(y1 - y0) < 5) return;
    const [bx0, by0] = p.bounds;
    const r = [Math.min(x0, x1) / z + bx0, Math.min(y0, y1) / z + by0, Math.max(x0, x1) / z + bx0, Math.max(y0, y1) / z + by0];
    pushUndo();
    (S.manual[f.id][p.page] ||= []).push(r);
    const top = $("#view").scrollTop;
    renderAll();
    $("#view").scrollTop = top;
    status("Область будет закрыта чёрной плашкой. Клик по ней — убрать.");
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function renderFound() {
  const box = $("#foundList");
  const groups = new Map();
  for (const f of S.files) {
    if (!f.kind) continue;
    for (const h of hitsOf(f)) {
      const g = groups.get(h.cat) || new Map();
      const v = g.get(h.key) || { val: h.val, n: 0 };
      v.n++;
      g.set(h.key, v);
      groups.set(h.cat, g);
    }
  }
  let total = 0, on = 0;
  box.innerHTML = "";
  const order = Object.keys(S.cats.names);
  for (const cat of [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const g = groups.get(cat);
    const keys = [...g.keys()];
    const onN = keys.filter((k) => !S.rejected.has(k)).length;
    total += keys.length; on += onN;
    const div = document.createElement("div");
    div.className = "cat";
    const head = document.createElement("label");
    head.className = "cat-h";
    head.innerHTML = `<input type="checkbox" ${onN ? "checked" : ""}><span class="sw" style="background:${col(cat)}"></span><span style="color:${col(cat)}">${esc(S.cats.names[cat] || cat)}</span><span class="muted">${onN} из ${keys.length}</span>`;
    head.querySelector("input").onchange = (e) => {
      pushUndo();
      keys.forEach((k) => (e.target.checked ? S.rejected.delete(k) : S.rejected.add(k)));
      renderAll();
    };
    div.appendChild(head);
    for (const k of keys) {
      const v = g.get(k);
      const off = S.rejected.has(k);
      const row = document.createElement("label");
      row.className = "val" + (off ? " off" : "");
      row.innerHTML = `<input type="checkbox" ${off ? "" : "checked"}><span>${esc(v.val.replace(/\s+/g, " "))}</span>${v.n > 1 ? `<span class="n">×${v.n}</span>` : ""}`;
      row.querySelector("input").onchange = () => toggleKey(k);
      div.appendChild(row);
    }
    box.appendChild(div);
  }
  if (!total) box.innerHTML = '<p class="muted" style="padding:10px 14px">Пока ничего не найдено.</p>';
  $("#foundCount").textContent = total ? `${on} из ${total}` : "";
}

// ------------------------------------------------------------------ правки и отмена
function pushUndo() {
  S.undo.push({ rejected: new Set(S.rejected), manual: JSON.stringify(S.manual),
    images: Object.fromEntries(Object.entries(S.images).map(([k, v]) => [k, [...v]])) });
  if (S.undo.length > 100) S.undo.shift();
}
function doUndo() {
  const u = S.undo.pop();
  if (!u) { status("Отменять нечего"); return; }
  S.rejected = u.rejected;
  S.manual = JSON.parse(u.manual);
  S.images = Object.fromEntries(Object.entries(u.images).map(([k, v]) => [k, new Set(v)]));
  const top = $("#view").scrollTop;
  renderAll();
  $("#view").scrollTop = top;
  status("Отменено предыдущее действие");
}
function toggleKey(k) {
  pushUndo();
  S.rejected.has(k) ? S.rejected.delete(k) : S.rejected.add(k);
  const top = $("#view").scrollTop;
  renderAll();
  $("#view").scrollTop = top;
}

// ------------------------------------------------------------------ настройки
function openRules() {
  const box = $("#catBoxes");
  box.innerHTML = "";
  for (const [k, name] of Object.entries(S.cats.names)) {
    if (k === "РУЧНОЕ") continue;
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" value="${k}" ${S.enabled.has(k) ? "checked" : ""}> ${esc(name)}`
      + (k === "ЦИФРЫ" ? ' <span class="muted">(закрасит размеры и отметки)</span>' : "");
    box.appendChild(l);
  }
  $("#manualWords").value = S.words.join("\n");
  $("#dlgRules").showModal();
}
async function applyRules() {
  S.enabled = new Set([...$("#catBoxes").querySelectorAll("input:checked")].map((i) => i.value));
  S.enabled.add("РУЧНОЕ");
  S.words = $("#manualWords").value.split("\n").map((s) => s.trim()).filter((s) => s.length >= 2);
  status("Ищу заново по новым правилам…");
  await pause();
  S.eng.configure({ enabled: [...S.enabled], manual: S.words });
  refreshAll();
  status("Готово: список обновлён");
}

// ------------------------------------------------------------------ обезличивание
async function applyAll() {
  const todo = S.files.filter((f) => f.kind && !f.err);
  if (!todo.length) return;
  $("#btnApply").disabled = true;
  S.results = [];
  try {
    for (const [i, f] of todo.entries()) {
      status(`Обезличиваю ${i + 1} из ${todo.length}: ${f.name}`);
      await pause();
      let r;
      if (f.kind === "pdf") {
        S.eng.configure({ rejected: [...S.rejected] });
        r = S.eng.applyPdf(f.id, { rejected: S.rejected, manualRects: S.manual[f.id] || {}, images: S.images[f.id] || new Set() });
      } else {
        r = S.eng.applyOffice(f.id, S.rejected);
      }
      const stem = f.name.replace(/\.[^.]+$/, "");
      const name = S.eng.safeName(stem) + "_обезл" + (f.kind === "text" && ![".docx", ".xlsx", ".xlsm"].includes(f.ext) ? ".txt" : f.ext);
      S.results.push({ name, src: f.name, bytes: r.bytes, stats: r.stats, control: r.control });
    }
  } catch (e) {
    alert("Ошибка при обработке: " + e.message);
  } finally {
    $("#btnApply").disabled = false;
  }
  showDone();
  status("Готово. Скачайте файлы в окне результата.");
}

function report() {
  const d = new Date();
  const lines = [`Обезличивание документов — ${d.toLocaleString("ru-RU")}`, "",
    "Найденные данные удалены из файлов и закрыты чёрной плашкой.", "Обработка выполнена в браузере, файлы на сервер не отправлялись.", "", "Файлы:"];
  for (const r of S.results) {
    const st = Object.entries(r.stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    lines.push(`  ${r.name} — закрыто: ${Object.values(r.stats).reduce((a, b) => a + b, 0)}${st ? ` (${st})` : ""}`);
  }
  lines.push("");
  const bad = S.results.flatMap((r) => r.control.map((c) => `  ${r.name}, стр. ${c.page}: «${c.value}»`));
  if (!bad.length) lines.push("Контрольный прогон: чисто — исходных значений в файлах не найдено");
  else lines.push("Контрольный прогон: эти фразы всё ещё читаются. Откройте файл и закройте их рамкой.", ...bad);
  return lines.join("\n") + "\n";
}

function mime(name) {
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.xls[xm]$/.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "text/plain;charset=utf-8";
}

function showDone() {
  const box = $("#doneList");
  box.innerHTML = "";
  for (const r of S.results) {
    const n = Object.values(r.stats).reduce((a, b) => a + b, 0);
    const url = URL.createObjectURL(new Blob([r.bytes], { type: mime(r.name) }));
    const row = document.createElement("div");
    row.className = "done-row";
    row.innerHTML = `<span class="nm">${esc(r.name)}</span><a class="btn primary" href="${url}" download="${esc(r.name)}">Скачать</a>`
      + `<span class="st">закрыто мест: ${n}</span>`
      + (r.control.length
        ? `<span class="bad">Контрольный прогон: ещё читается ${r.control.slice(0, 4).map((c) => `«${esc(c.value)}» (стр. ${c.page})`).join(", ")} — закройте рамкой</span>`
        : '<span class="ok">✓ Контрольный прогон: исходных значений в файле нет</span>');
    box.appendChild(row);
  }
  $("#dlgDone").showModal();
}

async function downloadZip() {
  await loadScript(JSZIP);
  const zip = new globalThis.JSZip();
  for (const r of S.results) zip.file(r.name, r.bytes);
  zip.file("Отчёт.txt", report());
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Обезличено_${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
}

// ------------------------------------------------------------------ события
function wire() {
  const onPick = (e) => { addFiles(e.target.files); e.target.value = ""; };
  $("#pick").onchange = onPick;
  $("#pick2").onchange = onPick;
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  document.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
  drop.addEventListener("mouseenter", () => boot(), { once: true });
  $("#btnUndo").onclick = doUndo;
  $("#btnRules").onclick = openRules;
  $("#rulesOk").onclick = () => { setTimeout(applyRules, 0); };
  $("#asResult").onchange = () => $("#view").classList.toggle("res", $("#asResult").checked);
  $("#btnApply").onclick = applyAll;
  $("#dlZip").onclick = downloadZip;
  const keepTop = (fn) => () => {
    const v = $("#view");
    const frac = v.scrollTop / Math.max(1, v.scrollHeight);
    fn();
    renderView();
    v.scrollTop = frac * v.scrollHeight;
  };
  $("#zIn").onclick = keepTop(() => { const f = S.files.find((x) => x.id === S.cur); if (f && f.kind === "pdf") S.zoom = Math.min(3, pdfZoom(f) * 1.2); });
  $("#zOut").onclick = keepTop(() => { const f = S.files.find((x) => x.id === S.cur); if (f && f.kind === "pdf") S.zoom = Math.max(0.3, pdfZoom(f) / 1.2); });
  $("#zFit").onclick = keepTop(() => { S.zoom = "fit"; });
  // Ctrl+Z по коду клавиши — работает и в русской раскладке
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      doUndo();
    }
  });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S.zoom === "fit") renderView(); }, 200); });
}
wire();

// офлайн-режим: после первого открытия страница и библиотеки берутся из кэша браузера
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register(BASE + "sw.js?v=" + (globalThis.APP_VERSION || "")).catch(() => {});
}
