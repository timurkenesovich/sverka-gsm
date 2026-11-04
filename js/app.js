/*
 * Сверка ГСМ — интерфейс. Всё работает локально в браузере.
 * Внимание: здесь нет ни одного сетевого запроса (fetch/XMLHttpRequest) — и не должно быть.
 */
(function () {
  'use strict';
  var C = window.SverkaCore, D = window.SverkaDemo, CFG = window.SVERKA_CONFIG || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var fmt = C.fmtNum, pct = C.fmtPct, fdate = C.fmtDate;

  var KINDS = [
    { kind: 'gps', title: 'GPS', tag: 'обязательно', hint: 'Машина (госномер), дата, пробег за день в км.' },
    { kind: 'waybills', title: 'Путевые листы', tag: 'желательно', hint: 'Машина, водитель, дата, одометр на выезде и на возврате.' },
    { kind: 'fuel', title: 'АЗС по топливным картам', tag: 'обязательно', hint: 'Номер карты, дата и время, АЗС, литры, сумма.' },
    { kind: 'refs', title: 'Справочник (файлом)', tag: 'необязательно', hint: 'Машина, норма л/100 км, карты. Можно не загружать — заполните таблицу ниже.' }
  ];
  var SAMPLE_NAMES = { gps: 'пример_GPS.csv', waybills: 'пример_путевые_листы.csv', fuel: 'пример_АЗС.csv', refs: 'пример_справочник.csv' };
  var COLORS = { gps: '#2a78d6', wb: '#eb6834', calc: '#1baf7a', grid: '#e1e0d9', axis: '#898781' };
  var STATUS = { red: 'Проверить срочно', yellow: 'Есть вопросы', green: 'В норме' };
  var ICON = { red: '!', yellow: '?', green: '✓' };

  var state = { files: {}, refs: [], result: null, charts: [], car: null, demo: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function tg(x) { return fmt(x) + ' ₸'; }
  function badge(st) { return '<span class="badge ' + st + '">' + STATUS[st] + '</span>'; }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800);
  }

  // -------------------------------------------------------------------------
  // Загрузка файлов
  // -------------------------------------------------------------------------
  function buildDrops() {
    $('#drops').innerHTML = KINDS.map(function (k) {
      return '<div class="drop" data-kind="' + k.kind + '">' +
        '<div class="drop-head"><span class="drop-title">' + k.title + '</span><span class="drop-tag">' + k.tag + '</span></div>' +
        '<p class="drop-hint">' + k.hint + '</p>' +
        '<label class="drop-pick">Перетащите файл сюда или нажмите<input type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm,.ods"></label>' +
        '<div class="drop-body"></div></div>';
    }).join('');
    $$('.drop').forEach(function (el) {
      var kind = el.getAttribute('data-kind');
      $('input', el).addEventListener('change', function (e) { if (e.target.files[0]) handleFile(kind, e.target.files[0]); e.target.value = ''; });
      ['dragenter', 'dragover'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.remove('over'); }); });
      el.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handleFile(kind, f); });
    });
    // не даём браузеру открыть файл, если промахнулись мимо поля
    ['dragover', 'drop'].forEach(function (ev) { window.addEventListener(ev, function (e) { e.preventDefault(); }); });

    $('#sampleLinks').innerHTML = KINDS.map(function (k) {
      return '<a href="#" data-sample="' + k.kind + '">' + k.title.replace(' (файлом)', '') + '</a>';
    }).join(' ');
    $$('[data-sample]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); downloadSample(a.getAttribute('data-sample')); });
    });
  }

  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1251').decode(buf); } // выгрузки из 1С часто в этой кодировке
  }

  function arraysFromBuffer(name, buf) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return C.parseCSV(decodeText(buf));
    if (typeof XLSX === 'undefined') throw new Error('Не загрузилась библиотека для Excel. Сохраните файл как CSV.');
    var wb = XLSX.read(buf, { type: 'array' });
    for (var i = 0; i < wb.SheetNames.length; i++) {
      var arr = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[i]], { header: 1, raw: true, defval: '' });
      if (arr.length > 1) return arr;
    }
    return [];
  }

  function handleFile(kind, file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        setTable(kind, file.name, arraysFromBuffer(file.name, fr.result));
        state.demo = false;
      } catch (err) {
        renderDropError(kind, file.name, err.message || String(err));
      }
    };
    fr.onerror = function () { renderDropError(kind, file.name, 'Не удалось прочитать файл'); };
    fr.readAsArrayBuffer(file);
  }

  function setTable(kind, name, arrays) {
    var t = C.tableFromArrays(arrays);
    if (!t.headers.length) { renderDropError(kind, name, 'Не нашли строку с заголовками колонок'); return; }
    state.files[kind] = { name: name, headers: t.headers, rows: t.rows, map: C.autoMap(t.headers, kind) };
    renderDrop(kind);
    if (kind === 'refs') refsFromFile();
    syncRefCars();
  }

  function renderDropError(kind, name, msg) {
    var el = $('.drop[data-kind="' + kind + '"]');
    el.classList.remove('ok'); el.classList.add('warn');
    $('.drop-body', el).innerHTML = '<div class="drop-file">' + esc(name) + '</div><div class="drop-status bad">' + esc(msg) + '</div>';
  }

  function renderDrop(kind) {
    var f = state.files[kind], el = $('.drop[data-kind="' + kind + '"]');
    var miss = C.missingFields(f.map, kind);
    var n = C.normalize(kind, f.rows, f.map);
    var ok = !miss.length && n.rows.length > 0;
    el.classList.toggle('ok', ok); el.classList.toggle('warn', !ok);
    var status = miss.length
      ? '<div class="drop-status bad">Укажите колонки: ' + esc(miss.join(', ')) + '</div>'
      : '<div class="drop-status ' + (n.errors.length ? '' : 'good') + '">✓ Распознано ' + fmt(n.rows.length) + ' из ' + fmt(f.rows.length) + ' строк' +
        (n.errors.length ? ' · ' + fmt(n.errors.length) + ' пропущено (пустые или с ошибкой)' : '') + '</div>';
    var opts = function (cur) {
      return '<option value="">— нет такой колонки —</option>' + f.headers.map(function (h) {
        return '<option' + (h === cur ? ' selected' : '') + ' value="' + esc(h) + '">' + esc(h) + '</option>';
      }).join('');
    };
    var mapping = '<details class="mapping"' + (miss.length ? ' open' : '') + '><summary>Какая колонка что означает</summary>' +
      C.FIELDS[kind].map(function (fd) {
        return '<label>' + esc(fd.label) + (fd.required ? ' <span class="req">*</span>' : '') +
          '<select data-field="' + fd.key + '">' + opts(f.map[fd.key]) + '</select></label>';
      }).join('') + '</details>';
    $('.drop-body', el).innerHTML = '<div class="drop-file">📄 ' + esc(f.name) + '</div>' + status + mapping;
    $$('select', el).forEach(function (s) {
      s.addEventListener('change', function () {
        f.map[s.getAttribute('data-field')] = s.value;
        renderDrop(kind);
        $('.mapping', el).open = true;
        if (kind === 'refs') refsFromFile();
        syncRefCars();
      });
    });
  }

  function normalized(kind) {
    var f = state.files[kind];
    if (!f || C.missingFields(f.map, kind).length) return [];
    return C.normalize(kind, f.rows, f.map).rows;
  }

  // -------------------------------------------------------------------------
  // Справочник
  // -------------------------------------------------------------------------
  function refsFromFile() {
    normalized('refs').forEach(function (r) {
      var row = findRef(r.car);
      if (!row) { row = { car: r.car }; state.refs.push(row); }
      row.norm = r.norm != null ? String(r.norm).replace('.', ',') : (row.norm || '');
      row.cards = r.cards.join(', ');
      row.reserve = r.reserve.join(', ');
      row.startFuel = r.startFuel ? String(r.startFuel).replace('.', ',') : '0';
      row.endFuel = r.endFuel ? String(r.endFuel).replace('.', ',') : '0';
    });
    renderRefs();
  }
  function findRef(car) {
    var k = C.plateKey(car);
    return state.refs.filter(function (r) { return C.plateKey(r.car) === k; })[0];
  }
  function syncRefCars() {
    var names = [];
    normalized('gps').forEach(function (r) { names.push(r.car); });
    normalized('waybills').forEach(function (r) { names.push(r.car); });
    var added = false;
    names.forEach(function (n) {
      if (!findRef(n)) { state.refs.push({ car: n, norm: '', cards: '', reserve: '', startFuel: '0', endFuel: '0' }); added = true; }
    });
    if (added) state.refs.sort(function (a, b) { return a.car.localeCompare(b.car, 'ru', { numeric: true }); });
    renderRefs();
  }
  var REF_COLS = ['car', 'norm', 'cards', 'reserve', 'startFuel', 'endFuel'];
  function renderRefs() {
    var tb = $('#refsTable tbody');
    if (!state.refs.length) {
      tb.innerHTML = '<tr><td colspan="7" class="muted">Машины появятся здесь после загрузки GPS или путевых листов. Или добавьте вручную.</td></tr>';
    } else {
      tb.innerHTML = state.refs.map(function (r, i) {
        return '<tr data-i="' + i + '">' + REF_COLS.map(function (c) {
          var v = r[c] == null ? '' : r[c];
          var need = c === 'norm' && !C.parseNumber(v);
          var ph = { car: '000 AAA 00', norm: 'напр. 12,5', cards: 'карта1, карта2', reserve: '', startFuel: '0', endFuel: '0' }[c];
          var im = (c === 'norm' || c === 'startFuel' || c === 'endFuel') ? ' inputmode="decimal"' : '';
          return '<td><input data-c="' + c + '" value="' + esc(v) + '" placeholder="' + ph + '"' + im + (need ? ' class="need"' : '') + ' aria-label="' + c + '"></td>';
        }).join('') + '<td><button class="del" type="button" title="Удалить строку" aria-label="Удалить">×</button></td></tr>';
      }).join('');
    }
    $$('tr', tb).forEach(function (tr) {
      var i = +tr.getAttribute('data-i');
      $$('input', tr).forEach(function (inp) {
        inp.addEventListener('input', function () {
          state.refs[i][inp.getAttribute('data-c')] = inp.value;
          if (inp.getAttribute('data-c') === 'norm') inp.classList.toggle('need', !C.parseNumber(inp.value));
        });
        inp.addEventListener('change', renderCardHints);
      });
      var del = $('.del', tr);
      if (del) del.addEventListener('click', function () { state.refs.splice(i, 1); renderRefs(); });
    });
    renderCardHints();
  }
  function refsNormalized() {
    return state.refs.filter(function (r) { return String(r.car || '').trim(); }).map(function (r) {
      return {
        car: String(r.car).trim(), norm: C.parseNumber(r.norm), cards: C.splitCards(r.cards), reserve: C.splitCards(r.reserve),
        startFuel: C.parseNumber(r.startFuel) || 0, endFuel: C.parseNumber(r.endFuel) || 0
      };
    });
  }
  function renderCardHints() {
    var known = {};
    refsNormalized().forEach(function (r) { r.cards.concat(r.reserve).forEach(function (c) { known[C.cardKey(c)] = true; }); });
    var free = {};
    normalized('fuel').forEach(function (f) {
      var k = C.cardKey(f.card);
      if (!known[k]) { free[k] = free[k] || { card: f.card, n: 0, cars: {} }; free[k].n++; if (f.car) free[k].cars[f.car] = true; }
    });
    var list = Object.keys(free).map(function (k) { return free[k]; });
    var fleet = {}, strangers = {};
    refsNormalized().forEach(function (r) { fleet[C.plateKey(r.car)] = true; });
    normalized('fuel').forEach(function (f) {
      var k = f.car ? C.plateKey(f.car) : '';
      if (k && !fleet[k]) { strangers[k] = strangers[k] || { car: f.car, n: 0 }; strangers[k].n++; }
    });
    var sList = Object.keys(strangers).map(function (k) { return strangers[k]; });
    var sHint = sList.length
      ? '<div class="hint-box"><b>Госномера из выгрузки АЗС, которых нет в вашем парке (' + sList.length + '):</b> ' +
        sList.slice(0, 40).map(function (x) { return esc(x.car) + ' <span class="muted">(' + x.n + ' заправ.)</span>'; }).join('; ') + (sList.length > 40 ? '…' : '') +
        '<br><span class="muted">Эти заправки будут показаны как «машины не из парка». Если это ваша машина или номер записан с ошибкой — добавьте его строкой в справочник.</span></div>'
      : '';
    $('#cardHints').innerHTML = sHint + (list.length
      ? '<div class="hint-box"><b>Карты из выгрузки АЗС, которые не закреплены ни за одной машиной (' + list.length + '):</b> ' +
        list.slice(0, 40).map(function (x) {
          var cars = Object.keys(x.cars);
          return esc(x.card) + ' <span class="muted">(' + x.n + ' заправ.' + (cars.length ? ', ' + esc(cars.slice(0, 2).join(', ')) : '') + ')</span>';
        }).join('; ') + (list.length > 40 ? '…' : '') + '<br><span class="muted">Впишите их в колонку «Закреплённые карты» нужной машины — иначе эти заправки попадут в «неизвестные карты».</span></div>'
      : '');
  }

  // -------------------------------------------------------------------------
  // Проверка
  // -------------------------------------------------------------------------
  function settings() {
    return {
      gpsTolPct: C.parseNumber($('#setGps').value) || 0,
      fuelTolPct: C.parseNumber($('#setFuel').value) || 0,
      redPct: C.parseNumber($('#setRed').value) || 15,
      defaultPrice: C.parseNumber($('#setPrice').value) || 0
    };
  }
  function runCheck() {
    var msg = $('#checkMsg');
    var gps = normalized('gps'), wbs = normalized('waybills'), fuel = normalized('fuel');
    if (!gps.length && !wbs.length) { msg.className = 'check-msg bad'; msg.textContent = 'Загрузите GPS или путевые листы — без пробега сверять не с чем.'; return; }
    if (!fuel.length) { msg.className = 'check-msg bad'; msg.textContent = 'Загрузите выгрузку АЗС по топливным картам.'; return; }
    var refs = refsNormalized();
    var noNorm = refs.filter(function (r) { return !r.norm; }).length;
    state.result = C.analyze({ gps: gps, waybills: wbs, fuel: fuel, refs: refs, settings: settings() });
    state.fuelHasCar = fuel.some(function (f) { return f.car; });
    msg.className = 'check-msg';
    msg.textContent = 'Готово: проверено ' + state.result.cars.length + ' машин.' + (noNorm ? ' У ' + noNorm + ' нет нормы — для них слив не считался.' : '');
    state.car = state.result.top5[0] ? state.result.top5[0].key : (state.result.cars[0] && state.result.cars[0].key);
    renderResults();
    $('#results').hidden = false;
    showTab('summary');
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function loadDemo() {
    var demo = D.generate();
    state.refs = [];
    setTable('gps', SAMPLE_NAMES.gps, demo.gps);
    setTable('waybills', SAMPLE_NAMES.waybills, demo.waybills);
    setTable('fuel', SAMPLE_NAMES.fuel, demo.fuel);
    setTable('refs', SAMPLE_NAMES.refs, demo.refs);
    state.demo = true;
    runCheck();
    toast('Загружен пример: 12 машин, октябрь 2026. Найдите четыре нарушения!');
  }

  function downloadSample(kind) {
    var demo = D.generate();
    var blob = new Blob(['﻿' + D.toCSV(demo[kind])], { type: 'text/csv;charset=utf-8' });
    saveBlob(blob, SAMPLE_NAMES[kind]);
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // -------------------------------------------------------------------------
  // Результаты
  // -------------------------------------------------------------------------
  function showTab(name) {
    $$('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === name)); });
    $$('.panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    if (name === 'car') renderCar();
  }

  function renderResults() {
    renderSummary();
    renderCar();
    renderCards();
    renderExport();
  }

  function mainIssue(c) {
    var order = ['outsider', 'fuel', 'odometer', 'foreignOut', 'foreignIn', 'idle', 'odogap', 'nonorm', 'nogps'];
    var best = null;
    order.some(function (t) { best = c.issues.filter(function (i) { return i.type === t; })[0]; return best; });
    return best ? best.text : 'Замечаний нет';
  }

  function renderSummary() {
    var R = state.result, T = R.totals;
    var period = R.period.from ? fdate(R.period.from) + ' — ' + fdate(R.period.to) : '';
    var months = R.days.length ? R.days.length / 30.4 : 1;
    var yearly = T.unexplainedTg / months * 12;
    var hasMoney = T.unexplainedTg > 0 || T.unexplainedL > 0;
    var h = '';
    if (state.demo) h += '<div class="explain no-print" style="margin-bottom:16px">Это пример на выдуманных данных. В нём спрятаны четыре нарушения: заправки чужой машины картой компании, слив, подкрученный одометр и карта, «гуляющая» между машинами парка. Нажмите на машину, чтобы посмотреть подробности.</div>';
    h += '<div class="total' + (hasMoney ? '' : ' ok') + '">' +
      '<div class="total-label">Не объяснено за период ' + esc(period) + '</div>' +
      '<div class="total-num">' + (T.unexplainedTg > 0 ? tg(T.unexplainedTg) : fmt(T.unexplainedL) + ' л') + '</div>' +
      '<div class="total-sub">' + (hasMoney ? fmt(T.unexplainedL) + ' л топлива: заправлено сверх нормы на пробег по GPS или ушло в чужие машины' + (T.outsiderL ? ', из них ' + fmt(T.outsiderL) + ' л — в машины не из вашего парка' : '') + (T.unknownL ? (T.outsiderL ? ', ' : ', из них ') + fmt(T.unknownL) + ' л — по неизвестным картам' : '') : 'Расхождений выше порога не найдено — хороший результат.') + '</div>' +
      (T.unexplainedTg > 0 && months < 2 ? '<div class="total-year">Если так каждый месяц — это <b>≈ ' + tg(Math.round(yearly / 1000) * 1000) + ' в год</b>.</div>' : '') +
      '</div>';
    h += '<div class="stats">' +
      stat(T.cars, 'машин проверено') +
      stat('<span style="color:var(--red)">' + T.red + '</span>', 'красных — проверить срочно') +
      stat('<span style="color:var(--yellow-ink)">' + T.yellow + '</span>', 'жёлтых — есть вопросы') +
      stat('<span style="color:var(--green-ink)">' + T.green + '</span>', 'зелёных — в норме') +
      stat('<span style="color:' + (T.outsiderCount ? 'var(--red)' : 'inherit') + '">' + T.outsiderCount + '</span>', 'заправок машин не из парка' + (T.outsiderTg ? ' · ' + tg(T.outsiderTg) : '')) +
      stat(T.foreignCount, 'заправок картой другой машины парка') +
      stat(fmt(T.fuelL), 'литров заправлено всего') + '</div>';

    h += '<div class="card"><h3 style="margin-top:0">ТОП-5 машин с расхождениями</h3>';
    if (R.top5.length) {
      h += '<ol class="top5">' + R.top5.map(function (c) {
        return '<li data-car="' + esc(c.key) + '" tabindex="0"><span class="top5-car">' + esc(c.car) + ' ' + badge(c.status) + '</span>' +
          '<span class="top5-sum">' + (c.unexplainedTg ? tg(c.unexplainedTg) : (c.unexplainedL ? fmt(c.unexplainedL) + ' л' : '—')) + '</span>' +
          '<span class="top5-why">' + esc(mainIssue(c)) + '</span></li>';
      }).join('') + '</ol>';
    } else h += '<p class="empty">Нет машин с расхождениями выше порогов.</p>';
    h += '</div>';

    h += '<div class="card"><h3 style="margin-top:0">Светофор по машинам</h3>' +
      '<div class="legend-row"><span>' + badge('red') + '</span><span>' + badge('yellow') + '</span><span>' + badge('green') + '</span></div>' +
      '<div class="lights">' + R.cars.map(function (c) {
        return '<button class="light ' + c.status + '" data-car="' + esc(c.key) + '" type="button">' +
          '<div class="light-car"><span>' + esc(c.car) + '</span><span class="badge ' + c.status + '" title="' + STATUS[c.status] + '">' + ICON[c.status] + '</span></div>' +
          '<div class="light-row"><span>Топливо к норме</span><b>' + (c.excessPct == null ? '—' : (c.excessPct > 0 ? '+' : '') + pct(c.excessPct)) + '</b></div>' +
          '<div class="light-row"><span>Путевые к GPS</span><b>' + (c.wbDiffPct == null ? '—' : (c.wbDiffPct > 0 ? '+' : '') + pct(c.wbDiffPct)) + '</b></div>' +
          '<div class="light-row"><span>Не объяснено</span><b>' + (c.unexplainedTg ? tg(c.unexplainedTg) : '—') + '</b></div>' +
          '</button>';
      }).join('') + '</div></div>';
    $('#panel-summary').innerHTML = h;
    $$('#panel-summary [data-car]').forEach(function (el) {
      var go = function () { state.car = el.getAttribute('data-car'); showTab('car'); window.scrollTo({ top: $('#results').offsetTop - 56, behavior: 'smooth' }); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
  }
  function stat(v, l) { return '<div class="stat"><div class="stat-v">' + v + '</div><div class="stat-l">' + l + '</div></div>'; }

  function destroyCharts() { state.charts.forEach(function (ch) { ch.destroy(); }); state.charts = []; }

  function renderCar() {
    var R = state.result; if (!R) return;
    var c = R.cars.filter(function (x) { return x.key === state.car; })[0] || R.cars[0];
    if (!c) { $('#panel-car').innerHTML = '<p class="empty">Нет машин</p>'; return; }
    state.car = c.key;
    destroyCharts();
    var h = '<div class="car-pick"><label for="carSel" class="muted">Машина:</label><select id="carSel">' +
      R.cars.map(function (x) { return '<option value="' + esc(x.key) + '"' + (x.key === c.key ? ' selected' : '') + '>' + esc(x.car) + ' — ' + STATUS[x.status] + '</option>'; }).join('') +
      '</select>' + badge(c.status) + '<span class="print-only"><b>' + esc(c.car) + '</b></span></div>';

    h += '<div class="card"><div class="kpis">' +
      kpi('Норма', c.norm ? fmt(c.norm, 1) + ' <small>л/100 км</small>' : 'нет') +
      kpi('Пробег по GPS', c.hasGps ? fmt(c.gpsKm) + ' <small>км</small>' : 'нет данных') +
      kpi('По путевым листам', c.hasWb ? fmt(c.wbKm) + ' <small>км</small>' + (c.wbDiffPct != null ? ' <small>(' + (c.wbDiffPct > 0 ? '+' : '') + pct(c.wbDiffPct) + ')</small>' : '') : 'нет данных', c.wbFlag) +
      kpi('Заправлено', fmt(c.fuelL) + ' <small>л · ' + tg(c.fuelTg) + '</small>') +
      kpi('Расчётный пробег по заправкам', c.calcKm != null ? fmt(c.calcKm) + ' <small>км</small>' : '—', c.fuelFlag) +
      kpi('Не объяснено', c.unexplainedL ? fmt(c.unexplainedL) + ' <small>л</small> · ' + tg(c.unexplainedTg) : '0', c.fuelFlag) +
      '</div>';
    h += '<p class="small muted" style="margin:10px 0 0">Расчётный пробег = (остаток на начало ' + fmt(c.startFuel) + ' л + заправлено ' + fmt(c.fuelL) + ' л − остаток на конец ' + fmt(c.endFuel) + ' л) ÷ норма × 100.' +
      (c.drivers.length ? ' Водители: ' + esc(c.drivers.join(', ')).replace(/\.$/, '') + '.' : '') +
      (c.cards.length ? ' Карты: ' + esc(c.cards.join(', ')) + '.' : '') + (c.reserve.length ? ' Резервные: ' + esc(c.reserve.join(', ')) + '.' : '') + '</p>';
    h += '<ul class="issues">' + (c.issues.length ? c.issues.map(function (i) {
      return '<li class="' + i.severity + '"><span class="ico">' + ICON[i.severity] + '</span><span>' + esc(i.text) + '</span></li>';
    }).join('') : '<li class="green"><span class="ico">✓</span><span>Расход сходится с пробегом в пределах допуска, чужих карт нет.</span></li>') + '</ul></div>';

    h += '<div class="grid-2">' +
      '<div class="card"><h3 style="margin-top:0">Пробег нарастающим итогом, км</h3>' +
      '<div class="chart-legend"><span><i style="background:' + COLORS.gps + '"></i>GPS</span><span><i style="background:' + COLORS.wb + '"></i>Путевые листы</span><span><i style="background:' + COLORS.calc + '"></i>Расчётный по заправкам</span></div>' +
      '<div class="chart-box"><canvas id="chCum" role="img" aria-label="Пробег нарастающим итогом"></canvas></div>' +
      '<p class="chart-note">Если зелёная линия уходит выше синей — заправлено больше, чем нужно на пробег. Если оранжевая выше синей — в путевых листах «лишние» километры.</p></div>' +
      '<div class="card"><h3 style="margin-top:0">Пробег по дням, км</h3>' +
      '<div class="chart-legend"><span><i class="sq" style="background:' + COLORS.gps + '"></i>GPS</span><span><i class="sq" style="background:' + COLORS.wb + '"></i>Путевые листы</span></div>' +
      '<div class="chart-box"><canvas id="chDay" role="img" aria-label="Пробег по дням"></canvas></div>' +
      '<p class="chart-note">Дни, где GPS — ноль, а заправки есть, отмечены в списке заправок ниже.</p></div></div>';

    h += '<div class="card"><h3 style="margin-top:0">Заправки (' + c.fuelings.length + ')</h3>' + fuelTable(c.fuelings, false) + '</div>';
    if (c.outsiderOut.length) h += '<div class="card"><h3 style="margin-top:0">Картами этой машины заправляли машины не из парка (' + c.outsiderOut.length + ')</h3>' + fuelTable(c.outsiderOut, true) + '</div>';
    if (c.foreignOut.length) h += '<div class="card"><h3 style="margin-top:0">Карты этой машины заправляли другие машины парка (' + c.foreignOut.length + ')</h3>' + fuelTable(c.foreignOut, true) + '</div>';
    if (c.waybills.length) {
      h += '<details class="card"><summary><b>Путевые листы (' + c.waybills.length + ')</b></summary><div class="table-scroll" style="margin-top:10px"><table><thead><tr><th>Дата</th><th>Водитель</th><th class="r">Выезд, км</th><th class="r">Возврат, км</th><th class="r">Пробег</th><th class="r">GPS</th><th class="r">Разница</th></tr></thead><tbody>' +
        c.waybills.map(function (w) {
          var g = (c.daily.filter(function (d) { return d.date === w.date; })[0] || {}).gps || 0;
          var diff = g ? (w.km - g) / g * 100 : null;
          var bad = diff != null && Math.abs(diff) > state.result.settings.gpsTolPct;
          return '<tr' + (bad ? ' class="flag"' : '') + '><td>' + fdate(w.date) + '</td><td>' + esc(w.driver) + '</td><td class="r">' + fmt(w.odoOut) + '</td><td class="r">' + fmt(w.odoIn) + '</td><td class="r">' + fmt(w.km) + '</td><td class="r">' + fmt(g) + '</td><td class="r">' + (diff == null ? '—' : (diff > 0 ? '+' : '') + pct(diff)) + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
    }
    $('#panel-car').innerHTML = h;
    $('#carSel').addEventListener('change', function (e) { state.car = e.target.value; renderCar(); });
    if (!$('#panel-car').hidden || window.matchMedia('print').matches) drawCharts(c);
  }
  function kpi(l, v, hot) { return '<div class="kpi' + (hot ? ' hot' : '') + '"><div class="kpi-l">' + l + '</div><div class="kpi-v">' + v + '</div></div>'; }

  function fuelTable(rows, showCar) {
    if (!rows.length) return '<p class="empty">Заправок нет</p>';
    return '<div class="table-scroll"><table><thead><tr><th>Дата</th><th>Время</th><th>Карта</th>' + (showCar ? '<th>Заправлена машина</th>' : '') + '<th>АЗС</th><th class="r">Литры</th><th class="r">Сумма, ₸</th><th>Отметки</th></tr></thead><tbody>' +
      rows.map(function (f) {
        var cls = f.flags.length ? (f.foreign ? ' class="flag-red"' : ' class="flag"') : '';
        return '<tr' + cls + '><td>' + fdate(f.date) + '</td><td>' + esc(f.time) + '</td><td>' + esc(f.card) + (f.reserveCard ? ' <span class="muted small">(резерв)</span>' : '') + '</td>' +
          (showCar ? '<td>' + esc(f.actualCar || '—') + '</td>' : '') +
          '<td>' + esc(f.station) + '</td><td class="r">' + fmt(f.liters, 1) + '</td><td class="r">' + fmt(f.amount) + '</td><td class="flags">' + esc(f.flags.join('; ')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function drawCharts(c) {
    if (typeof Chart === 'undefined') return;
    var labels = c.daily.map(function (d) { return d.date.slice(8, 10) + '.' + d.date.slice(5, 7); });
    var base = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#12181f', padding: 10, titleFont: { weight: '600' },
          callbacks: { label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y) + ' км'; } }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#c3c2b7' }, ticks: { color: COLORS.axis, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: COLORS.axis, callback: function (v) { return fmt(v); } } }
      }
    };
    var line = function (label, data, color) {
      return { label: label, data: data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.15, spanGaps: true };
    };
    var ds = [];
    if (c.hasGps) ds.push(line('GPS', c.daily.map(function (d) { return d.cumGps; }), COLORS.gps));
    if (c.hasWb) ds.push(line('Путевые листы', c.daily.map(function (d) { return d.cumWb; }), COLORS.wb));
    if (c.norm) ds.push(line('Расчётный по заправкам', c.daily.map(function (d) { return d.cumCalc; }), COLORS.calc));
    state.charts.push(new Chart($('#chCum'), { type: 'line', data: { labels: labels, datasets: ds }, options: base }));
    var bars = [];
    var bar = function (label, data, color) { return { label: label, data: data, backgroundColor: color, borderRadius: 3, borderSkipped: 'bottom', barPercentage: 0.9, categoryPercentage: 0.75 }; };
    if (c.hasGps) bars.push(bar('GPS', c.daily.map(function (d) { return d.gps; }), COLORS.gps));
    if (c.hasWb) bars.push(bar('Путевые листы', c.daily.map(function (d) { return d.wb; }), COLORS.wb));
    state.charts.push(new Chart($('#chDay'), { type: 'bar', data: { labels: labels, datasets: bars }, options: base }));
  }

  function renderCards() {
    var R = state.result, h = '';
    h += '<div class="explain" style="margin-bottom:16px">Каждая топливная карта считается как отдельный счёт: сколько литров по ней ушло и в какие машины. ' +
      (state.fuelHasCar
        ? 'В выгрузке АЗС есть госномер — поэтому видно, какую машину на самом деле заправили.'
        : 'В вашей выгрузке АЗС нет колонки с госномером, поэтому заправки чужих машин видны косвенно: как перерасход у машины, за которой закреплена карта (сводка и «По машине»), и как заправки в дни, когда она стояла (по GPS).') + '</div>';

    var T = R.totals;
    h += '<div class="card"><h3 style="margin-top:0">Заправки машин не из вашего парка' + (T.outsiderCount ? ' — ' + tg(T.outsiderTg) : '') + '</h3>';
    if (R.outsiders.length) {
      h += '<div class="table-scroll"><table><thead><tr><th>Заправлена машина</th><th>Карта</th><th>Закреплена за</th><th class="r">Заправок</th><th class="r">Литры</th><th class="r">Сумма, ₸</th><th>Даты</th></tr></thead><tbody>' +
        R.outsiders.map(function (o) {
          return '<tr class="flag-red"><td><b>' + esc(o.plate) + '</b></td><td>' + esc(o.card) + '</td><td><b>' + esc(o.ownerCar || 'не закреплена') + '</b></td><td class="r">' + o.count + '</td><td class="r">' + fmt(o.liters, 1) + '</td><td class="r">' + fmt(o.amount) + '</td><td>' +
            o.rows.map(function (f) { return fdate(f.date).slice(0, 5) + (f.time ? ' ' + esc(f.time) : ''); }).join(', ') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<p class="small muted">Это машины, которых нет ни в справочнике, ни в GPS, ни в путевых листах. Что проверить: чья это машина, кто был водителем у машины-владельца карты в эти дни. Если это ваша машина или номер на АЗС записан с ошибкой — добавьте его в справочник и нажмите «Проверить» ещё раз.</p>';
    } else h += '<p class="empty">' + (state.fuelHasCar ? 'Не найдено: все заправки — машины вашего парка.' : 'Без госномера в выгрузке АЗС такие заправки напрямую не видны — смотрите перерасход по машинам и заправки в дни простоя ниже.') + '</p>';
    h += '</div>';

    h += '<div class="card"><h3 style="margin-top:0">Картой одной машины парка заправили другую</h3>';
    if (R.flows.length) {
      h += '<div class="table-scroll"><table><thead><tr><th>Карта</th><th>Закреплена за</th><th>Заправляла</th><th class="r">Заправок</th><th class="r">Литры</th><th class="r">Сумма, ₸</th><th class="r">Из них владелец стоял</th></tr></thead><tbody>' +
        R.flows.map(function (f) {
          return '<tr class="flag-red"><td>' + esc(f.card) + '</td><td><b>' + esc(f.ownerCar || 'не закреплена') + '</b></td><td><b>' + esc(f.actualCar) + '</b></td><td class="r">' + f.count + '</td><td class="r">' + fmt(f.liters, 1) + '</td><td class="r">' + fmt(f.amount) + '</td><td class="r">' + (f.ownerCar ? f.ownerIdle + ' дн.' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<p class="small muted">Что проверить: кто был водителем в эти дни, почему не работала своя карта, не уходило ли топливо в канистры. Особенно подозрительно, если машина-владелец карты в это время стояла.</p>';
    } else h += '<p class="empty">' + (state.fuelHasCar ? 'Не найдено: каждая карта заправляла свою машину.' : 'Без госномера в выгрузке АЗС прямые перетоки не видны — смотрите заправки в дни простоя ниже.') + '</p>';
    h += '</div>';

    var idle = [];
    R.cars.forEach(function (c) { c.idleFuel.forEach(function (f) { idle.push({ car: c.car, f: f }); }); });
    if (idle.length) {
      h += '<div class="card"><h3 style="margin-top:0">Заправки в дни, когда машина не ездила (' + idle.length + ')</h3><div class="table-scroll"><table><thead><tr><th>Машина</th><th>Дата</th><th>Время</th><th>Карта</th><th>АЗС</th><th class="r">Литры</th><th class="r">Сумма, ₸</th></tr></thead><tbody>' +
        idle.map(function (x) { return '<tr class="flag"><td><b>' + esc(x.car) + '</b></td><td>' + fdate(x.f.date) + '</td><td>' + esc(x.f.time) + '</td><td>' + esc(x.f.card) + '</td><td>' + esc(x.f.station) + '</td><td class="r">' + fmt(x.f.liters, 1) + '</td><td class="r">' + fmt(x.f.amount) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>';
    }

    if (R.unknownFuel.length) {
      h += '<div class="card"><h3 style="margin-top:0">Неизвестные карты — не закреплены ни за одной машиной (' + R.unknownFuel.length + ' заправок)</h3>' + fuelTable(R.unknownFuel, false) + '</div>';
    }
    if (R.cardConflicts.length) {
      h += '<div class="card"><h3 style="margin-top:0">Одна карта закреплена за несколькими машинами</h3><ul>' + R.cardConflicts.map(function (x) { return '<li>' + esc(x.card) + ': ' + esc(x.cars.join(', ')) + '</li>'; }).join('') + '</ul></div>';
    }

    h += '<div class="card"><h3 style="margin-top:0">Баланс по каждой карте</h3><div class="table-scroll"><table><thead><tr><th>Карта</th><th>Закреплена за</th><th class="r">Заправок</th><th class="r">Литры</th><th class="r">Сумма, ₸</th><th>Куда ушло топливо</th></tr></thead><tbody>' +
      R.cards.map(function (cs) {
        var bad = cs.foreignL > 0 || !cs.owner;
        return '<tr' + (cs.outsiderL > 0 ? ' class="flag-red"' : bad ? ' class="flag"' : '') + '><td>' + esc(cs.card) + (cs.reserve ? ' <span class="muted small">(резерв)</span>' : '') + '</td><td>' + esc(cs.owner || '— нет —') + '</td><td class="r">' + cs.count + '</td><td class="r">' + fmt(cs.liters, 1) + '</td><td class="r">' + fmt(cs.amount) + '</td><td>' +
          cs.byCarList.map(function (b) {
            var t = esc(b.car) + ': ' + fmt(b.liters) + ' л';
            return b.own ? t : (b.outsider ? '<b style="color:var(--red)">' + t + '</b>' : '<b>' + t + '</b>');
          }).join('<br>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    $('#panel-cards').innerHTML = h;
  }

  function renderExport() {
    $('#panel-export').innerHTML = '<div class="card"><h3 style="margin-top:0">Сохранить отчёт</h3>' +
      '<p class="muted">Файл создаётся прямо на вашем устройстве — никуда не отправляется.</p>' +
      '<div class="export-actions"><button class="btn btn-primary" id="btnXlsx" type="button">Скачать отчёт в Excel</button>' +
      '<button class="btn btn-ghost" id="btnPrint" type="button">Печать или PDF</button>' +
      '<button class="btn btn-ghost" id="btnCopy" type="button">Скопировать краткий итог</button></div>' +
      '<p class="small muted">Для PDF: нажмите «Печать или PDF» и выберите принтер «Сохранить как PDF». В отчёт попадут сводка, выбранная машина и «Куда ушло топливо».</p></div>';
    $('#btnXlsx').addEventListener('click', exportXlsx);
    $('#btnPrint').addEventListener('click', printReport);
    $('#btnCopy').addEventListener('click', copySummary);
  }

  function printReport() {
    $$('.panel').forEach(function (p) { p.hidden = false; });
    var c = state.result.cars.filter(function (x) { return x.key === state.car; })[0];
    destroyCharts(); if (c) drawCharts(c);
    setTimeout(function () { window.print(); showTab('export'); }, 300);
  }

  function summaryText() {
    var R = state.result; if (!R) return '';
    var T = R.totals;
    var lines = ['Сверка ГСМ: итог за ' + fdate(R.period.from) + ' — ' + fdate(R.period.to),
      'Машин: ' + T.cars + ' (красных ' + T.red + ', жёлтых ' + T.yellow + ', зелёных ' + T.green + ')',
      'Не объяснено: ' + fmt(T.unexplainedL) + ' л ≈ ' + fmt(T.unexplainedTg) + ' ₸',
      'Заправок машин не из парка: ' + T.outsiderCount + (T.outsiderTg ? ' (' + fmt(T.outsiderL) + ' л ≈ ' + fmt(T.outsiderTg) + ' ₸)' : ''),
      'Заправок картой другой машины парка: ' + T.foreignCount, '', 'ТОП машин:'];
    R.top5.forEach(function (c, i) { lines.push((i + 1) + '. ' + c.car + ' — ' + mainIssue(c)); });
    return lines.join('\n');
  }
  function copySummary() {
    if (!state.result) { toast('Сначала запустите проверку или пример.'); return; }
    var text = summaryText();
    var done = function () { toast('Итог скопирован. Вставьте его в сообщение эксперту.'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Не получилось скопировать'); }
      ta.remove();
    }
  }

  function exportXlsx() {
    if (typeof XLSX === 'undefined') { toast('Не загрузилась библиотека Excel'); return; }
    var R = state.result, wb = XLSX.utils.book_new(), r1 = function (x) { return x == null || !isFinite(x) ? '' : Math.round(x * 10) / 10; };
    var sum = [['Сверка ГСМ — отчёт за период', fdate(R.period.from) + ' — ' + fdate(R.period.to)],
      ['Не объяснено, л', r1(R.totals.unexplainedL)], ['Не объяснено, ₸', Math.round(R.totals.unexplainedTg)],
      ['Машин', R.totals.cars], ['Красных', R.totals.red], ['Жёлтых', R.totals.yellow], ['Зелёных', R.totals.green],
      ['Заправок машин не из парка', R.totals.outsiderCount], ['Из них, ₸', Math.round(R.totals.outsiderTg)],
      ['Заправок картой другой машины парка', R.totals.foreignCount], [],
      ['Машина', 'Статус', 'Норма, л/100', 'GPS, км', 'Путевые, км', 'Путевые к GPS, %', 'Заправлено, л', 'Сумма, ₸', 'Остаток нач., л', 'Остаток кон., л', 'Расчётный пробег, км', 'Нужно по норме, л', 'Перерасход, л', 'Перерасход, %', 'Не объяснено, л', 'Не объяснено, ₸', 'Замечания']];
    R.cars.forEach(function (c) {
      sum.push([c.car, STATUS[c.status], c.norm || '', r1(c.gpsKm), r1(c.wbKm), r1(c.wbDiffPct), r1(c.fuelL), Math.round(c.fuelTg), c.startFuel, c.endFuel, r1(c.calcKm), r1(c.expectedL), r1(c.excessL), r1(c.excessPct), r1(c.unexplainedL), Math.round(c.unexplainedTg), c.issues.map(function (i) { return i.text; }).join('; ')]);
    });
    addSheet(wb, sum, 'Сводка', [16, 18, 10, 10, 10, 12, 12, 12, 10, 10, 12, 12, 12, 12, 12, 12, 80]);

    var fl = [['Машина', 'Дата', 'Время', 'Карта', 'Закреплена за', 'АЗС', 'Литры', 'Сумма, ₸', 'Отметки']];
    R.cars.forEach(function (c) { c.fuelings.forEach(function (f) { fl.push([c.car, fdate(f.date), f.time, f.card, f.ownerCar || '', f.station, f.liters, f.amount, f.flags.join('; ')]); }); });
    R.outsiderFuel.forEach(function (f) { fl.push([f.actualCar + ' (не из парка)', fdate(f.date), f.time, f.card, f.ownerCar || '', f.station, f.liters, f.amount, f.flags.join('; ')]); });
    R.unknownFuel.forEach(function (f) { fl.push(['—', fdate(f.date), f.time, f.card, '', f.station, f.liters, f.amount, f.flags.join('; ')]); });
    addSheet(wb, fl, 'Заправки', [14, 12, 8, 16, 14, 30, 10, 12, 60]);

    var cf = [['Заправки машин не из парка'], ['Заправлена машина', 'Карта', 'Закреплена за', 'Заправок', 'Литры', 'Сумма, ₸']];
    R.outsiders.forEach(function (o) { cf.push([o.plate, o.card, o.ownerCar || 'не закреплена', o.count, r1(o.liters), Math.round(o.amount)]); });
    cf.push([]); cf.push(['Картой одной машины парка заправили другую']);
    cf.push(['Карта', 'Закреплена за', 'Заправляла', 'Заправок', 'Литры', 'Сумма, ₸', 'Владелец стоял, дней']);
    R.flows.forEach(function (f) { cf.push([f.card, f.ownerCar || 'не закреплена', f.actualCar, f.count, r1(f.liters), Math.round(f.amount), f.ownerIdle]); });
    cf.push([]); cf.push(['Баланс по картам']); cf.push(['Карта', 'Закреплена за', 'Заправок', 'Литры', 'Сумма, ₸', 'На другие машины, л', 'Из них не из парка, л']);
    R.cards.forEach(function (c) { cf.push([c.card, c.owner || '—', c.count, r1(c.liters), Math.round(c.amount), r1(c.foreignL), r1(c.outsiderL)]); });
    addSheet(wb, cf, 'Куда ушло топливо', [20, 16, 16, 10, 10, 18, 18]);

    var wl = [['Машина', 'Дата', 'Водитель', 'Одометр выезд', 'Одометр возврат', 'Пробег, км']];
    R.cars.forEach(function (c) { c.waybills.forEach(function (w) { wl.push([c.car, fdate(w.date), w.driver, w.odoOut, w.odoIn, w.km]); }); });
    addSheet(wb, wl, 'Путевые листы', [14, 12, 18, 14, 14, 10]);

    var dl = [['Машина', 'Дата', 'GPS, км', 'Путевые, км', 'Заправлено, л']];
    R.cars.forEach(function (c) { c.daily.forEach(function (d) { dl.push([c.car, fdate(d.date), r1(d.gps), r1(d.wb), r1(d.fuel)]); }); });
    addSheet(wb, dl, 'По дням', [14, 12, 10, 12, 12]);

    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      'Сверка_ГСМ_' + (R.period.from || '').slice(0, 7) + '.xlsx');
  }
  function addSheet(wb, rows, name, widths) {
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(function (w) { return { wch: w }; });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // -------------------------------------------------------------------------
  // Старт
  // -------------------------------------------------------------------------
  function init() {
    buildDrops();
    renderRefs();
    $('#btnDemo').addEventListener('click', loadDemo);
    $('#btnCheck').addEventListener('click', runCheck);
    $('#btnAddCar').addEventListener('click', function () {
      state.refs.push({ car: '', norm: '', cards: '', reserve: '', startFuel: '0', endFuel: '0' });
      renderRefs();
      var inputs = $$('#refsTable tbody tr:last-child input'); if (inputs[0]) inputs[0].focus();
    });
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); }); });
    $('#btnCopy2').addEventListener('click', copySummary);
    var link = $('#contactLink');
    link.href = CFG.contactUrl || '#contact';
    if (CFG.contactLabel) link.textContent = CFG.contactLabel;
    if (!CFG.contactUrl || CFG.contactUrl.charAt(0) === '#') {
      link.removeAttribute('target');
      link.addEventListener('click', function (e) { e.preventDefault(); toast('Контакт автора ещё не указан (файл js/config.js).'); });
    }
    if (CFG.auditPrice) $('#auditPrice').textContent = CFG.auditPrice;
    window.addEventListener('beforeprint', function () {
      if (!state.result) return;
      $$('.panel').forEach(function (p) { p.hidden = false; });
    });
    if (/[?&#]demo\b/.test(location.search + location.hash)) loadDemo();
  }
  init();
})();
