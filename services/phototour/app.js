// ФотоТур онлайн: редактор целиком в браузере. Панорамы никуда не отправляются и нигде не сохраняются.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RAD = Math.PI / 180;
const r4 = (v) => Math.round(v * 10000) / 10000;

const project = { name: 'Мой фототур', start: null, groups: [], panos: [], plates: [], plan: null };
const files = new Map(); // путь внутри тура -> Blob
const urls = new Map();
const resolve = (rel) => {
  let u = urls.get(rel);
  if (!u) { const b = files.get(rel); if (!b) return ''; u = URL.createObjectURL(b); urls.set(rel, u); }
  return u;
};
const drop = (prefix) => { for (const k of [...files.keys()]) if (k.startsWith(prefix)) { files.delete(k); const u = urls.get(k); if (u) { URL.revokeObjectURL(u); urls.delete(k); } } };

let tour = null, licensee = null, busy = false, changed = false;
const cur = () => tour?.current || null;
const point = (id) => project.plan?.points.find((m) => m.pano === id) || null;
const touch = () => { changed = true; };
window.addEventListener('beforeunload', (e) => { if (changed && project.panos.length) { e.preventDefault(); e.returnValue = ''; } });

function nextId(used, prefix, width) { for (let i = 1; ; i++) { const id = prefix + String(i).padStart(width, '0'); if (!used.includes(id)) return id; } }
function setJob(text, value, cls = '') {
  const box = $('#job');
  if (text == null) { box.hidden = true; return; }
  box.hidden = false; box.className = cls;
  box.innerHTML = (cls ? '<button class="x" title="Скрыть">×</button>' : '') + text + (value != null ? `<div class="bar"><i style="width:${(value * 100).toFixed(1)}%"></i></div>` : '');
  box.querySelector('.x')?.addEventListener('click', () => { box.hidden = true; });
}

// ---------- нарезка панорамы на тайлы прямо в браузере ----------
function planLevels(w) {
  let cols = 4;
  while (cols < 64 && w / cols > 1024) cols *= 2;
  const tile = Math.floor(w / cols / 2) * 2;
  const levels = [];
  for (let c = cols; c >= 4; c /= 2) levels.unshift({ w: tile * c, cols: c, rows: c / 2 });
  return levels;
}
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const toJpeg = (c, quality) => (c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality }) : new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('не удалось сжать изображение'))), 'image/jpeg', quality)));

async function buildPano(file, id, onProgress) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('браузер не смог открыть изображение (возможно, оно слишком большое для этого устройства)'); }
  const W = bmp.width, H = bmp.height;
  if (W < 512 || H < 256) { bmp.close(); throw new Error(`слишком маленькое изображение: ${W}×${H}`); }
  const stretched = Math.abs(W / H - 2) > 0.02;
  const levels = planLevels(W);
  const total = levels.reduce((s, l) => s + l.cols * l.rows, 0) + 2;
  let done = 0;
  const put = async (rel, canvas, q) => { files.set(`panos/${id}/${rel}`, await toJpeg(canvas, q)); onProgress(++done / total); };
  const whole = async (w, h, rel, q) => { const c = makeCanvas(w, h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, W, H, 0, 0, w, h); await put(rel, c, q); };
  try {
    await whole(Math.min(2048, levels.at(-1).w), Math.min(1024, levels.at(-1).w / 2), 'b.jpg', 0.8);
    await whole(320, 160, 't.jpg', 0.78);
    for (let li = levels.length - 1; li >= 0; li--) {
      const L = levels[li], ts = L.w / L.cols, sw = W / L.cols, sh = H / L.rows;
      const c = makeCanvas(ts, ts), x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      for (let r = 0; r < L.rows; r++) for (let col = 0; col < L.cols; col++) {
        x.drawImage(bmp, col * sw, r * sh, sw, sh, 0, 0, ts, ts);
        await put(`${li + 1}/${col}_${r}.jpg`, c, 0.86);
      }
    }
  } finally { bmp.close(); }
  return { w: W, h: H, levels, ...(stretched ? { stretched: true } : {}) };
}

async function addPanos(list) {
  const imgs = [...list].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  if (!imgs.length || busy) return;
  busy = true; $('#btnAdd').disabled = true;
  const gname = $('#grp').value.trim() || 'Группа 1';
  const warn = [];
  let first = null;
  for (let i = 0; i < imgs.length; i++) {
    const f = imgs[i], id = nextId(project.panos.map((p) => p.id), 'p', 3);
    const label = `<b>Обработка панорам</b>: ${i + 1} из ${imgs.length} — ${esc(f.name)}`;
    setJob(label, i / imgs.length);
    try {
      const info = await buildPano(f, id, (v) => setJob(label, (i + v) / imgs.length));
      const pano = { id, name: f.name.replace(/\.[^.]+$/, ''), ...info, view: { yaw: 0, pitch: 0, fov: 90 }, heading: 0, links: [], zones: [] };
      if (pano.stretched) warn.push(`${esc(pano.name)}: изображение ${pano.w}×${pano.h} не 2:1, растянуто на полную сферу`);
      project.panos.push(pano);
      let g = project.groups.find((x) => x.name === gname);
      if (!g) { g = { id: nextId(project.groups.map((x) => x.id), 'g', 1), name: gname, panos: [] }; project.groups.push(g); }
      g.panos.push(id);
      if (!project.start) project.start = id;
      first ||= id; touch();
    } catch (e) { drop(`panos/${id}/`); warn.push(`${esc(f.name)}: ${esc(e.message)}`); }
  }
  busy = false; $('#btnAdd').disabled = false;
  if (warn.length) setJob(`<b>Панорамы добавлены, но есть замечания:</b><ul>${warn.map((w) => `<li>${w}</li>`).join('')}</ul>`, null, first ? 'ok' : 'err'); else setJob(null);
  // новый Tour сам открывает project.start; повторный goto обрывал загрузку и оставлял «Загрузка…»
  if (first) { if (tour) tour.goto(first); else ensureTour(); }
  renderAll();
}

function ensureTour() {
  if (tour) return;
  $('#viewer').innerHTML = '';
  tour = new PhotoTour.Tour($('#viewer'), project, { resolve, ui: false, hash: false, editing: true });
  tour.on('pano', () => { renderAll(); $('#list .on')?.scrollIntoView({ block: 'nearest' }); });
  tour.viewer.addEventListener('position-updated', cone);
  tour.viewer.addEventListener('zoom-updated', cone);
}

// ---------- список, панель панорамы ----------
function renderAll() { renderList(); renderPano(); renderPlan(); const has = project.panos.length > 0; $('#btnView').disabled = !has; $('#btnExport').disabled = !has; $('#panoBar').hidden = !has; }
function renderList() {
  const c = cur();
  $('#list').innerHTML = project.groups.filter((g) => g.panos.length).map((g) => `<div class="g">${esc(g.name)}</div>` + g.panos.map((pid) => {
    const p = project.panos.find((x) => x.id === pid);
    return `<button class="it${c?.id === pid ? ' on' : ''}" data-p="${pid}" title="${esc(p.name)}"><img src="${resolve(`panos/${pid}/t.jpg`)}" alt=""><span>${esc(p.name)}</span><i class="${point(pid) ? 'has' : ''}" title="${point(pid) ? 'Есть точка на плане' : 'Нет точки на плане'}"></i></button>`;
  }).join('')).join('');
}
$('#list').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b && tour) tour.goto(b.dataset.p); };
function renderPano() {
  const p = cur(); if (!p) return;
  if (document.activeElement !== $('#panoName')) $('#panoName').value = p.name;
  const v = p.view || {};
  $('#panoInfo').textContent = `Стартовый вид: поворот ${(+v.yaw || 0).toFixed(0)}°, наклон ${(+v.pitch || 0).toFixed(0)}°, угол ${(+v.fov || 90).toFixed(0)}°` + (project.start === p.id ? ' · первая в туре' : '');
  $('#head').value = $('#headN').value = +(p.heading || 0).toFixed(1);
  const m = point(p.id);
  $('#btnPtDel').disabled = !m; $('#btnPtView').disabled = !m;
  $('#btnPtView').textContent = m?.view ? 'Сбросить вид при переходе с плана' : 'Запомнить вид при переходе с плана';
  $('#btnPtView').title = m?.view ? 'Сейчас по щелчку на этой точке плана панорама открывается с запомненным видом. Сбросить — будет открываться со стартовым видом.' : 'По щелчку на этой точке плана панорама откроется так, как она повёрнута сейчас. Если не задавать — со стартовым видом.';
  $('#lblHead').style.opacity = m ? 1 : .45;
}
$('#tname').oninput = () => { project.name = $('#tname').value.trim() || 'Фототур'; touch(); };
$('#panoName').oninput = () => { const p = cur(); if (!p) return; p.name = $('#panoName').value.trim() || p.name; touch(); renderList(); };
$('#btnStartView').onclick = () => { const p = cur(); if (!p) return; p.view = tour.getView(); touch(); renderPano(); };
$('#btnStartPano').onclick = () => { const p = cur(); if (!p) return; project.start = p.id; touch(); renderPano(); };
$('#btnPanoDel').onclick = () => {
  const p = cur(); if (!p || busy) return;
  if (!confirm(`Убрать панораму «${p.name}» из тура?`)) return;
  project.panos = project.panos.filter((x) => x.id !== p.id);
  project.groups.forEach((g) => { g.panos = g.panos.filter((x) => x !== p.id); });
  if (project.plan) project.plan.points = project.plan.points.filter((m) => m.pano !== p.id);
  if (project.start === p.id) project.start = project.panos[0]?.id || null;
  drop(`panos/${p.id}/`); touch();
  if (project.panos.length) tour.goto(project.start);
  else { tour.destroy(); tour = null; $('#viewer').innerHTML = '<div id="welcome"><h2>В туре нет панорам</h2><p>Добавьте панорамы кнопкой слева или перетащите файлы сюда.</p></div>'; }
  renderAll();
};
const setHead = (v) => { const p = cur(); if (!p || !Number.isFinite(v)) return; p.heading = Math.max(-180, Math.min(180, v)); $('#head').value = p.heading; $('#headN').value = p.heading; touch(); cone(); };
$('#head').oninput = () => setHead(+$('#head').value);
$('#headN').onchange = () => setHead(+$('#headN').value);

// ---------- добавление файлов ----------
$('#btnAdd').onclick = () => $('#fPanos').click();
$('#fPanos').onchange = () => { addPanos($('#fPanos').files); $('#fPanos').value = ''; };
const vw = $('#viewer');
['dragenter', 'dragover'].forEach((t) => vw.addEventListener(t, (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); vw.classList.add('drop'); } }));
['dragleave', 'drop'].forEach((t) => vw.addEventListener(t, (e) => { if (t === 'drop' || e.target === vw) vw.classList.remove('drop'); }));
vw.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addPanos(e.dataTransfer.files); });

// ---------- план ----------
function fitPlan() {
  const plan = project.plan; if (!plan?.file) return;
  const w = $('#planWrap'), k = Math.min((w.clientWidth - 16) / plan.w, (w.clientHeight - 16) / plan.h);
  $('#planImg').style.width = plan.w * k + 'px'; $('#planImg').style.height = plan.h * k + 'px';
}
new ResizeObserver(fitPlan).observe($('#planWrap'));
function renderPlan() {
  const plan = project.plan, has = !!plan?.file;
  $('#planEmpty').hidden = has; $('#planImg').hidden = !has;
  $('#btnPlan').textContent = has ? 'Заменить план…' : 'Загрузить план…';
  $('#planHint').textContent = has ? 'Выберите панораму слева и щёлкните по плану — её точка встанет туда. Точки можно перетаскивать.' : '';
  if (!has) return;
  const src = resolve(plan.file);
  if ($('#planPic').getAttribute('src') !== src) $('#planPic').src = src;
  fitPlan();
  const c = cur();
  $('#pts').innerHTML = plan.points.map((m) => { const p = project.panos.find((x) => x.id === m.pano); return `<b data-m="${m.id}" class="${c?.id === m.pano ? 'on' : ''}" style="left:${m.x * 100}%;top:${m.y * 100}%" title="${esc(p?.name || '')}"></b>`; }).join('');
  cone();
}
function cone() {
  const c = cur(), m = c && point(c.id), el = $('#cone');
  el.style.display = m ? '' : 'none';
  if (!m) return;
  const dir = (c.heading || 0) - (project.plan.heading || 0) + tour.viewer.getPosition().yaw / RAD;
  const half = Math.min(85, (tour.viewer.state.hFov || 60) / 2) * RAD, r = 100;
  el.querySelector('path').setAttribute('d', `M0 0 L${-r * Math.sin(half)} ${-r * Math.cos(half)} A${r} ${r} 0 0 1 ${r * Math.sin(half)} ${-r * Math.cos(half)} Z`);
  el.style.left = m.x * 100 + '%'; el.style.top = m.y * 100 + '%';
  el.style.transform = `translate(-50%,-50%) rotate(${dir}deg)`;
}
const frac = (e) => { const r = $('#planImg').getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
let drag = null;
$('#planImg').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const b = e.target.closest('[data-m]');
  if (b) { drag = { m: project.plan.points.find((x) => x.id === b.dataset.m), el: b, x0: e.clientX, y0: e.clientY, moved: false }; b.setPointerCapture(e.pointerId); return; }
  const c = cur(); if (!c) return;
  const [x, y] = frac(e), m = point(c.id);
  if (m) { m.x = r4(x); m.y = r4(y); } else project.plan.points.push({ id: nextId(project.plan.points.map((q) => q.id), 'm', 2), x: r4(x), y: r4(y), pano: c.id, view: null });
  touch(); renderAll();
});
$('#planImg').addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
  drag.moved = true;
  const [x, y] = frac(e); drag.m.x = r4(x); drag.m.y = r4(y);
  drag.el.style.left = x * 100 + '%'; drag.el.style.top = y * 100 + '%';
  if (cur()?.id === drag.m.pano) cone();
});
$('#planImg').addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved) { touch(); renderPlan(); } else if (cur()?.id !== d.m.pano) tour.goto(d.m.pano, d.m.view || null);
});
$('#btnPtDel').onclick = () => { const c = cur(); if (!c || !point(c.id)) return; project.plan.points = project.plan.points.filter((m) => m.pano !== c.id); touch(); renderAll(); };
$('#btnPtView').onclick = () => { const m = cur() && point(cur().id); if (!m) return; m.view = m.view ? null : tour.getView(); touch(); renderPano(); };
$('#btnPlan').onclick = () => $('#fPlan').click();
$('#fPlan').onchange = async () => {
  const f = $('#fPlan').files[0]; $('#fPlan').value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f); const w = bmp.width, h = bmp.height; bmp.close();
    const ext = /png$/i.test(f.type) || /\.png$/i.test(f.name) ? 'png' : /webp/i.test(f.type) ? 'webp' : 'jpg';
    const old = project.plan;
    if (old?.points.length && Math.abs(old.w / old.h - w / h) > 0.01 && !confirm('У нового плана другие пропорции — точки сместятся. Оставить точки?')) old.points = [];
    drop('plan/');
    files.set(`plan/plan.${ext}`, f);
    project.plan = { file: `plan/plan.${ext}`, w, h, heading: old?.heading || 0, points: old?.points || [] };
    touch(); renderAll();
  } catch { alert('Не удалось открыть картинку плана. Нужен файл PNG или JPG.'); }
};

// ---------- данные тура, просмотр ----------
function tourData() {
  const ids = new Set(project.panos.map((p) => p.id));
  return {
    name: project.name, start: ids.has(project.start) ? project.start : project.panos[0]?.id || null,
    groups: project.groups.filter((g) => g.panos.length).map((g) => ({ id: g.id, name: g.name, panos: g.panos })),
    panos: project.panos.map((p) => ({ id: p.id, name: p.name, w: p.w, levels: p.levels, view: p.view, heading: p.heading || 0, links: [], zones: [] })),
    plates: [], plan: project.plan ? { ...project.plan, points: project.plan.points.filter((m) => ids.has(m.pano)) } : null,
    ...(licensee ? {} : { badge: true }),
  };
}
let pv = null;
$('#btnView').onclick = () => {
  $('#preview').hidden = false;
  const t = tourData(); t.start = cur()?.id || t.start;
  pv = new PhotoTour.Tour($('#pvStage'), t, { resolve, hash: false });
};
const closePv = () => { if (pv) { pv.destroy(); pv = null; } $('#preview').hidden = true; };
$('#pvClose').onclick = closePv;

// ---------- лицензия ----------
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function checkKey(key) {
  const parts = key.trim().split('.');
  if (parts.length !== 2 || !window.LICENSE_PUB || !crypto.subtle) return null;
  try {
    const pub = await crypto.subtle.importKey('jwk', window.LICENSE_PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const name = b64u(parts[0]);
    return (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u(parts[1]), name)) ? new TextDecoder().decode(name) : null;
  } catch { return null; }
}
function showLic() {
  $('#lic').className = licensee ? 'ok' : '';
  $('#lic').textContent = licensee ? `Лицензия: ${licensee}` : 'Бесплатная версия';
  $('#btnKey').textContent = licensee ? 'Лицензия' : 'Убрать плашку';
}
$('#btnKey').onclick = () => { $('#keyMsg').textContent = licensee ? `Ключ применён: ${licensee}. Плашки на туре не будет.` : ''; $('#keyMsg').style.color = ''; $('#dKey').showModal(); };
$('#keyOk').onclick = async () => {
  const key = $('#keyIn').value, name = await checkKey(key);
  if (!name) { $('#keyMsg').textContent = 'Ключ не подошёл. Проверьте, что он вставлен целиком.'; $('#keyMsg').style.color = '#a4262c'; return; }
  licensee = name; try { localStorage.setItem('phototour-key', key.trim()); } catch { /* без сохранения */ }
  showLic(); $('#keyMsg').textContent = `Ключ применён: ${name}. Плашки на туре не будет.`; $('#keyMsg').style.color = '#1a7f37';
};

// ---------- экспорт ----------
let assets = null;
async function playerFiles() {
  if (!assets) {
    assets = [];
    for (const f of ['index.html', 'player.js', 'player.css']) {
      const r = await fetch('player/' + f, { cache: 'no-cache' });
      if (!r.ok) throw new Error('не удалось загрузить файлы плеера');
      assets.push([f, await r.blob()]);
    }
  }
  return assets;
}
async function tourFiles() {
  const out = [...(await playerFiles()), ['tour.json', new Blob([JSON.stringify(tourData())], { type: 'application/json' })]];
  for (const [k, v] of files) out.push([k, v]);
  return out;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** ZIP без сжатия (JPEG всё равно не сжимается). */
async function makeZip(list, onProgress) {
  if (list.length > 65000) throw new Error('слишком много файлов для одного архива');
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let pos = 0;
  for (let i = 0; i < list.length; i++) {
    const [name, blob] = list[i], nb = enc.encode(name), crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, blob.size, true); h.setUint32(22, blob.size, true); h.setUint16(26, nb.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, blob.size, true); c.setUint32(24, blob.size, true); c.setUint16(28, nb.length, true); c.setUint32(42, pos, true);
    parts.push(h, nb, blob); central.push(c, nb);
    pos += 30 + nb.length + blob.size;
    if (pos > 0xF0000000) throw new Error('тур больше 3,7 ГБ — в один архив не помещается');
    if (i % 25 === 0) onProgress(i / list.length);
  }
  const cdSize = central.reduce((s, x) => s + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, list.length, true); e.setUint16(10, list.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, pos, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}

/** Один файл для Windows: [просмотрщик][файлы][индекс][подпись, смещение, длина]. */
async function makeExe(list, onProgress) {
  const r = await fetch('viewer-win-x64.exe');
  if (!r.ok) throw new Error('на сайте нет файла просмотрщика (viewer-win-x64.exe)');
  const total = +r.headers.get('Content-Length') || 0, reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) onProgress(got / total); }
  const stub = new Blob(chunks);
  let pos = stub.size; const index = {};
  for (const [name, blob] of list) { index[name] = [pos, blob.size]; pos += blob.size; }
  if (pos > 3.9 * 1024 ** 3) throw new Error('тур больше 3,9 ГБ — Windows не запустит такой файл');
  const idx = new TextEncoder().encode(JSON.stringify({ name: project.name, files: index }));
  const foot = new DataView(new ArrayBuffer(32));
  [...'PHOTOTOUR-DATA-1'].forEach((ch, i) => foot.setUint8(i, ch.charCodeAt(0)));
  foot.setBigUint64(16, BigInt(pos), true); foot.setBigUint64(24, BigInt(idx.length), true);
  return new Blob([stub, ...list.map((x) => x[1]), idx, foot], { type: 'application/octet-stream' });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
$('#btnExport').onclick = () => { $('#expName').value = project.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'tour'; $('#expMsg').textContent = licensee ? '' : 'Бесплатная версия: на туре будет плашка «Сделано в „ФотоТур“ · tiscompany.ru». Убрать её можно ключом.'; $('#expMsg').style.color = ''; $('#dExp').showModal(); };
async function doExport(kind) {
  const name = $('#expName').value.trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) { $('#expMsg').textContent = 'В имени нельзя использовать \\ / : * ? " < > |'; $('#expMsg').style.color = '#a4262c'; return; }
  if (busy) return;
  busy = true; $('#dExp').close();
  const label = kind === 'zip' ? '<b>Сборка архива</b>' : '<b>Сборка файла .exe</b> (загрузка просмотрщика, около 85 МБ)';
  try {
    setJob(label, 0);
    const list = await tourFiles();
    const blob = kind === 'zip' ? await makeZip(list, (v) => setJob(label, v)) : await makeExe(list, (v) => setJob(label, v));
    download(blob, name + (kind === 'zip' ? '.zip' : '.exe'));
    changed = false;
    setJob(`<b>Готово</b>: «${esc(name)}${kind === 'zip' ? '.zip' : '.exe'}» (${Math.round(blob.size / 1048576)} МБ) сохраняется в папку загрузок.` + (kind === 'zip' ? ' Распакуйте архив и загрузите папку на хостинг; двойным кликом по index.html тур не откроется — нужен веб-сервер.' : ' Windows может предупредить о неизвестной программе: «Подробнее» → «Выполнить в любом случае».'), null, 'ok');
  } catch (e) { setJob('<b>Не получилось</b>: ' + esc(e.message), null, 'err'); }
  busy = false;
}
$('#expZip').onclick = () => doExport('zip');
$('#expExe').onclick = () => doExport('exe');

(async () => {
  try { const k = localStorage.getItem('phototour-key'); if (k) licensee = await checkKey(k); } catch { /* нет доступа к хранилищу */ }
  showLic(); renderAll();
})();
