// Просмотр 3D-моделей: IFC, SKP, glTF/GLB, OBJ, DAE. Всё считается в браузере.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const BASE = new URL('./', import.meta.url).href;

// ---------- сцена ----------
const host = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f4);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1e6);
camera.position.set(10, 8, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 2, 1.4);
scene.add(sun);
const grid = new THREE.GridHelper(1, 20, 0xb9c2cc, 0xd6dce2);
grid.visible = false;
scene.add(grid);
const root = new THREE.Group();
scene.add(root);
const hlGroup = new THREE.Group();
scene.add(hlGroup);
const measureGroup = new THREE.Group();
scene.add(measureGroup);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------- состояние ----------
let model = null; // { kind, name, units, ifc?: {api, id, buckets, ranges}, objects? }
let selected = null;
const bbox = new THREE.Box3();

function status(t, kind = '') { const s = $('#status'); s.textContent = t || ''; s.className = kind; }
function busy(on, text = '') { $('#busy').hidden = !on; $('#busyText').textContent = text; }

function clearModel() {
  clearSelection(); clearMeasure();
  root.traverse((o) => { if (o.geometry) o.geometry.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
  root.clear();
  if (model?.ifc) { try { model.ifc.api.CloseModel(model.ifc.id); } catch {} }
  model = null;
  $('#tree').innerHTML = ''; $('#props').innerHTML = '<p class="hint">Выберите элемент на модели или в дереве.</p>';
  $('#info').textContent = '';
}

// ---------- камера ----------
function fit(dir = new THREE.Vector3(1, 0.8, 1)) {
  bbox.setFromObject(root);
  if (bbox.isEmpty()) return;
  const c = bbox.getCenter(new THREE.Vector3());
  const r = bbox.getSize(new THREE.Vector3()).length() / 2 || 1;
  // на узком (портретном) экране вписываем по горизонтали
  const vh = THREE.MathUtils.degToRad(camera.fov / 2), hh = Math.atan(Math.tan(vh) * camera.aspect);
  const d = r / Math.sin(Math.min(vh, hh)) * 1.05;
  camera.near = Math.max(r / 1000, 0.01); camera.far = r * 100; camera.updateProjectionMatrix();
  camera.position.copy(c).add(dir.clone().normalize().multiplyScalar(d));
  controls.target.copy(c); controls.update();
  grid.scale.setScalar(r * 4); grid.position.set(c.x, bbox.min.y, c.z); grid.visible = true;
}
document.querySelectorAll('[data-viewdir]').forEach((b) => b.onclick = () => {
  const v = { iso: [1, 0.8, 1], top: [0, 1, 0.0001], front: [0, 0, 1], side: [1, 0, 0] }[b.dataset.viewdir];
  fit(new THREE.Vector3(...v));
});

// ---------- сечение ----------
const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
let clipAxis = 'off', clipFlip = false;
function applyClip() {
  if (clipAxis === 'off' || bbox.isEmpty()) { renderer.clippingPlanes = []; $('#clipPos').disabled = true; return; }
  $('#clipPos').disabled = false;
  const i = { x: 0, y: 1, z: 2 }[clipAxis];
  const lo = bbox.min.getComponent(i), hi = bbox.max.getComponent(i);
  const t = +$('#clipPos').value / 1000;
  const pos = lo + (hi - lo) * t;
  const n = new THREE.Vector3(); n.setComponent(i, clipFlip ? 1 : -1);
  clip.normal.copy(n); clip.constant = clipFlip ? -pos : pos;
  renderer.clippingPlanes = [clip];
}
$('#clipAxis').onchange = (e) => { clipAxis = e.target.value; applyClip(); };
$('#clipPos').oninput = applyClip;
$('#clipFlip').onclick = () => { clipFlip = !clipFlip; applyClip(); };

// ---------- выбор ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const hit = pick(e); if (measuring) { measureClick(hit); return; }
  if (!hit) { clearSelection(); return; }
  if (model?.ifc) selectIfc(idFromHit(hit)); else selectObject(hit.object);
});
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(root.children, true).filter((h) => h.object.visible && (clipAxis === 'off' || clip.distanceToPoint(h.point) >= -1e-6));
  return hits[0] || null;
}
const hlMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
function clearSelection() {
  hlGroup.children.forEach((m) => m.geometry.dispose()); hlGroup.clear();
  if (selected?.obj) selected.obj.material = selected.orig;
  selected = null;
  document.querySelectorAll('#tree .on').forEach((x) => x.classList.remove('on'));
}

// ---------- замер ----------
let measuring = false, mPts = [];
$('#btnMeasure').onclick = () => { measuring = !measuring; $('#btnMeasure').classList.toggle('on', measuring); mPts = []; status(measuring ? 'Замер: щёлкните две точки на модели' : ''); };
function clearMeasure() { measureGroup.children.forEach((o) => o.geometry?.dispose()); measureGroup.clear(); $('#measure').hidden = true; mPts = []; }
function measureClick(hit) {
  if (!hit) return;
  if (mPts.length === 2) clearMeasure();
  mPts.push(hit.point.clone());
  const r = bbox.getSize(new THREE.Vector3()).length() / 300 || 0.05;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd64545, depthTest: false }));
  dot.position.copy(hit.point); dot.renderOrder = 10; measureGroup.add(dot);
  if (mPts.length === 2) {
    const g = new THREE.BufferGeometry().setFromPoints(mPts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd64545, depthTest: false })); l.renderOrder = 10; measureGroup.add(l);
    const d = mPts[0].distanceTo(mPts[1]);
    const u = model?.units;
    $('#measure').hidden = false;
    $('#measure').textContent = u === 'м' ? `Расстояние: ${d >= 1 ? d.toFixed(3) + ' м' : (d * 1000).toFixed(0) + ' мм'}` : `Расстояние: ${d.toFixed(3)} (единицы файла)`;
  }
}

// ---------- открытие файлов ----------
const LABEL = { ifc: 'IFC', skp: 'SketchUp (SKP)', glb: 'glTF (GLB)', gltf: 'glTF', obj: 'OBJ', dae: 'Collada (DAE)' };
const ext = (n) => (n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
$('#btnOpen').onclick = () => $('#file').click();
$('#file').onchange = (e) => { if (e.target.files.length) openFiles([...e.target.files]); e.target.value = ''; };
['dragenter', 'dragover'].forEach((t) => host.addEventListener(t, (e) => { e.preventDefault(); host.classList.add('drop'); }));
['dragleave', 'drop'].forEach((t) => host.addEventListener(t, (e) => { e.preventDefault(); host.classList.remove('drop'); }));
host.addEventListener('drop', (e) => { const f = [...e.dataTransfer.files]; if (f.length) openFiles(f); });

async function openFiles(files) {
  const main = files.find((f) => LABEL[ext(f.name)]);
  if (!main) { status('Этот формат не поддерживается. Откройте IFC, SKP, GLB/glTF, OBJ или DAE.', 'err'); return; }
  const kind = ext(main.name);
  clearModel(); $('#welcome').hidden = true;
  busy(true, `Открываю ${main.name}…`); status('');
  const t0 = performance.now();
  try {
    if (kind === 'ifc') await loadIfc(main);
    else if (kind === 'skp') await loadSkp(main);
    else await loadGeneric(main, files, kind);
    fit(); applyClip();
    const n = model.ifc ? model.ifc.count : countMeshes();
    $('#info').textContent = `${LABEL[kind]} · ${(main.size / 1048576).toFixed(1)} МБ · ${model.ifc ? 'элементов' : 'объектов'}: ${n} · ${dims()}`;
    status(`Открыто за ${((performance.now() - t0) / 1000).toFixed(1)} с`);
    document.title = `${main.name} — Просмотр 3D-моделей`;
  } catch (err) {
    console.error(err); clearModel(); $('#welcome').hidden = false;
    status(errorText(kind, err), 'err');
  } finally { busy(false); }
}
function errorText(kind, err) {
  const m = String(err?.message || err);
  if (/memory|allocation|Array buffer/i.test(m)) return 'Не хватило памяти браузера: модель слишком большая для просмотра онлайн.';
  if (kind === 'skp') return 'Не удалось прочитать SKP. Попробуйте пересохранить файл в SketchUp или экспортировать в DAE/GLB. (' + m + ')';
  return 'Не удалось открыть файл: ' + m;
}
function countMeshes() { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; }
function dims() {
  const s = bbox.getSize(new THREE.Vector3());
  const u = model.units === 'м' ? ' м' : '';
  return `габариты ${s.x.toFixed(1)} × ${s.z.toFixed(1)} × ${s.y.toFixed(1)}${u}`;
}

// ---------- glTF / OBJ / DAE ----------
function blobManager(files) {
  const urls = new Map(files.map((f) => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  const mgr = new THREE.LoadingManager();
  mgr.setURLModifier((u) => { const n = decodeURIComponent(u.split(/[\\/]/).pop()).toLowerCase(); return urls.get(n) || u; });
  return { mgr, urls, done: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
async function loadGeneric(main, files, kind) {
  const { mgr, urls, done } = blobManager(files);
  const url = urls.get(main.name.toLowerCase());
  let obj;
  try {
    if (kind === 'glb' || kind === 'gltf') obj = (await new GLTFLoader(mgr).loadAsync(url)).scene;
    else if (kind === 'dae') obj = (await new ColladaLoader(mgr).loadAsync(url)).scene;
    else {
      const loader = new OBJLoader(mgr);
      const mtl = files.find((f) => ext(f.name) === 'mtl');
      if (mtl) { const m = await new MTLLoader(mgr).loadAsync(urls.get(mtl.name.toLowerCase())); m.preload(); loader.setMaterials(m); }
      obj = await loader.loadAsync(url);
    }
  } finally { setTimeout(done, 5000); }
  model = { kind, name: main.name, units: kind === 'glb' || kind === 'gltf' ? 'м' : '' };
  prepObject(obj); root.add(obj); buildObjectTree(obj);
}
async function loadSkp(file) {
  const buf = await file.arrayBuffer();
  const res = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('skp-worker.js?v=3', BASE), { type: 'module' });
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress' && d.p?.total) busy(true, `Разбираю SKP… ${Math.round((d.p.current / d.p.total) * 100)}%`);
      if (d.type === 'done') { w.terminate(); resolve(d); }
      if (d.type === 'error') { w.terminate(); reject(new Error(d.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'ошибка потока')); };
    w.postMessage({ buf }, [buf]);
  });
  busy(true, 'Строю модель…');
  const gltf = await new GLTFLoader().parseAsync(res.glb, '');
  model = { kind: 'skp', name: file.name, units: 'м' };
  prepObject(gltf.scene); root.add(gltf.scene);
  const meshes = []; gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (res.meta && meshes.length === res.meta.length) {
    meshes.forEach((o, i) => { const mt = res.meta[i]; o.userData.skp = mt; o.name = mt.name && mt.name !== 'ROOT' ? mt.name : (mt.def && mt.def !== 'ROOT_MODEL' ? mt.def : 'Геометрия модели'); });
    buildSkpTree(meshes);
  } else buildObjectTree(gltf.scene);
}
function prepObject(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach((m) => { m.side = THREE.DoubleSide; });
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
  });
}
function selectObject(o) {
  clearSelection();
  if (!o) return;
  selected = { obj: o, orig: o.material };
  const hl = (m) => { const c = m.clone(); if (c.emissive) { c.emissive.set(0xff7a1a); c.emissiveIntensity = 0.55; } else if (c.color) c.color.lerp(new THREE.Color(0xff7a1a), 0.6); return c; };
  o.material = Array.isArray(o.material) ? o.material.map(hl) : hl(o.material);
  const li = document.querySelector(`#tree [data-uuid="${o.uuid}"]`); if (li) { li.classList.add('on'); li.scrollIntoView({ block: 'nearest' }); }
  const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
  const ms = (Array.isArray(selected.orig) ? selected.orig : [selected.orig]).map((m) => m.name).filter(Boolean);
  const tri = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  const u = model.units === 'м' ? ' м' : '';
  const sk = o.userData.skp;
  if (sk) {
    const rows = [['Имя', o.name], ['Компонент', sk.def && sk.def !== 'ROOT_MODEL' ? sk.def : '— (геометрия модели)'], ['Тег', sk.layer || '—'], ['Вложенность', sk.path || '—'], ['Габариты', `${s.x.toFixed(2)} × ${s.z.toFixed(2)} × ${s.y.toFixed(2)} м`]];
    const groups = [['Объект SketchUp', rows]];
    const pr = Object.entries(sk.props || {}); if (pr.length) groups.push(['Свойства', pr]);
    Object.entries(sk.attrs || {}).forEach(([k, v]) => { const e = Object.entries(v || {}); if (e.length) groups.push([k, e]); });
    props(groups); return;
  }
  props([['Объект', [['Имя', o.name || '—'], ['Родитель', o.parent?.name || '—'], ['Материал', ms.join(', ') || '—'], ['Треугольников', Math.round(tri)], ['Габариты', `${s.x.toFixed(2)} × ${s.z.toFixed(2)} × ${s.y.toFixed(2)}${u}`]]]]);
}
function buildSkpTree(meshes) {
  // дерево по пути вложенности SketchUp, сверху — теги
  const byLayer = new Map();
  meshes.forEach((o) => { const l = o.userData.skp.layer || 'Без тега'; if (!byLayer.has(l)) byLayer.set(l, []); byLayer.get(l).push(o); });
  const ul = document.createElement('ul');
  for (const [layer, arr] of [...byLayer].sort((a, b) => a[0].localeCompare(b[0]))) {
    const li = document.createElement('li');
    li.innerHTML = `<details open><summary><b>Тег</b> ${esc(layer === 'Layer0' ? 'Layer0 (по умолчанию)' : layer)} <small>${arr.length}</small></summary><ul></ul></details>`;
    const groups = new Map(); arr.forEach((o) => { const k = o.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
    const gu = li.querySelector('ul');
    [...groups].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, list]) => {
      if (list.length === 1) { const x = document.createElement('li'); x.className = 'leaf'; x.dataset.uuid = list[0].uuid; x.textContent = name; x.onclick = () => selectObject(list[0]); gu.appendChild(x); return; }
      const g = document.createElement('li'); g.innerHTML = `<details><summary>${esc(name)} <small>${list.length}</small></summary><ul></ul></details>`;
      const u2 = g.querySelector('ul'); list.slice(0, 3000).forEach((o, i) => { const x = document.createElement('li'); x.className = 'leaf'; x.dataset.uuid = o.uuid; x.textContent = `${name} · ${i + 1}`; x.onclick = () => selectObject(o); u2.appendChild(x); });
      gu.appendChild(g);
    });
    ul.appendChild(li);
  }
  $('#tree').appendChild(ul);
}
function buildObjectTree(obj) {
  const make = (o, depth) => {
    const kids = o.children.filter((c) => c.isMesh || c.children.length);
    if (depth > 0 && !kids.length && !o.isMesh) return null;
    const li = document.createElement('li');
    const name = o.name || (o.isMesh ? 'Объект' : 'Группа');
    if (kids.length) {
      li.innerHTML = `<details${depth < 1 ? ' open' : ''}><summary>${esc(name)} <small>${kids.length}</small></summary><ul></ul></details>`;
      const ul = li.querySelector('ul');
      const add = () => { if (ul.childElementCount) return; kids.slice(0, 2000).forEach((c) => { const x = make(c, depth + 1); if (x) ul.appendChild(x); }); };
      if (depth < 1) add(); else li.querySelector('details').addEventListener('toggle', add, { once: true });
      if (o.isMesh) { li.dataset.uuid = o.uuid; li.querySelector('summary').onclick = () => selectObject(o); }
    } else {
      li.textContent = name; li.className = 'leaf'; li.dataset.uuid = o.uuid; li.onclick = () => selectObject(o);
    }
    return li;
  };
  const ul = document.createElement('ul'); const top = make(obj, 0); if (top) ul.appendChild(top);
  $('#tree').appendChild(ul);
}

// ---------- IFC ----------
let ifcApi = null;
async function getIfcApi() {
  if (ifcApi) return ifcApi;
  const { IfcAPI } = await import('web-ifc');
  const api = new IfcAPI();
  api.SetWasmPath(BASE, true);
  await api.Init();
  ifcApi = api; return api;
}
async function loadIfc(file) {
  busy(true, 'Загружаю модуль IFC…');
  const api = await getIfcApi();
  busy(true, `Читаю ${file.name}…`);
  const data = new Uint8Array(await file.arrayBuffer());
  const id = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
  busy(true, 'Строю геометрию…');
  await new Promise((r) => setTimeout(r, 30));
  const buckets = new Map(); // цвет → {pos[], nrm[], idx[], ranges:[[id,start,count]]}
  const ids = new Set();
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  api.StreamAllMeshes(id, (mesh) => {
    const eid = mesh.expressID; ids.add(eid);
    const pgs = mesh.geometries;
    for (let i = 0; i < pgs.size(); i++) {
      const pg = pgs.get(i);
      const g = api.GetGeometry(id, pg.geometryExpressID);
      const vd = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const ix = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      g.delete();
      const c = pg.color; const key = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.w.toFixed(2)}`;
      let b = buckets.get(key); if (!b) { b = { c, pos: [], nrm: [], idx: [], ranges: [] }; buckets.set(key, b); }
      m.fromArray(pg.flatTransformation); nm.getNormalMatrix(m);
      const base = b.pos.length / 3;
      for (let k = 0; k < vd.length; k += 6) {
        v.set(vd[k], vd[k + 1], vd[k + 2]).applyMatrix4(m); b.pos.push(v.x, v.y, v.z);
        v.set(vd[k + 3], vd[k + 4], vd[k + 5]).applyMatrix3(nm).normalize(); b.nrm.push(v.x, v.y, v.z);
      }
      const start = b.idx.length;
      for (let k = 0; k < ix.length; k++) b.idx.push(ix[k] + base);
      b.ranges.push([eid, start, ix.length]);
    }
  });
  const byId = new Map(); // id → [[mesh, start, count]]
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.c.x, b.c.y, b.c.z), transparent: b.c.w < 0.999, opacity: b.c.w, side: THREE.DoubleSide, depthWrite: b.c.w >= 0.999 });
    const mesh = new THREE.Mesh(geo, mat);
    // для выбора по треугольнику: отсортированные начала диапазонов
    mesh.userData.ranges = b.ranges;
    b.ranges.forEach(([eid, s, n]) => { if (!byId.has(eid)) byId.set(eid, []); byId.get(eid).push([mesh, s, n]); });
    root.add(mesh);
  }
  model = { kind: 'ifc', name: file.name, units: 'м', ifc: { api, id, byId, count: ids.size } };
  busy(true, 'Читаю структуру…');
  await buildIfcTree(api, id);
}
function idFromHit(hit) {
  const r = hit.object.userData.ranges; if (!r) return null;
  const t = hit.faceIndex * 3; let lo = 0, hi = r.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (r[mid][1] <= t) lo = mid + 1; else hi = mid - 1; }
  return r[hi]?.[0] ?? null;
}
function highlightIfc(eid) {
  const parts = model.ifc.byId.get(eid) || [];
  for (const [mesh, s, n] of parts) {
    const src = mesh.geometry.index.array;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geometry.attributes.position);
    g.setIndex(new THREE.BufferAttribute(src.slice(s, s + n), 1));
    const h = new THREE.Mesh(g, hlMat); h.renderOrder = 5; hlGroup.add(h);
  }
}
const ifcName = (api, id, eid) => { try { const l = api.GetLine(id, eid); return l?.Name?.value || l?.LongName?.value || ''; } catch { return ''; } };
const ifcType = (api, eid, id) => { try { return api.GetNameFromTypeCode(api.GetLineType(id, eid)); } catch { return ''; } };
const PRETTY = (t) => (t || '').replace(/^IFC/, 'Ifc').replace(/(?<=Ifc)([A-Z])([A-Z]+)/, (m, a, b) => a + b.toLowerCase());
async function selectIfc(eid) {
  clearSelection(); if (eid == null) return;
  const { api, id } = model.ifc;
  selected = { eid }; highlightIfc(eid);
  const li = document.querySelector(`#tree [data-eid="${eid}"]`);
  if (li) { li.classList.add('on'); li.closest('details')?.setAttribute('open', ''); li.scrollIntoView({ block: 'nearest' }); }
  const line = api.GetLine(id, eid);
  const base = [['Класс', ifcType(api, eid, id)], ['Имя', line.Name?.value || '—'], ['GlobalId', line.GlobalId?.value || '—']];
  if (line.ObjectType?.value) base.push(['Тип', line.ObjectType.value]);
  if (line.Tag?.value) base.push(['Метка', line.Tag.value]);
  const groups = [['Элемент', base]];
  try {
    const sets = await api.properties.getPropertySets(id, eid, true, false);
    for (const s of sets) {
      const rows = [];
      (s.HasProperties || []).forEach((p) => { const val = p.NominalValue?.value ?? p.EnumerationValues?.map((x) => x.value).join(', '); if (p.Name?.value) rows.push([p.Name.value, val ?? '—']); });
      (s.Quantities || []).forEach((q) => { const val = q.LengthValue ?? q.AreaValue ?? q.VolumeValue ?? q.CountValue ?? q.WeightValue; if (q.Name?.value) rows.push([q.Name.value, val?.value != null ? +(+val.value).toFixed(3) : '—']); });
      if (rows.length) groups.push([s.Name?.value || 'Набор свойств', rows]);
    }
  } catch (e) { console.warn(e); }
  if (selected?.eid === eid) props(groups);
}
async function buildIfcTree(api, id) {
  const tree = await api.properties.getSpatialStructure(id, false);
  const make = (node, depth) => {
    const kids = node.children || [];
    const li = document.createElement('li');
    const t = PRETTY(node.type || ifcType(api, node.expressID, id));
    const nm = ifcName(api, id, node.expressID);
    const spatial = /SITE|BUILDING|STOREY|PROJECT|SPACE|ZONE/i.test(node.type || '');
    if (kids.length) {
      li.innerHTML = `<details${depth < 3 ? ' open' : ''}><summary><b>${esc(t)}</b> ${esc(nm)} <small>${kids.length}</small></summary><ul></ul></details>`;
      const ul = li.querySelector('ul');
      const add = () => {
        if (ul.childElementCount) return;
        // элементы этажа группируем по классам, иначе списки на тысячи строк
        const sp = kids.filter((k) => (k.children || []).length || /SPACE|STOREY|BUILDING|SITE/i.test(k.type));
        const el = kids.filter((k) => !sp.includes(k));
        sp.forEach((k) => ul.appendChild(make(k, depth + 1)));
        const byType = new Map(); el.forEach((k) => { const tt = PRETTY(k.type); if (!byType.has(tt)) byType.set(tt, []); byType.get(tt).push(k); });
        [...byType].sort((a, b) => a[0].localeCompare(b[0])).forEach(([tt, arr]) => {
          const g = document.createElement('li');
          g.innerHTML = `<details><summary>${esc(tt)} <small>${arr.length}</small></summary><ul></ul></details>`;
          const gu = g.querySelector('ul');
          g.querySelector('details').addEventListener('toggle', () => {
            if (gu.childElementCount) return;
            arr.slice(0, 3000).forEach((k) => { const x = document.createElement('li'); x.className = 'leaf'; x.dataset.eid = k.expressID; x.textContent = ifcName(api, id, k.expressID) || `#${k.expressID}`; x.onclick = () => selectIfc(k.expressID); gu.appendChild(x); });
          }, { once: true });
          ul.appendChild(g);
        });
      };
      if (depth < 3) add(); else li.querySelector('details').addEventListener('toggle', add, { once: true });
      if (!spatial) { li.dataset.eid = node.expressID; li.querySelector('summary').addEventListener('click', () => selectIfc(node.expressID)); }
    } else {
      li.className = 'leaf'; li.dataset.eid = node.expressID; li.innerHTML = `<b>${esc(t)}</b> ${esc(nm)}`; li.onclick = () => selectIfc(node.expressID);
    }
    return li;
  };
  const ul = document.createElement('ul'); ul.appendChild(make(tree, 0)); $('#tree').appendChild(ul);
}

// ---------- свойства ----------
function props(groups) {
  $('#props').innerHTML = groups.map(([title, rows]) => `<details open><summary>${esc(title)}</summary><table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></details>`).join('');
}

// ---------- прочее ----------
$('#btnShot').onclick = () => { const a = document.createElement('a'); a.href = renderer.domElement.toDataURL('image/png'); a.download = (model?.name || 'model').replace(/\.[^.]+$/, '') + '.png'; a.click(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { clearSelection(); if (measuring) $('#btnMeasure').click(); clearMeasure(); } if (e.key === 'f' && !e.target.closest('input,select')) fit(); });
window.__viewer = { openFiles, get model() { return model; }, THREE, root, selectIfc };
