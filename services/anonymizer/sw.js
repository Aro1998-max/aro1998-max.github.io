// Кэш для работы без интернета: всё, что сервис загрузил один раз, дальше берётся из браузера.
const VERSION = "anon-3";
const CORE = ["./", "index.html", "style.css", "app.js", "engine.js", "py/anonymizer_core.py", "py/web_bridge.py",
  "lib/jszip.min.js", "lib/mupdf/mupdf.js", "lib/mupdf/mupdf-wasm.js", "lib/mupdf/mupdf-wasm.wasm",
  "lib/pyodide/pyodide.js", "lib/pyodide/pyodide.mjs", "lib/pyodide/pyodide.asm.mjs", "lib/pyodide/pyodide.asm.wasm",
  "lib/pyodide/python_stdlib.zip", "lib/pyodide/pyodide-lock.json",
  "lib/pyodide/lxml-6.1.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
  "wheels/et_xmlfile-2.0.0-py3-none-any.whl", "wheels/openpyxl-3.1.5-py2.py3-none-any.whl",
  "wheels/typing_extensions-4.16.0-py3-none-any.whl", "wheels/python_docx-1.2.0-py3-none-any.whl"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Сначала сеть (чтобы обновления доходили), без сети — из кэша. Параметр ?v= не учитываем.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
