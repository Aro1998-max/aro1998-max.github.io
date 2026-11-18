/* Конструктор EIR — интерфейс анкеты */
(function () {
  'use strict';
  var E = window.EIR, D = E.DATA, KEY = 'tis-eir-v1';
  var $ = function (id) { return document.getElementById(id); };
  var S = load() || E.defaults();
  var step = 1, LAST = 6;

  function load() {
    try {
      var raw = localStorage.getItem(KEY); if (!raw) return null;
      return merge(E.defaults(), JSON.parse(raw));
    } catch (e) { return null; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* хранилище недоступно */ } }
  function merge(a, b) {
    Object.keys(b || {}).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], b[k]);
      else if (k in a) a[k] = b[k];
    });
    return a;
  }

  /* ---------- шаги ---------- */
  var sections = Array.prototype.slice.call(document.querySelectorAll('.step'));
  function renderSteps() {
    $('steps').innerHTML = sections.map(function (s) {
      var n = +s.dataset.step;
      return '<button data-n="' + n + '" class="' + (n === step ? 'on' : (n < step ? 'done' : '')) + '"><i>' + (n < step ? '✓' : n) + '</i><span>' + s.dataset.title + '</span></button>';
    }).join('');
  }
  function go(n) {
    step = Math.max(1, Math.min(LAST, n));
    sections.forEach(function (s) { s.classList.toggle('on', +s.dataset.step === step); });
    $('prev').style.visibility = step === 1 ? 'hidden' : 'visible';
    $('next').classList.toggle('hidden', step === LAST);
    if (step === LAST) renderSummary();
    renderSteps();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('steps').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(+b.dataset.n); });
  $('prev').onclick = function () { go(step - 1); };
  $('next').onclick = function () { go(step + 1); };

  /* ---------- привязка простых полей ---------- */
  function bind(id, get, set, ev) {
    var el = $(id); get(el);
    el.addEventListener(ev || 'input', function () { set(el); save(); sync(); });
  }
  function txt(id, obj, key, fn) { bind(id, function (el) { el.value = obj()[key]; }, function (el) { obj()[key] = fn ? fn(el.value) : el.value; }); }
  function num(id, obj, key) { bind(id, function (el) { el.value = obj()[key]; }, function (el) { var v = parseFloat(el.value); obj()[key] = isNaN(v) ? obj()[key] : v; }); }
  function chk(id, obj, key) { bind(id, function (el) { el.checked = !!obj()[key]; }, function (el) { obj()[key] = el.checked; }, 'change'); }
  function seg(id, obj, key) {
    var box = $(id);
    function paint() { Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.v === obj()[key]); }); }
    paint();
    box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; e.preventDefault(); obj()[key] = b.dataset.v; paint(); save(); sync(); });
    return paint;
  }
  var o = function () { return S.obj; }, root = function () { return S; }, ifc = function () { return S.ifc; }, cde = function () { return S.cde; }, acc = function () { return S.acc; };

  function initFields() {
    txt('o_name', o, 'name'); txt('o_customer', o, 'customer'); txt('o_address', o, 'address'); txt('o_version', o, 'version'); txt('o_date', o, 'date');
    bind('o_code', function (el) { el.value = S.obj.code; }, function (el) {
      var v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (v !== el.value) el.value = v; S.obj.code = v;
    });
    bind('o_work', function (el) { el.value = S.obj.work; }, function (el) { S.obj.work = el.value; }, 'change');
    bind('o_expertise', function (el) { el.value = S.obj.expertise; }, function (el) { S.obj.expertise = el.value; }, 'change');
    seg('o_stage', o, 'stage');
    chk('mid', root, 'mid'); chk('ksi', root, 'ksi'); txt('ksiSystem', root, 'ksiSystem');
    bind('prefix', function (el) { el.value = S.prefix; }, function (el) {
      var v = el.value.replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').slice(0, 16); if (v !== el.value) el.value = v; S.prefix = v || 'EIR';
    });
    seg('mvd', ifc, 'mvd'); chk('native', ifc, 'native'); txt('softVer', ifc, 'softVer', function (v) { return v.replace(/\D/g, '').slice(0, 4); });
    txt('coords', root, 'coords'); txt('zero', root, 'zero');
    seg('cdeOwner', cde, 'owner'); txt('cdePlatform', cde, 'platform'); num('cdeWeeks', cde, 'weeks'); num('cdeMeet', cde, 'meet');
    num('tol', acc, 'tol'); num('cls', acc, 'cls'); num('attr', acc, 'attr'); num('review', acc, 'review'); num('fix', acc, 'fix');
    chk('normCheck', acc, 'normCheck');
  }

  /* ---------- цели ---------- */
  function renderGoals() {
    $('goals').innerHTML = D.GOALS.map(function (g) {
      var st = S.goals[g.id] || (S.goals[g.id] = { on: g.on, x: g.x });
      var met = E.esc(g.metric).replace('{x}', '<input type="number" data-x="' + g.id + '" value="' + E.esc(st.x != null ? st.x : g.x) + '">');
      return '<label class="goal' + (st.on ? ' on' : '') + '" data-g="' + g.id + '"><input type="checkbox" data-c="' + g.id + '"' + (st.on ? ' checked' : '') + '>' +
        '<div><div class="t">' + E.esc(g.goal) + '</div><div class="task">' + E.esc(g.task) + '</div></div><div class="met">' + met + '</div></label>';
    }).join('');
  }
  $('goals').addEventListener('change', function (e) {
    var c = e.target.dataset.c; if (!c) return;
    S.goals[c].on = e.target.checked; e.target.closest('.goal').classList.toggle('on', e.target.checked); save(); sync();
  });
  $('goals').addEventListener('input', function (e) {
    var x = e.target.dataset.x; if (!x) return;
    var v = parseFloat(e.target.value); if (!isNaN(v)) { S.goals[x].x = v; save(); }
  });
  $('goals').addEventListener('click', function (e) { if (e.target.dataset.x) e.preventDefault(); });

  /* ---------- марки ---------- */
  function renderMarks() {
    var groups = [];
    D.MARKS.forEach(function (m) { if (groups.indexOf(m.grp) < 0) groups.push(m.grp); });
    $('marks').innerHTML = groups.map(function (g) {
      return '<div class="mgrp"><div class="gh">' + E.esc(g) + '</div><div class="mlist">' + D.MARKS.filter(function (m) { return m.grp === g; }).map(function (m) {
        var on = S.marks.indexOf(m.id) >= 0;
        return '<label class="mark' + (on ? ' on' : '') + '"><input type="checkbox" data-m="' + m.id + '"' + (on ? ' checked' : '') + '><span><b>' + E.esc(m.code) + '</b>' + E.esc(m.name) +
          '<small>' + m.el.length + ' видов элементов · код ' + m.lat + '</small></span></label>';
      }).join('') + '</div></div>';
    }).join('');
  }
  $('marks').addEventListener('change', function (e) {
    var id = e.target.dataset.m; if (!id) return;
    var i = S.marks.indexOf(id);
    if (e.target.checked && i < 0) S.marks.push(id); if (!e.target.checked && i >= 0) S.marks.splice(i, 1);
    S.marks = D.MARKS.filter(function (m) { return S.marks.indexOf(m.id) >= 0; }).map(function (m) { return m.id; });
    e.target.closest('.mark').classList.toggle('on', e.target.checked); save(); sync();
  });
  $('mAll').onclick = function () { S.marks = D.MARKS.map(function (m) { return m.id; }); renderMarks(); save(); sync(); };
  $('mNone').onclick = function () { S.marks = []; renderMarks(); save(); sync(); };

  /* ---------- ПО ---------- */
  function renderSoft() {
    $('soft').innerHTML = D.SOFTWARE.map(function (x) {
      var on = S.ifc.soft.indexOf(x.id) >= 0;
      return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" data-s="' + x.id + '"' + (on ? ' checked' : '') + '>' + E.esc(x.name) + '</label>';
    }).join('');
  }
  $('soft').addEventListener('change', function (e) {
    var id = e.target.dataset.s; if (!id) return;
    var i = S.ifc.soft.indexOf(id);
    if (e.target.checked && i < 0) S.ifc.soft.push(id); if (!e.target.checked && i >= 0) S.ifc.soft.splice(i, 1);
    e.target.parentNode.classList.toggle('on', e.target.checked); save(); sync();
  });

  /* ---------- зависимые подсказки ---------- */
  function sync() {
    $('expWrap').classList.toggle('hidden', S.obj.stage === 'RD');
    $('ksiWrap').classList.toggle('hidden', !S.ksi);
    $('psetPrev').textContent = (S.prefix || 'EIR') + '_Общие';
    $('mvdHint').textContent = 'Подходит ' + D.MVD[S.ifc.mvd].hint;
    $('sideIds').textContent = S.marks.length ? S.marks.length + ' файл(ов) — по одному на марку, для проверки IFC' : 'выберите марки на шаге 3';
    var code = $('o_code'); code.classList.toggle('bad', !!code.value && !/^[A-Z0-9]{1,6}$/.test(code.value));
    if (step === LAST) renderSummary();
  }

  /* ---------- проверка и итог ---------- */
  function problems() {
    var p = [];
    if (!S.obj.name.trim()) p.push([1, 'Укажите наименование объекта']);
    if (!/^[A-Z0-9]{1,6}$/.test(S.obj.code || '')) p.push([1, 'Укажите шифр объекта: латиница и цифры, до 6 знаков']);
    if (!D.GOALS.some(function (g) { return S.goals[g.id] && S.goals[g.id].on; })) p.push([2, 'Выберите хотя бы одну цель']);
    if (!S.marks.length) p.push([3, 'Выберите хотя бы одну марку']);
    if (S.ifc.native && !S.ifc.soft.length) p.push([4, 'Укажите ПО разработки или отключите передачу исходного формата']);
    return p;
  }
  function renderSummary() {
    var ms = D.MARKS.filter(function (m) { return S.marks.indexOf(m.id) >= 0; });
    var gs = D.GOALS.filter(function (g) { return S.goals[g.id] && S.goals[g.id].on; });
    var kp = E.keyPoints(S);
    var nAttr = 0;
    ms.forEach(function (m) { m.el.forEach(function (e) { if (e.ids !== false) nAttr += E.reqs(S, m, e).length; }); });
    var code = S.obj.code || 'OBJ';
    $('summary').innerHTML =
      '<div class="sum">' +
      '<div class="c"><h4>' + E.esc(S.obj.name || 'Объект не указан') + '</h4><p>' + E.esc({ P: 'Стадия П', RD: 'Стадия РД', PRD: 'Стадии П и РД' }[S.obj.stage]) + ' · ' + ms.length + ' марок · ' + gs.length + ' целей</p></div>' +
      '<div class="c"><h4>Ключевые точки</h4><ul>' + kp.map(function (k) { return '<li>' + k.id + ' — ' + E.esc(k.name) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="c"><h4>Требования к модели</h4><p>' + nAttr + ' проверяемых требований к элементам, ' + E.clashes(S).length + ' пар в матрице коллизий, допуск ' + S.acc.tol + ' мм</p></div>' +
      '<div class="c"><h4>Приёмка</h4><p>Классы IFC — ' + S.acc.cls + ' %, атрибуты — ' + S.acc.attr + ' %; проверка ' + S.acc.review + ' раб. дн., устранение ' + S.acc.fix + ' раб. дн.</p></div>' +
      '</div><div class="files">' +
      '<div><code>EIR_' + code + '.pdf</code><span class="muted">требования заказчика · бесплатно</span></div>' +
      '<div><code>PIM_' + code + '.pdf</code><span class="muted">шаблон ПИМ для исполнителя · бесплатно</span></div>' +
      '<div><code>EIR_' + code + '.docx, PIM_' + code + '.docx</code><span class="muted">Word · по запросу</span></div>' +
      '<div><code>EIR_' + code + '_Annex.xlsx</code><span class="muted">' + (S.goals.qty && S.goals.qty.on ? '7' : '6') + ' листов · по запросу</span></div>' +
      '<div><code>IDS/' + code + '_*.ids</code><span class="muted">' + ms.length + ' файл(ов): ' + ms.map(function (m) { return m.lat; }).join(', ') + ' · по запросу</span></div>' +
      '</div>';
    var p = problems();
    $('errors').classList.toggle('hidden', !p.length);
    $('errors').innerHTML = p.map(function (x) { return '<div>' + E.esc(x[1]) + ' — <a data-go="' + x[0] + '">шаг ' + x[0] + '</a></div>'; }).join('');
    $('btnBuild').disabled = !!p.length; $('btnRequest').disabled = !!p.length; $('btnFull').disabled = !!p.length;
  }
  $('errors').addEventListener('click', function (e) { var a = e.target.closest('a'); if (a) go(+a.dataset.go); });

  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  async function run(btn, make, name) {
    if (problems().length) return;
    btn.disabled = true; $('buildState').textContent = 'Формирую документы…';
    try {
      var blob = await make();
      download(blob, name);
      $('buildState').textContent = 'Готово — архив скачан (' + Math.round(blob.size / 1024) + ' КБ).';
    } catch (err) {
      console.error(err); $('buildState').textContent = 'Не удалось сформировать документы: ' + (err && err.message || err);
    } finally { btn.disabled = false; }
  }
  $('btnBuild').onclick = function () { run(this, function () { return E.buildFree(S); }, 'EIR_' + S.obj.code + '_PDF.zip'); };
  $('btnFull').onclick = function () { run(this, function () { return E.buildAll(S, { free: false }); }, 'EIR_' + S.obj.code + '.zip'); };
  $('btnRequest').onclick = function () {
    if (problems().length) return;
    download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), 'EIR_анкета_' + S.obj.code + '.json');
    var subj = 'Конструктор EIR — редактируемый комплект, ' + S.obj.code;
    var body = 'Здравствуйте!\n\nПрошу подготовить редактируемый комплект EIR (Word, Excel, IDS) по анкете.\nОбъект: ' + S.obj.name + '\nШифр: ' + S.obj.code +
      '\n\nФайл анкеты EIR_анкета_' + S.obj.code + '.json прикладываю.\n\nКонтакты для связи: ';
    $('reqHelp').classList.remove('hidden');
    setTimeout(function () { location.href = 'mailto:tis_company@inbox.ru?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body); }, 300);
  };

  $('saveJson').onclick = function () {
    download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), 'EIR_анкета_' + (S.obj.code || 'OBJ') + '.json');
  };
  $('loadJson').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) {
      S = merge(E.defaults(), JSON.parse(t)); save(); location.reload();
    }).catch(function () { alert('Файл анкеты не прочитан'); });
    e.target.value = '';
  };

  function start() {
    initFields(); renderGoals(); renderMarks(); renderSoft(); sync();
  }
  if (window.EIR_FULL && E.buildAll) $('tierFull').classList.remove('hidden');
  start(); go(1);
})();
