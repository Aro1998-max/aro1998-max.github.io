/* Конструктор EIR — вывод блоков документа в PDF (pdfmake, шрифт Roboto). */
(function (root) {
  'use strict';
  var EIR = root.EIR = root.EIR || {};
  var PAGE_W = 595.28, ML = 70.9, MR = 42.5, MT = 56.7, MB = 56.7, CW = PAGE_W - ML - MR;
  var ACC = '#de7a3a';

  function runs(text) {
    var parts = String(text == null ? '' : text).split('**'), out = [];
    parts.forEach(function (p, i) { if (p) out.push(i % 2 ? { text: p, bold: true } : p); });
    return out.length === 1 && typeof out[0] === 'string' ? out[0] : out;
  }

  function table(b) {
    var n = b.cols.length, sum = b.cols.reduce(function (a, c) { return a + c.w; }, 0);
    var avail = CW - n * 8 - (n + 1) * 0.6;
    var widths = b.cols.map(function (c) { return Math.floor(c.w / sum * avail * 10) / 10; });
    var fs = b.small ? 8 : 9, body = [];
    var head = b.cols.some(function (c) { return c.h; });
    if (head) body.push(b.cols.map(function (c) { return { text: c.h || '', bold: true, fillColor: '#E7EAEE', fontSize: fs, alignment: c.align || 'left' }; }));
    b.rows.forEach(function (r) {
      if (r && r.group) {
        var g = [{ text: r.group, bold: true, colSpan: n, fillColor: '#F4F5F7', fontSize: fs }];
        for (var i = 1; i < n; i++) g.push({});
        body.push(g); return;
      }
      body.push(r.map(function (c) {
        if (Array.isArray(c)) return { stack: c.map(function (t) { return { text: runs(t) }; }), fontSize: fs };
        if (c && typeof c === 'object') { var o = { text: runs(c.text), colSpan: c.span || 1, fontSize: fs }; if (c.fill) o.fillColor = '#' + c.fill; if (c.align) o.alignment = c.align; return o; }
        return { text: runs(c), fontSize: fs };
      }));
    });
    return {
      table: { headerRows: head ? 1 : 0, widths: widths, body: body, dontBreakRows: true },
      layout: { hLineWidth: function () { return 0.6; }, vLineWidth: function () { return 0.6; }, hLineColor: function () { return '#9AA1AA'; }, vLineColor: function () { return '#9AA1AA'; },
        paddingTop: function () { return b.matrix ? 3 : 2; }, paddingBottom: function () { return b.matrix ? 3 : 2; } },
      margin: [0, 2, 0, 8], alignment: 'left'
    };
  }

  function content(blocks, pages) {
    var out = [], hid = 0, toc = [];
    blocks.forEach(function (b) { if (b.t === 'h1' || b.t === 'h2') toc.push(b); });
    blocks.forEach(function (b) {
      switch (b.t) {
        case 'title':
          b.lines.forEach(function (l, i) { out.push({ text: l || ' ', style: i === 0 ? 'title' : 'subtitle' }); });
          break;
        case 'h1': if (!b.nobreak) out.push({ text: '', pageBreak: 'after' }); out.push({ text: b.text, style: 'h1', id: 'h' + (++hid) }); break;
        case 'h2': out.push({ text: b.text, style: 'h2', id: 'h' + (++hid) }); break;
        case 'h3': out.push({ text: b.text, style: 'h3' }); break;
        case 'p': out.push(b.style === 'Note' ? { text: runs(b.text), style: 'note' } : { text: runs(b.text), style: 'p' }); break;
        case 'note': out.push({ text: runs(b.text), style: 'note' }); break;
        case 'center': out.push({ text: runs(b.text), alignment: 'center', margin: [0, 0, 0, 4] }); break;
        case 'bullets':
          out.push({ ul: b.items.map(function (t) { return { text: runs(t), margin: [0, 0, 0, 2] }; }), type: 'none', margin: [20, 0, 0, 6],
            style: 'li', markerColor: '#555' });
          break;
        case 'table': out.push(table(b)); break;
        case 'pb': out.push({ text: '', pageBreak: 'after' }); break;
        case 'spacer': out.push({ text: ' ', margin: [0, (b.h || 1200) / 20, 0, 0] }); break;
        case 'box':
          out.push({ table: { widths: ['*'], body: [[{ text: runs(b.text), fontSize: 9.5, color: '#5a3a14', fillColor: '#FBEBD9', margin: [6, 5, 6, 5] }]] },
            layout: { hLineWidth: function () { return 0.8; }, vLineWidth: function () { return 0.8; }, hLineColor: function () { return ACC; }, vLineColor: function () { return ACC; } }, margin: [0, 6, 0, 8] });
          break;
        case 'toc':
          out.push({ text: 'Содержание', style: 'tocTitle', pageBreak: 'before' });
          toc.forEach(function (h, k) {
            var pg = pages && pages['h' + (k + 1)] || 0, l2 = h.t === 'h2';
            out.push({ columns: [
              { text: h.text, linkToPage: pg || undefined, fontSize: l2 ? 9.5 : 10, margin: [l2 ? 14 : 0, 0, 0, 0] },
              { text: String(pg || 0), linkToPage: pg || undefined, width: 28, alignment: 'right', fontSize: l2 ? 9.5 : 10 }
            ], margin: [0, 0, 0, 3] });
          });
          break;
      }
    });
    // маркер «–» для списков без стандартных точек
    out.forEach(function (x) { if (x.ul) x.ul.forEach(function (li) { li.text = ['–  '].concat(Array.isArray(li.text) ? li.text : [li.text]); }); });
    return out;
  }

  /* opts: {title, footer, watermark} → Promise<Blob> */
  EIR.makePdf = function (blocks, opts) {
    opts = opts || {};
    var hasToc = blocks.some(function (b) { return b.t === 'toc'; });
    function dd(pages, rec) { return {
      pageSize: 'A4', pageMargins: [ML, MT, MR, MB],
      info: { title: opts.title || '', creator: 'Конструктор EIR · tiscompany.ru', producer: 'Конструктор EIR' },
      content: content(blocks, pages),
      pageBreakBefore: rec ? function (node) { if (node.id && node.startPosition) rec[node.id] = node.startPosition.pageNumber; return false; } : undefined,
      footer: function (cur, total) {
        return { text: (opts.footer ? opts.footer + '   ·   ' : '') + 'стр. ' + cur + ' из ' + total, alignment: 'center', fontSize: 7.5, color: '#8A6A3A', margin: [ML, 20, MR, 0] };
      },
      defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.18, color: '#14181f' },
      styles: {
        title: { fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 10] },
        subtitle: { fontSize: 12, alignment: 'center', margin: [0, 0, 0, 5] },
        h1: { fontSize: 13.5, bold: true, margin: [0, 0, 0, 10] },
        h2: { fontSize: 11.5, bold: true, margin: [0, 10, 0, 5] },
        h3: { fontSize: 10.5, bold: true, italics: true, margin: [0, 6, 0, 3] },
        p: { alignment: 'justify', leadingIndent: 20, margin: [0, 0, 0, 5] },
        note: { fontSize: 9, italics: true, color: '#555B66', margin: [0, 2, 0, 3] },
        li: { alignment: 'justify' },
        tocTitle: { fontSize: 13.5, bold: true, alignment: 'center', margin: [0, 0, 0, 12] }
      }
    }; }
    function finish(d) {
      if (opts.watermark) d.watermark = { text: opts.watermark, color: ACC, opacity: 0.13, bold: true, fontSize: 40 };
      if (opts.lock) {
        d.ownerPassword = opts.lock;
        d.permissions = { printing: 'highResolution', modifying: false, copying: false, annotating: true, fillingForms: false, contentAccessibility: true, documentAssembly: false };
      }
      return d;
    }
    return new Promise(function (res, rej) {
      try {
        if (!hasToc) { root.pdfMake.createPdf(finish(dd())).getBlob(res); return; }
        var rec = {};
        // первый проход — узнаём страницы разделов, второй — содержание со ссылками на них
        root.pdfMake.createPdf(dd(null, rec)).getBuffer(function () {
          try { root.pdfMake.createPdf(finish(dd(rec))).getBlob(res); } catch (e) { rej(e); }
        });
      } catch (e) { rej(e); }
    });
  };

  EIR.FREE_WM = 'tiscompany.ru · бесплатная версия';

  /* Бесплатный комплект: EIR и шаблон ПИМ в PDF */
  EIR.buildFree = async function (s) {
    var code = (s.obj.code || 'OBJ').toUpperCase(), z = new root.JSZip();
    var o = { footer: EIR.FREE_MARK, watermark: EIR.FREE_WM, lock: 'tis-eir-' + code };
    var eir = await EIR.makePdf(EIR.buildEIR(s, { free: true }), Object.assign({ title: 'EIR — ' + (s.obj.name || code) }, o));
    var pim = await EIR.makePdf(EIR.buildPIM(s, { free: true }), Object.assign({ title: 'ПИМ — ' + (s.obj.name || code) }, o));
    z.file('EIR_' + code + '.pdf', eir);
    z.file('PIM_' + code + '.pdf', pim);
    return z.generateAsync({ type: 'blob' });
  };
})(typeof window !== 'undefined' ? window : globalThis);
