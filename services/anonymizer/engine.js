// Движок обезличивателя для браузера.
// Ядро поиска — тот же anonymizer_core.py, что в программе для Windows (через Pyodide).
// PDF читает и правит MuPDF.js: найденный текст удаляется из файла и закрывается чёрной плашкой.
// Работает целиком в памяти вкладки: файлы никуда не отправляются.

export const SIGN = (w, h) => !(h < 18 || w < 50 || h > 350 || w > 900) && w / h >= 1.4 && w / h <= 8;

export class Engine {
  constructor(mupdf, py) {
    this.mupdf = mupdf;
    this.py = py;
    this.docs = new Map(); // id -> {kind, name, bytes, ...}
  }

  call(fn, ...args) {
    const f = this.py.globals.get("web_bridge")[fn];
    const r = f(...args);
    return typeof r === "string" ? r : r;
  }
  json(fn, ...args) {
    return JSON.parse(this.call(fn, ...args));
  }

  configure(cfg) {
    this.call("configure", JSON.stringify(cfg));
  }

  // ---------------------------------------------------------------- PDF
  pdfChars(page) {
    const chars = [];
    const st = page.toStructuredText("preserve-whitespace,preserve-ligatures");
    st.walk({
      onChar(c, origin, font, size, quad) {
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        chars.push([c, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      },
    });
    if (st.destroy) st.destroy();
    return chars;
  }

  pdfImages(page) {
    const out = [];
    const st = page.toStructuredText("preserve-images");
    st.walk({
      onImageBlock(bbox, transform, image) {
        let w = 0, h = 0;
        try { w = image.getWidth(); h = image.getHeight(); } catch (e) { /* нет размеров */ }
        out.push({ rect: [bbox[0], bbox[1], bbox[2], bbox[3]], w, h });
      },
    });
    if (st.destroy) st.destroy();
    return out;
  }

  scanPdf(id, name, bytes, onPage) {
    const doc = this.mupdf.Document.openDocument(bytes, "application/pdf");
    const n = doc.countPages();
    const pages = [], charPages = [];
    for (let i = 0; i < n; i++) {
      const pg = doc.loadPage(i);
      const b = pg.getBounds();
      const chars = this.pdfChars(pg);
      const bounds = [b[0], b[1], b[2], b[3]];
      const area = Math.max((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]), 1);
      const images = this.pdfImages(pg)
        .filter((im) => (im.rect[2] - im.rect[0]) * (im.rect[3] - im.rect[1]) <= area * 0.7)
        .map((im, k) => ({ ...im, key: `${i}:${k}`, sign: SIGN(im.w, im.h) }));
      pages.push({ page: i, bounds, images, chars: chars.length });
      charPages.push(chars);
      if (pg.destroy) pg.destroy();
      if (onPage) onPage(i + 1, n);
    }
    const hits = JSON.parse(this.call("pdf_scan", id, JSON.stringify(charPages)));
    hits.forEach((h, i) => { pages[i].hits = h.hits; pages[i].textLen = h.chars; });
    this.docs.set(id, { kind: "pdf", name, bytes, pages });
    if (doc.destroy) doc.destroy();
    return pages;
  }

  refreshPdf(id) {
    const d = this.docs.get(id);
    const hits = JSON.parse(this.call("pdf_hits", id));
    hits.forEach((h, i) => { d.pages[i].hits = h.hits; });
    return d.pages;
  }

  renderPage(id, i, zoom) {
    const d = this.docs.get(id);
    const doc = this.mupdf.Document.openDocument(d.bytes, "application/pdf");
    const pg = doc.loadPage(i);
    const pix = pg.toPixmap(this.mupdf.Matrix.scale(zoom, zoom), this.mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pix.asPNG();
    if (pix.destroy) pix.destroy();
    if (pg.destroy) pg.destroy();
    if (doc.destroy) doc.destroy();
    return png;
  }

  // sel: {rejected:Set(key), manualRects:{page:[rect]}, images:Set(key)}
  applyPdf(id, sel) {
    const m = this.mupdf;
    const d = this.docs.get(id);
    const doc = m.Document.openDocument(d.bytes, "application/pdf");
    const pdf = doc.asPDF ? doc.asPDF() : doc;
    const P = m.PDFPage;
    const stats = {}, hidden = new Set();
    for (const p of d.pages) {
      const pg = pdf.loadPage(p.page);
      // 1) отмеченные картинки (подписи, печати) — удаляются целиком
      const pics = p.images.filter((im) => sel.images.has(im.key));
      if (pics.length) {
        for (const im of pics) {
          const a = pg.createAnnotation("Redact");
          a.setRect(im.rect);
        }
        pg.applyRedactions(true, P.REDACT_IMAGE_REMOVE, P.REDACT_LINE_ART_NONE, P.REDACT_TEXT_REMOVE);
        stats["КАРТИНКА"] = (stats["КАРТИНКА"] || 0) + pics.length;
      }
      // 2) найденный текст — удаляется из файла
      const plates = [];
      let count = 0;
      for (const h of p.hits) {
        if (sel.rejected.has(h.key)) continue;
        const a = pg.createAnnotation("Redact");
        a.setRect(h.ink);
        plates.push(h.plate);
        hidden.add(h.val);
        stats[h.cat] = (stats[h.cat] || 0) + 1;
        count++;
      }
      // 3) рамки, нарисованные вручную
      const hand = (sel.manualRects[p.page] || []);
      for (const r of hand) {
        const a = pg.createAnnotation("Redact");
        a.setRect(r);
        plates.push(r);
      }
      if (hand.length) stats["ОБЛАСТЬ"] = (stats["ОБЛАСТЬ"] || 0) + hand.length;
      if (count || hand.length) {
        pg.applyRedactions(false, P.REDACT_IMAGE_PIXELS, P.REDACT_LINE_ART_REMOVE_IF_COVERED, P.REDACT_TEXT_REMOVE);
      }
      // 4) чёрные плашки нужной высоты — поверх удалённого
      for (const r of plates.concat(pics.map((im) => im.rect))) {
        const a = pg.createAnnotation("Square");
        a.setRect(r);
        a.setColor([0, 0, 0]);
        a.setInteriorColor([0, 0, 0]);
        a.setBorderWidth(0);
        a.update();
      }
      if (pg.destroy) pg.destroy();
    }
    // плашки впечатываются в страницу: в готовом файле нет аннотаций, которые можно сдвинуть
    try { pdf.bake(true, true); } catch (e) { /* старая версия MuPDF.js */ }
    for (const k of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) {
      try { pdf.setMetaData("info:" + k, ""); } catch (e) { /* нет поля */ }
    }
    const buf = pdf.saveToBuffer("garbage=4,compress,sanitize");
    const out = buf.asUint8Array().slice();
    if (doc.destroy) doc.destroy();
    // контрольный прогон по готовому файлу
    const check = m.Document.openDocument(out, "application/pdf");
    const texts = [];
    for (let i = 0; i < check.countPages(); i++) {
      const pg = check.loadPage(i);
      texts.push(this.pdfChars(pg));
      if (pg.destroy) pg.destroy();
    }
    if (check.destroy) check.destroy();
    this.call("set_hidden", JSON.stringify([...hidden]));
    const control = JSON.parse(this.call("pdf_control", JSON.stringify(texts)));
    return { bytes: out, stats, control, hidden: [...hidden] };
  }

  // ---------------------------------------------------------- Word, Excel, текст
  scanOffice(id, name, bytes) {
    const path = `/work/${id}_${name}`;
    this.py.FS.writeFile(path, bytes);
    const r = JSON.parse(this.call("text_scan", path));
    this.docs.set(id, { kind: "office", name, path, text: r.text, ents: r.ents });
    return r;
  }

  refreshOffice(id) {
    const d = this.docs.get(id);
    const r = JSON.parse(this.call("text_hits", d.path));
    d.text = r.text; d.ents = r.ents;
    return r;
  }

  applyOffice(id, rejected) {
    const d = this.docs.get(id);
    this.configure({ rejected: [...rejected] });
    const out = d.path.replace(/(\.[^.]+)$/, "_out$1");
    const r = JSON.parse(this.call("office_apply", d.path, out));
    const bytes = this.py.FS.readFile(out);
    return { bytes, stats: r.stats, control: r.control, hidden: r.hidden };
  }

  safeName(stem) {
    return this.call("anonymize_name", stem);
  }
}

export async function loadPython(pyodide, base, onStep) {
  onStep && onStep("Загружаю библиотеки для Word и Excel…");
  await pyodide.loadPackage(["lxml", "micropip"]);
  const micropip = pyodide.pyimport("micropip");
  const wheels = ["et_xmlfile-2.0.0-py3-none-any.whl", "openpyxl-3.1.5-py2.py3-none-any.whl",
    "typing_extensions-4.16.0-py3-none-any.whl", "python_docx-1.2.0-py3-none-any.whl"];
  for (const w of wheels) await micropip.install.callKwargs(base + "wheels/" + w, { deps: false });
  onStep && onStep("Загружаю правила поиска…");
  pyodide.FS.mkdirTree("/work");
  pyodide.FS.mkdirTree("/app");
  for (const f of ["anonymizer_core.py", "web_bridge.py"]) {
    const src = await (await fetch(base + "py/" + f + "?v=" + (globalThis.APP_VERSION || ""))).text();
    pyodide.FS.writeFile("/app/" + f, src);
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/app'); import web_bridge");
}
