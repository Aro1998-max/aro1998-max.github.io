// Добавляет в OpenSKP чтение CCustomLineStyle (стиль линий тегов, SketchUp 2019+).
// Без него старые .skp с настроенными стилями линий не открываются.
// Запуск: node patch-openskp.cjs <путь к node_modules/openskp/dist/index.mjs>
const fs = require('fs');
const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8');
if (s.includes('readCustomLineStyle')) { console.log('already patched'); process.exit(0); }
s = s.replace('function earlyPreamble(ar, r) {', `function readCustomLineStyle(ar, r) {
  earlyPreamble(ar, r);
  const name = r.utf16();
  r.utf16();
  r.raw(24);
  return { k: "linestyle", name };
}
function consumeLineStyle(ar, r) {
  // у тегов SketchUp 2019+ в конце записи слоя стоит ссылка на стиль линий
  for (const skip of [0, 1]) {
    const p = r.pos + skip; if (p + 2 > r.data.length) return;
    const t = r.data[p] | r.data[p + 1] << 8; let hit = false;
    if (t === 65535) { const nl = r.data[p + 4] | r.data[p + 5] << 8; hit = nl === 16 && new TextDecoder().decode(r.data.subarray(p + 6, p + 22)) === "CCustomLineStyle"; }
    else if (t & 32768) { const e = ar.slots.get(t & 32767); hit = !!e && e[0] === "class" && e[1] === "CCustomLineStyle"; }
    else if (t && t !== 32767) { const e = ar.slots.get(t); hit = !!e && e[0] === "obj" && e[1] === "CCustomLineStyle"; }
    if (hit) { r.pos = p; ar.readObject(r, "CCustomLineStyle"); return; }
  }
}
function earlyPreamble(ar, r) {`);
s = s.replace(`    r.raw(4);
    return { k: "layer", name, hidden: mid.length ? mid[0] : 0, rgba: tex.rgba };`, `    r.raw(4);
    consumeLineStyle(ar, r);
    return { k: "layer", name, hidden: mid.length ? mid[0] : 0, rgba: tex.rgba };`);
s = s.replace(`  ar.skipClayerParentRef(ar.currentObjSlot);
  return { k: "layer"`, `  ar.skipClayerParentRef(ar.currentObjSlot);
  consumeLineStyle(ar, r);
  return { k: "layer"`);
s = s.replace('function earlyPreamble(ar, r) {', `function readLayerGroup(ar, r) {
  // папка тегов (SketchUp 2020+): имя и ссылки на входящие теги
  const m = findBytes(r.data, STR_MARKER, r.pos, r.pos + 12);
  if (m < 0) throw new LegacyParseError(\`layer group name not found \${r.ctx()}\`);
  r.pos = m;
  const name = r.utf16();
  r.u32();
  const k = r.u32();
  if (k > 1e5) throw new LegacyParseError(\`implausible layer group size \${r.ctx()}\`);
  r.raw(2 * k);
  return { k: "layergroup", name };
}
function skipLayerGroups(ar, r) {
  // после списка тегов в SketchUp 2020+: 00 00 00, пустая строка, число папок, папки
  const d = r.data, p = r.pos;
  if (!(d[p] === 0 && d[p + 1] === 0 && d[p + 2] === 0 && d[p + 3] === 255 && d[p + 4] === 254 && d[p + 5] === 255 && d[p + 6] === 0)) return;
  const save = r.pos;
  try {
    r.pos = p + 7;
    const n = r.u32();
    if (n > 1e4) { r.pos = save; return; }
    for (let i = 0; i < n; i++) ar.readObject(r, "CLayerGroup");
    for (let z = 0; z <= 12; z++) {
      if (definitionStartsAt(ar, d, r.pos + z + 4)) { r.pos += z; return; }
    }
    r.pos = save;
  } catch (e) { r.pos = save; }
}
function earlyPreamble(ar, r) {`);
s = s.replace(`    throw new LegacyParseError(\`definition-list anchor is \${dn}, not a layer\`);
  }
  let defCount = r.u32();`, `    throw new LegacyParseError(\`definition-list anchor is \${dn}, not a layer\`);
  }
  skipLayerGroups(ar, r);
  let defCount = r.u32();`);
s = s.replace('  CText: readText', '  CText: readText,\n  CCustomLineStyle: readCustomLineStyle,\n  CLayerGroup: readLayerGroup');
if (!s.includes('skipLayerGroups(ar, r);\n  let defCount')) { console.error('anchor patch failed'); process.exit(1); }
// Грани без материала SketchUp рисует цветом по умолчанию, а не цветом тега
// (цвет тега виден только в режиме «Цвет по тегам»). OpenSKP брал цвет тега.
s = s.split('const c = layerColors.get(name) || [136, 136, 136];').join('const c = [242, 242, 242];');
fs.writeFileSync(f, s); console.log('patched');
