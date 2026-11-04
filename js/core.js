/*
 * Сверка ГСМ — ядро: разбор данных и все расчёты.
 * Работает в браузере (window.SverkaCore) и в Node.js (require) — для тестов.
 * Никаких сетевых запросов: данные не покидают компьютер пользователя.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SverkaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Настройки по умолчанию
  // ---------------------------------------------------------------------------
  var DEFAULT_SETTINGS = {
    gpsTolPct: 5,     // погрешность GPS, ±% — ниже не подсвечиваем
    fuelTolPct: 5,    // допуск расхода сверх нормы, % — ниже не подсвечиваем
    redPct: 15,       // выше этого — «красный»
    defaultPrice: 0   // цена литра, если в выгрузке АЗС нет суммы (0 — не считать)
  };

  // ---------------------------------------------------------------------------
  // Описание колонок для каждого файла (для автоматического и ручного сопоставления)
  // ---------------------------------------------------------------------------
  var FIELDS = {
    gps: [
      { key: 'car', label: 'Машина (госномер)', required: true, syn: ['госномер', 'гос номер', 'гос. номер', 'машина', 'автомобиль', 'тс', 'объект', 'номер', 'vehicle', 'plate'] },
      { key: 'date', label: 'Дата', required: true, syn: ['дата', 'день', 'date'] },
      { key: 'km', label: 'Пробег за день, км', required: true, syn: ['пробег', 'км', 'расстояние', 'distance', 'mileage'] }
    ],
    waybills: [
      { key: 'car', label: 'Машина (госномер)', required: true, syn: ['госномер', 'гос номер', 'гос. номер', 'машина', 'автомобиль', 'тс', 'номер', 'vehicle', 'plate'] },
      { key: 'driver', label: 'Водитель', required: false, syn: ['водитель', 'фио', 'driver'] },
      { key: 'date', label: 'Дата', required: true, syn: ['дата', 'день', 'date'] },
      { key: 'odoOut', label: 'Одометр на выезде', required: true, syn: ['одометр на выезде', 'на выезде', 'при выезде', 'выезд', 'начальн', 'odo out', 'start'] },
      { key: 'odoIn', label: 'Одометр на возврате', required: true, syn: ['одометр на возврате', 'на возврате', 'при возвращении', 'возврат', 'возвращ', 'конечн', 'odo in', 'end'] }
    ],
    fuel: [
      { key: 'card', label: 'Номер карты', required: true, syn: ['номер карты', 'карта', 'карты', 'card'] },
      { key: 'date', label: 'Дата (и время)', required: true, syn: ['дата и время', 'дата', 'date'] },
      { key: 'time', label: 'Время (если отдельной колонкой)', required: false, syn: ['время', 'time'] },
      { key: 'station', label: 'АЗС', required: false, syn: ['азс', 'станция', 'адрес', 'station'] },
      { key: 'liters', label: 'Литры', required: true, syn: ['литр', 'объем', 'кол-во', 'количество', 'liters', 'volume'] },
      { key: 'amount', label: 'Сумма, тенге', required: false, syn: ['сумма', 'стоимость', 'тенге', 'amount', 'тг'] },
      { key: 'fuelType', label: 'Вид топлива (АИ-92, ДТ…)', required: false, syn: ['вид топлива', 'марка топлива', 'нефтепродукт', 'топливо', 'продукт', 'товар', 'fuel'] },
      { key: 'car', label: 'Госномер (если АЗС его пишет)', required: false, syn: ['госномер', 'гос номер', 'гос. номер', 'машина', 'автомобиль', 'тс'] }
    ],
    refs: [
      { key: 'car', label: 'Машина (госномер)', required: true, syn: ['госномер', 'гос номер', 'машина', 'автомобиль', 'тс', 'номер'] },
      { key: 'norm', label: 'Норма, л/100 км', required: true, syn: ['норма', 'л/100', 'расход'] },
      { key: 'cards', label: 'Закреплённые карты', required: false, syn: ['закрепленные карты', 'закреплен', 'карты', 'карта'] },
      { key: 'reserve', label: 'Резервные карты', required: false, syn: ['резерв'] },
      { key: 'startFuel', label: 'Остаток на начало, л', required: false, syn: ['остаток на начало', 'на начало', 'начало'] },
      { key: 'endFuel', label: 'Остаток на конец, л', required: false, syn: ['остаток на конец', 'на конец', 'конец'] },
      { key: 'fuelType', label: 'Вид топлива', required: false, syn: ['вид топлива', 'марка топлива', 'топливо', 'марка'] },
      { key: 'tank', label: 'Объём бака, л', required: false, syn: ['объем бака', 'бак', 'емкость'] }
    ]
  };

  // ---------------------------------------------------------------------------
  // Разбор значений
  // ---------------------------------------------------------------------------
  function lc(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }

  /** Число: понимает «1 234,5», «1234.5», «1.234,5», «225 ₸». Пусто/мусор → null. */
  function parseNumber(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[\s  ]/g, '').replace(/[^\d,.\-]/g, '');
    if (!s || s === '-' ) return null;
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      // оба разделителя: последний — десятичный
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      s = s.replace(/,/g, function (m, i) { return i === lastComma ? '.' : ''; });
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function validYMD(y, m, d) {
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= dim;
  }

  /**
   * Дата и время: ДД.ММ.ГГГГ, ДД.ММ.ГГ, ДД/ММ/ГГГГ, ГГГГ-ММ-ДД, с временем «ЧЧ:ММ[:СС]»,
   * а также серийный номер даты Excel и объект Date.
   * Возвращает { date: 'ГГГГ-ММ-ДД', time: 'ЧЧ:ММ' | '' } или null.
   */
  function parseDateTime(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
      return { date: isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate()), time: pad(v.getHours()) + ':' + pad(v.getMinutes()) };
    }
    if (typeof v === 'number') return fromExcelSerial(v);
    var s = String(v).trim();
    var m, y, mo, d, time = '';
    var tm = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (tm) time = pad(+tm[1]) + ':' + tm[2];
    if ((m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/))) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/))) {
      d = +m[1]; mo = +m[2]; y = +m[3];
      if (m[3].length === 2) y += 2000;
    } else if (/^\d+([.,]\d+)?$/.test(s)) {
      return fromExcelSerial(parseNumber(s));
    } else {
      return null;
    }
    if (!validYMD(y, mo, d)) return null;
    return { date: isoDate(y, mo, d), time: time };
  }

  function fromExcelSerial(n) {
    if (!(n > 20000 && n < 80000)) return null; // примерно 1954–2119 годы
    var ms = Math.round((n - 25569) * 86400000); // 25569 = 1970-01-01
    var dt = new Date(ms);
    var time = '';
    var frac = n - Math.floor(n);
    if (frac > 1e-6) time = pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes());
    return { date: isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), time: time };
  }

  function parseDate(v) { var r = parseDateTime(v); return r ? r.date : null; }

  function parseTime(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v >= 0 && v < 1) {
      var mins = Math.round(v * 1440);
      return pad(Math.floor(mins / 60) % 24) + ':' + pad(mins % 60);
    }
    var m = String(v).match(/(\d{1,2}):(\d{2})/);
    return m ? pad(+m[1]) + ':' + m[2] : '';
  }

  // Кириллические буквы, похожие на латинские, — чтобы «123 АВС 02» и «123ABC02» совпали
  var LOOKALIKE = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y' };

  /** Ключ госномера для сравнения: без пробелов/дефисов, заглавными, кириллица→латиница. */
  function plateKey(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/Ё/g, 'Е').replace(/[\s\-_.]/g, '')
      .replace(/[АВЕКМНОРСТХУ]/g, function (c) { return LOOKALIKE[c]; });
  }

  /** Ключ карты: только цифры (если они есть), иначе как госномер. */
  function cardKey(s) {
    var str = String(s == null ? '' : s).trim();
    if (typeof s === 'number') str = String(Math.round(s));
    var digits = str.replace(/\D/g, '');
    return digits.length >= 3 ? digits : plateKey(str);
  }

  /** Вид топлива к общему виду: «Аи-92», «92», «AI92» → «АИ-92»; «Дизель», «ДТ-Л» → «ДТ»; «Пропан» → «ГАЗ». */
  function fuelKind(s) {
    var t = lc(s).replace(/[\s\-_.]/g, '');
    if (!t) return '';
    if (/дт|диз|diesel|солярк/.test(t)) return 'ДТ';
    if (/газ|пропан|метан|lpg|cng|суг/.test(t)) return 'ГАЗ';
    var m = t.match(/(80|92|95|98|100)/);
    if (m) return 'АИ-' + m[1];
    return String(s).trim().toUpperCase();
  }
  /** Группа топлива: бензин / дизель / газ — заправка другой группы почти наверняка не в эту машину. */
  function fuelGroup(kind) { return kind === 'ДТ' ? 'дизель' : kind === 'ГАЗ' ? 'газ' : /^АИ-/.test(kind) ? 'бензин' : kind; }

  /** Список карт из ячейки: «1111, 2222; 3333» → ['1111','2222','3333'] */
  function splitCards(v) {
    if (v == null || v === '') return [];
    if (typeof v === 'number') return [String(Math.round(v))];
    return String(v).split(/[,;\n\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Таблицы: поиск строки заголовков и сопоставление колонок
  // ---------------------------------------------------------------------------

  /** Из массива строк (массивов ячеек) находит строку заголовков и возвращает { headers, rows(объекты) }. */
  function tableFromArrays(arr) {
    var hi = -1;
    for (var i = 0; i < Math.min(arr.length, 30); i++) {
      var row = arr[i] || [];
      var texts = row.filter(function (c) { return typeof c === 'string' && c.trim() && parseNumber(c) === null; });
      if (texts.length >= 2) { hi = i; break; }
    }
    if (hi < 0) return { headers: [], rows: [] };
    var headers = [], seen = {};
    arr[hi].forEach(function (h, j) {
      var name = String(h == null ? '' : h).trim() || ('Колонка ' + (j + 1));
      while (seen[name]) name += ' ';
      seen[name] = true;
      headers[j] = name;
    });
    var rows = [];
    for (var r = hi + 1; r < arr.length; r++) {
      var a = arr[r] || [];
      var empty = true, o = {};
      for (var k = 0; k < headers.length; k++) {
        var val = a[k] == null ? '' : a[k];
        if (val !== '' && String(val).trim() !== '') empty = false;
        o[headers[k]] = val;
      }
      if (!empty) rows.push(o);
    }
    return { headers: headers, rows: rows };
  }

  /** Автоматически подбирает колонки по заголовкам. Возвращает { поле: заголовок | '' }. */
  function autoMap(headers, kind) {
    var map = {}, used = {};
    FIELDS[kind].forEach(function (f) {
      var best = '', bestScore = 0;
      headers.forEach(function (h) {
        if (used[h]) return;
        var hl = lc(h);
        f.syn.forEach(function (s) {
          var sl = lc(s);
          var score = 0;
          if (hl === sl) score = 100 + sl.length;
          else if (sl.length <= 3 ? new RegExp('(^|[^a-zа-я])' + sl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-zа-я]|$)').test(hl) : hl.indexOf(sl) >= 0) score = sl.length;
          if (score > bestScore) { bestScore = score; best = h; }
        });
      });
      map[f.key] = best;
      if (best) used[best] = true;
    });
    return map;
  }

  function missingFields(map, kind) {
    return FIELDS[kind].filter(function (f) { return f.required && !map[f.key]; }).map(function (f) { return f.label; });
  }

  /** Превращает строки с произвольными заголовками в нормализованные записи. */
  function normalize(kind, rows, map) {
    var out = [], errors = [];
    function get(row, key) { return map[key] ? row[map[key]] : undefined; }
    rows.forEach(function (row, i) {
      var line = i + 2; // примерно номер строки в файле (после заголовка)
      var car, dt;
      if (kind === 'gps') {
        car = String(get(row, 'car') || '').trim();
        dt = parseDate(get(row, 'date'));
        var km = parseNumber(get(row, 'km'));
        if (!car || !dt || km == null) { errors.push('Строка ' + line + ': не распознана (машина, дата или пробег)'); return; }
        out.push({ car: car, date: dt, km: km });
      } else if (kind === 'waybills') {
        car = String(get(row, 'car') || '').trim();
        dt = parseDate(get(row, 'date'));
        var o1 = parseNumber(get(row, 'odoOut')), o2 = parseNumber(get(row, 'odoIn'));
        if (!car || !dt || o1 == null || o2 == null) { errors.push('Строка ' + line + ': не распознана (машина, дата или одометр)'); return; }
        out.push({ car: car, driver: String(get(row, 'driver') || '').trim(), date: dt, odoOut: o1, odoIn: o2 });
      } else if (kind === 'fuel') {
        var card = get(row, 'card');
        var p = parseDateTime(get(row, 'date'));
        var liters = parseNumber(get(row, 'liters'));
        if (card == null || String(card).trim() === '' || !p || liters == null) { errors.push('Строка ' + line + ': не распознана (карта, дата или литры)'); return; }
        var t = p.time || parseTime(get(row, 'time'));
        out.push({
          card: String(card).trim(), date: p.date, time: t,
          station: String(get(row, 'station') || '').trim(),
          liters: liters, amount: parseNumber(get(row, 'amount')),
          fuelType: String(get(row, 'fuelType') || '').trim(),
          car: String(get(row, 'car') || '').trim()
        });
      } else if (kind === 'refs') {
        car = String(get(row, 'car') || '').trim();
        if (!car) return;
        out.push({
          car: car, norm: parseNumber(get(row, 'norm')),
          cards: splitCards(get(row, 'cards')), reserve: splitCards(get(row, 'reserve')),
          startFuel: parseNumber(get(row, 'startFuel')) || 0, endFuel: parseNumber(get(row, 'endFuel')) || 0,
          fuelTypes: splitCards(get(row, 'fuelType')), tank: parseNumber(get(row, 'tank'))
        });
      }
    });
    return { rows: out, errors: errors };
  }

  // ---------------------------------------------------------------------------
  // Разбор CSV (своими силами — чтобы правильно понимать запятые и даты)
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    var firstLine = text.split(/\r?\n/)[0] || '';
    var cands = [';', '\t', ','], delim = ';', best = -1;
    cands.forEach(function (c) {
      var n = firstLine.split(c).length;
      if (n > best) { best = n; delim = c; }
    });
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Анализ
  // ---------------------------------------------------------------------------
  function r1(x) { return Math.round(x * 10) / 10; }
  /** «1 раз», «3 раза», «5 раз» */
  function times(n) {
    var m10 = n % 10, m100 = n % 100;
    return n + (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? ' раза' : ' раз');
  }
  function r0(x) { return Math.round(x); }
  function addDays(iso, n) {
    var p = iso.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  /**
   * Главный расчёт.
   * input = { gps:[], waybills:[], fuel:[], refs:[], settings:{} } — уже нормализованные записи.
   */
  function analyze(input) {
    var S = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { S[k] = DEFAULT_SETTINGS[k]; });
    Object.keys(input.settings || {}).forEach(function (k) { if (input.settings[k] != null) S[k] = input.settings[k]; });

    var gps = input.gps || [], wbs = input.waybills || [], fuel = input.fuel || [], refs = input.refs || [];
    var cars = {}; // ключ → данные машины
    function car(name) {
      var k = plateKey(name);
      if (!k) return null;
      if (!cars[k]) {
        cars[k] = {
          key: k, car: String(name).trim(), norm: null, cards: [], reserve: [], startFuel: 0, endFuel: 0, fuelTypes: [], tank: null,
          inRefs: false, gpsDays: {}, wbDays: {}, waybills: [], fuelings: [], drivers: {}
        };
      }
      return cars[k];
    }

    // Справочник и карты
    var cardOwner = {}; // ключ карты → { car, reserve, card }
    var cardConflicts = [];
    refs.forEach(function (r) {
      var c = car(r.car); if (!c) return;
      c.inRefs = true;
      c.car = String(r.car).trim();
      if (r.norm != null && r.norm > 0) c.norm = r.norm;
      c.startFuel = r.startFuel || 0;
      c.endFuel = r.endFuel || 0;
      c.fuelTypes = (r.fuelTypes || []).map(fuelKind).filter(Boolean);
      if (r.tank > 0) c.tank = r.tank;
      [['cards', false], ['reserve', true]].forEach(function (pair) {
        (r[pair[0]] || []).forEach(function (cd) {
          var ck = cardKey(cd);
          if (!ck) return;
          if (cardOwner[ck] && cardOwner[ck].carKey !== c.key) cardConflicts.push({ card: cd, cars: [cars[cardOwner[ck].carKey].car, c.car] });
          cardOwner[ck] = { carKey: c.key, reserve: pair[1], card: cd };
          (pair[1] ? c.reserve : c.cards).push(cd);
        });
      });
    });

    // GPS
    gps.forEach(function (g) {
      var c = car(g.car); if (!c) return;
      c.gpsDays[g.date] = (c.gpsDays[g.date] || 0) + g.km;
    });

    // Путевые листы
    wbs.forEach(function (w) {
      var c = car(w.car); if (!c) return;
      var km = w.odoIn - w.odoOut;
      c.waybills.push({ date: w.date, driver: w.driver, odoOut: w.odoOut, odoIn: w.odoIn, km: km });
      c.wbDays[w.date] = (c.wbDays[w.date] || 0) + km;
      if (w.driver) c.drivers[w.driver] = true;
    });

    // Парк — машины из справочника, GPS и путевых листов. Госномер из выгрузки АЗС,
    // которого нет в парке, — это чужая машина, заправленная картой компании.
    var fleet = {};
    Object.keys(cars).forEach(function (k) { fleet[k] = true; });

    // Заправки: на какую машину отнести
    var cardStats = {}, unknownFuel = [], foreignUses = [], outsiderFuel = [], allDates = [];
    fuel.forEach(function (f, idx) {
      var ck = cardKey(f.card);
      var owner = cardOwner[ck] ? cars[cardOwner[ck].carKey] : null;
      var pk = f.car ? plateKey(f.car) : '';
      if (pk && !fleet[pk]) {
        var oAmount = f.amount != null ? f.amount : (S.defaultPrice ? f.liters * S.defaultPrice : 0);
        var orec = {
          id: idx, card: f.card, cardKey: ck, date: f.date, time: f.time, station: f.station,
          liters: f.liters, amount: oAmount, price: f.amount != null && f.liters > 0 ? f.amount / f.liters : null, fuelType: f.fuelType ? fuelKind(f.fuelType) : '',
          ownerCar: owner ? owner.car : null, actualCar: String(f.car).trim(), plateKey: pk,
          reserveCard: !!(cardOwner[ck] && cardOwner[ck].reserve), foreign: true, outsider: true,
          flags: ['Машина ' + String(f.car).trim() + ' не из вашего парка']
        };
        allDates.push(f.date);
        if (!cardStats[ck]) cardStats[ck] = { card: f.card, owner: owner ? owner.car : null, reserve: orec.reserveCard, count: 0, liters: 0, amount: 0, byCar: {} };
        var ocs = cardStats[ck], oname = orec.actualCar + ' (не из парка)';
        ocs.count++; ocs.liters += f.liters; ocs.amount += oAmount;
        ocs.byCar[oname] = ocs.byCar[oname] || { liters: 0, amount: 0, count: 0, outsider: true };
        ocs.byCar[oname].liters += f.liters; ocs.byCar[oname].amount += oAmount; ocs.byCar[oname].count++;
        outsiderFuel.push(orec);
        return;
      }
      var actual = pk ? car(f.car) : null;
      var target = actual || owner;
      var price = f.amount != null && f.liters > 0 ? f.amount / f.liters : null;
      var amount = f.amount != null ? f.amount : (S.defaultPrice ? f.liters * S.defaultPrice : 0);
      var rec = {
        id: idx, card: f.card, cardKey: ck, date: f.date, time: f.time, station: f.station,
        liters: f.liters, amount: amount, price: price, fuelType: f.fuelType ? fuelKind(f.fuelType) : '',
        ownerCar: owner ? owner.car : null, actualCar: target ? target.car : null,
        reserveCard: !!(cardOwner[ck] && cardOwner[ck].reserve), foreign: false, flags: []
      };
      allDates.push(f.date);
      if (!cardStats[ck]) {
        cardStats[ck] = { card: f.card, owner: owner ? owner.car : null, reserve: rec.reserveCard, count: 0, liters: 0, amount: 0, byCar: {} };
      }
      var cs = cardStats[ck];
      cs.count++; cs.liters += f.liters; cs.amount += amount;
      var byName = target ? target.car : '— не указана —';
      cs.byCar[byName] = cs.byCar[byName] || { liters: 0, amount: 0, count: 0 };
      cs.byCar[byName].liters += f.liters; cs.byCar[byName].amount += amount; cs.byCar[byName].count++;

      if (!target) { rec.flags.push('Карта не закреплена ни за одной машиной'); unknownFuel.push(rec); return; }
      if (owner && actual && owner.key !== actual.key) {
        rec.foreign = true;
        rec.flags.push('Карта машины ' + owner.car + ' — заправлена ' + actual.car);
        foreignUses.push(rec);
      } else if (!owner) {
        rec.flags.push('Карта не указана в справочнике');
        rec.foreign = true;
        foreignUses.push(rec);
      }
      target.fuelings.push(rec);
    });

    // Период
    var dates = allDates.slice();
    Object.keys(cars).forEach(function (k) {
      dates = dates.concat(Object.keys(cars[k].gpsDays), Object.keys(cars[k].wbDays));
    });
    dates.sort();
    var period = { from: dates[0] || null, to: dates[dates.length - 1] || null };
    var days = [];
    if (period.from) { for (var d = period.from; d <= period.to; d = addDays(d, 1)) days.push(d); }

    // Расчёт по машинам
    var list = Object.keys(cars).map(function (k) {
      var c = cars[k];
      var hasGps = Object.keys(c.gpsDays).length > 0;
      var hasWb = c.waybills.length > 0;
      var gpsKm = 0, wbKm = 0;
      Object.keys(c.gpsDays).forEach(function (x) { gpsKm += c.gpsDays[x]; });
      c.waybills.forEach(function (w) { wbKm += w.km; });
      var fuelL = 0, fuelTg = 0, pricedL = 0, pricedTg = 0;
      c.fuelings.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
      c.fuelings.forEach(function (f) {
        fuelL += f.liters; fuelTg += f.amount;
        if (f.price) { pricedL += f.liters; pricedTg += f.amount; }
      });
      var avgPrice = pricedL ? pricedTg / pricedL : (S.defaultPrice || 0);
      var issues = [];

      // Не то топливо: карта дизельной машины, а куплен бензин (и наоборот) — заправили другую машину.
      // Такие литры в бак этой машины не попали: в расход их не берём, а целиком считаем необъяснёнными.
      var wrongFuel = [], wrongL = 0, wrongTg = 0, otherGrade = 0;
      if (c.fuelTypes.length) {
        var groups = c.fuelTypes.map(fuelGroup);
        c.fuelings.forEach(function (f) {
          if (!f.fuelType || c.fuelTypes.indexOf(f.fuelType) >= 0) return;
          if (groups.indexOf(fuelGroup(f.fuelType)) < 0) {
            f.wrongFuel = true; wrongFuel.push(f); wrongL += f.liters; wrongTg += f.amount;
            f.flags.push('Не то топливо: ' + f.fuelType + ', а у машины ' + c.fuelTypes.join(', ') + ' — заправлена другая машина');
          } else {
            otherGrade++;
            f.flags.push('Другая марка: ' + f.fuelType + ' вместо ' + c.fuelTypes.join(', '));
          }
        });
      }
      if (wrongFuel.length) {
        issues.push({
          type: 'wrongfuel', severity: 'red',
          text: 'По её картам куплено не то топливо (' + wrongFuel.map(function (f) { return f.fuelType; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') +
            ' вместо ' + c.fuelTypes.join(', ') + '): ' + times(wrongFuel.length) + ', ' + fmtNum(r0(wrongL)) + ' л' + (wrongTg ? ' ≈ ' + fmtNum(r0(wrongTg)) + ' ₸' : '') + ' — заправляли другую машину'
        });
      }
      if (otherGrade) issues.push({ type: 'grade', severity: 'yellow', text: 'Заправки другой маркой топлива: ' + times(otherGrade) });

      // GPS против путевых листов
      var wbDiffPct = null, wbFlag = false;
      if (hasGps && hasWb && gpsKm > 0) {
        wbDiffPct = (wbKm - gpsKm) / gpsKm * 100;
        if (Math.abs(wbDiffPct) > S.gpsTolPct) {
          wbFlag = true;
          issues.push({
            type: 'odometer', severity: Math.abs(wbDiffPct) > S.redPct ? 'red' : 'yellow',
            text: (wbDiffPct > 0 ? 'По путевым листам пробег больше, чем по GPS, на ' : 'По путевым листам пробег меньше, чем по GPS, на ') +
              fmtPct(Math.abs(wbDiffPct)) + ' (' + fmtNum(r0(wbKm - gpsKm)) + ' км)' + (wbDiffPct > 0 ? ' — возможна подкрутка одометра' : '')
          });
        }
      }

      // Разрывы одометра: выезд не совпадает с прошлым возвратом
      var odoGaps = [];
      var wsorted = c.waybills.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odoOut - b.odoOut; });
      for (var i = 1; i < wsorted.length; i++) {
        var gap = wsorted[i].odoOut - wsorted[i - 1].odoIn;
        if (Math.abs(gap) > 1) odoGaps.push({ date: wsorted[i].date, prevDate: wsorted[i - 1].date, gap: gap });
      }
      wsorted.forEach(function (w) {
        if (w.km < 0) odoGaps.push({ date: w.date, prevDate: w.date, gap: w.km, negative: true });
      });
      if (odoGaps.length) {
        var gapKm = 0; odoGaps.forEach(function (g) { gapKm += g.gap; });
        issues.push({ type: 'odogap', severity: 'yellow', text: 'Разрывы в показаниях одометра между путевыми листами: ' + odoGaps.length + ' (итого ' + fmtNum(r0(gapKm)) + ' км вне путевых)' });
      }

      // Топливо против пробега
      var baseKm = hasGps ? gpsKm : (hasWb ? wbKm : 0);
      var baseSrc = hasGps ? 'GPS' : (hasWb ? 'путевые листы' : null);
      var consumed = c.startFuel + fuelL - wrongL - c.endFuel;
      var expectedL = null, excessL = null, excessPct = null, excessTg = 0, calcKm = null, unexplainedL = 0, fuelFlag = false;
      if (c.norm) {
        calcKm = consumed / c.norm * 100;
        expectedL = baseKm * c.norm / 100;
        excessL = consumed - expectedL;
        excessPct = expectedL > 0 ? excessL / expectedL * 100 : (consumed > 0 ? Infinity : 0);
        if (excessPct < -S.redPct && expectedL > 0) {
          issues.push({
            type: 'deficit', severity: 'yellow',
            text: 'Заправок по её картам на ' + fmtNum(r0(-excessL)) + ' л меньше, чем нужно на пробег (' + fmtPct(excessPct) + ') — возможно, её заправляли картой другой машины или за наличные'
          });
        }
        if (excessPct > S.fuelTolPct && excessL > 1) {
          fuelFlag = true;
          unexplainedL = excessL;
          excessTg = excessL * avgPrice;
          issues.push({
            type: 'fuel', severity: excessPct > S.redPct ? 'red' : 'yellow',
            text: 'Возможный слив: заправлено на ' + fmtNum(r0(excessL)) + ' л больше, чем нужно на пробег по ' + baseSrc +
              (isFinite(excessPct) ? ' (+' + fmtPct(excessPct) + ')' : '') + (excessTg ? ' ≈ ' + fmtNum(r0(excessTg)) + ' ₸' : '')
          });
        }
      }
      unexplainedL += wrongL; excessTg += wrongTg;
      if (!c.norm && (fuelL > 0 || baseKm > 0)) {
        issues.push({ type: 'nonorm', severity: 'yellow', text: 'Нет нормы расхода в справочнике — слив не проверен' });
      }
      if (!hasGps && (fuelL > 0 || hasWb)) issues.push({ type: 'nogps', severity: 'yellow', text: 'Нет данных GPS — сверка по путевым листам' });

      // Повторная заправка в тот же день — частый признак слива в канистру
      var byDay = {};
      c.fuelings.forEach(function (f) {
        if (byDay[f.date]) f.flags.push('Вторая заправка за день (первая в ' + (byDay[f.date].time || '—') + ', ' + fmtNum(byDay[f.date].liters, 1) + ' л)');
        else byDay[f.date] = f;
      });

      // Заправки в дни простоя машины (по GPS)
      var idleFuel = [];
      if (hasGps) {
        c.fuelings.forEach(function (f) {
          if (!(c.gpsDays[f.date] > 0)) { f.flags.push('Машина в этот день не ездила (GPS)'); idleFuel.push(f); }
        });
        if (idleFuel.length) {
          var il = 0; idleFuel.forEach(function (f) { il += f.liters; });
          issues.push({ type: 'idle', severity: 'yellow', text: 'Заправки в дни, когда машина не ездила: ' + idleFuel.length + ' шт., ' + fmtNum(r0(il)) + ' л' });
        }
      }

      // В бак не помещается: оцениваем остаток по пробегу и норме. С запасом в пользу водителя —
      // считаем, что весь пробег дня проехан до заправки, и даём допуск 5% бака (не меньше 5 л).
      var overflow = [], overflowL = 0;
      if (c.tank && c.norm && hasGps) {
        var fillsByDay = {};
        c.fuelings.forEach(function (f) { if (!f.wrongFuel) (fillsByDay[f.date] = fillsByDay[f.date] || []).push(f); });
        var level = Math.min(c.startFuel || 0, c.tank), tol = Math.max(5, c.tank * 0.05);
        days.forEach(function (day) {
          var use = (c.gpsDays[day] || 0) * c.norm / 100;
          (fillsByDay[day] || []).forEach(function (f) {
            var before = Math.max(level - use, 0), free = c.tank - before;
            if (f.liters > free + tol) {
              var over = f.liters - free;
              overflowL += over; overflow.push(f); f.overflowL = over;
              f.flags.push('Не помещается в бак: заправлено ' + fmtNum(f.liters, 1) + ' л, свободно было не больше ' + fmtNum(Math.max(free, 0), 0) + ' л');
            }
            level = Math.min(before + f.liters, c.tank) + use;
          });
          level = Math.max(level - use, 0);
        });
        if (overflow.length) {
          issues.push({ type: 'overflow', severity: overflowL > 20 ? 'red' : 'yellow', text: 'Заправки больше, чем помещается в бак (' + fmtNum(c.tank) + ' л): ' + overflow.length + ' раз, сверх места ' + fmtNum(r0(overflowL)) + ' л — топливо ушло в канистру или другую машину' });
        }
      }

      // Заправки по чужим картам на эту машину и с карт этой машины на другие
      var foreignIn = c.fuelings.filter(function (f) { return f.foreign; });
      var foreignOut = foreignUses.filter(function (f) { return f.ownerCar === c.car; });
      if (foreignIn.length) issues.push({ type: 'foreignIn', severity: 'yellow', text: 'Заправлялась по чужим картам: ' + times(foreignIn.length) });
      if (foreignOut.length) issues.push({ type: 'foreignOut', severity: 'yellow', text: 'Её карты заправляли другие машины: ' + times(foreignOut.length) });

      // Картами этой машины заправляли машины не из парка — топливо ушло на сторону
      var outsiderOut = outsiderFuel.filter(function (f) { return f.ownerCar === c.car; });
      var outL = 0, outTg = 0, outPlates = {};
      outsiderOut.forEach(function (f) { outL += f.liters; outTg += f.amount; outPlates[f.actualCar] = true; });
      if (outsiderOut.length) {
        unexplainedL += outL; excessTg += outTg;
        issues.push({
          type: 'outsider', severity: 'red',
          text: 'Её картой заправляли машины не из вашего парка (' + Object.keys(outPlates).join(', ') + '): ' +
            times(outsiderOut.length) + ', ' + fmtNum(r0(outL)) + ' л' + (outTg ? ' ≈ ' + fmtNum(r0(outTg)) + ' ₸' : '')
        });
      }
      var reserveUses = c.fuelings.filter(function (f) { return f.reserveCard; });

      // Подневные ряды для графиков
      var daily = [], cg = 0, cw = 0, cc = 0;
      var fuelByDay = {};
      c.fuelings.forEach(function (f) { fuelByDay[f.date] = (fuelByDay[f.date] || 0) + f.liters; });
      days.forEach(function (day, i) {
        var g = c.gpsDays[day] || 0, w = c.wbDays[day] || 0, fl = fuelByDay[day] || 0;
        cg += g; cw += w;
        cc += fl + (i === 0 ? c.startFuel : 0) - (i === days.length - 1 ? c.endFuel : 0);
        daily.push({ date: day, gps: g, wb: w, fuel: fl, cumGps: cg, cumWb: cw, cumCalc: c.norm ? cc / c.norm * 100 : null });
      });

      var sev = 'green';
      issues.forEach(function (x) {
        if (x.severity === 'red') sev = 'red';
        else if (x.severity === 'yellow' && sev !== 'red') sev = 'yellow';
      });

      return {
        key: c.key, car: c.car, norm: c.norm, inRefs: c.inRefs, cards: c.cards, reserve: c.reserve,
        drivers: Object.keys(c.drivers), startFuel: c.startFuel, endFuel: c.endFuel,
        hasGps: hasGps, hasWb: hasWb, gpsKm: gpsKm, wbKm: wbKm, wbDiffPct: wbDiffPct, wbFlag: wbFlag,
        fuelL: fuelL, fuelTg: fuelTg, avgPrice: avgPrice, consumed: consumed, calcKm: calcKm,
        expectedL: expectedL, excessL: excessL, excessPct: excessPct, fuelFlag: fuelFlag,
        unexplainedL: unexplainedL, unexplainedTg: excessTg,
        fuelings: c.fuelings, waybills: wsorted, odoGaps: odoGaps, idleFuel: idleFuel,
        foreignIn: foreignIn, foreignOut: foreignOut, reserveUses: reserveUses,
        outsiderOut: outsiderOut, outsiderL: outL, outsiderTg: outTg,
        fuelTypes: c.fuelTypes, tank: c.tank, wrongFuel: wrongFuel, wrongL: wrongL, wrongTg: wrongTg,
        overflow: overflow, overflowL: overflowL,
        daily: daily, issues: issues, status: sev
      };
    });

    list.sort(function (a, b) { return a.car.localeCompare(b.car, 'ru', { numeric: true }); });

    // «Куда ушло топливо»: перетоки между машинами парка
    var flows = {};
    foreignUses.forEach(function (f) {
      var k = (f.ownerCar || '?') + '→' + f.actualCar + '|' + f.cardKey;
      if (!flows[k]) flows[k] = { card: f.card, ownerCar: f.ownerCar, actualCar: f.actualCar, count: 0, liters: 0, amount: 0, rows: [], ownerIdle: 0 };
      var fl = flows[k];
      fl.count++; fl.liters += f.liters; fl.amount += f.amount; fl.rows.push(f);
      if (f.ownerCar) {
        var oc = cars[plateKey(f.ownerCar)];
        if (oc && Object.keys(oc.gpsDays).length && !(oc.gpsDays[f.date] > 0)) { fl.ownerIdle++; f.flags.push('Машина-владелец карты в этот день стояла'); }
      }
    });
    var flowList = Object.keys(flows).map(function (k) { return flows[k]; }).sort(function (a, b) { return b.liters - a.liters; });

    var cardList = Object.keys(cardStats).map(function (k) {
      var cs = cardStats[k];
      cs.byCarList = Object.keys(cs.byCar).map(function (n) { return { car: n, liters: cs.byCar[n].liters, amount: cs.byCar[n].amount, count: cs.byCar[n].count, own: n === cs.owner, outsider: !!cs.byCar[n].outsider }; })
        .sort(function (a, b) { return b.liters - a.liters; });
      cs.foreignL = 0; cs.outsiderL = 0;
      cs.byCarList.forEach(function (x) { if (!x.own) cs.foreignL += x.liters; if (x.outsider) cs.outsiderL += x.liters; });
      return cs;
    }).sort(function (a, b) { return String(a.owner || 'яяя').localeCompare(String(b.owner || 'яяя'), 'ru', { numeric: true }); });

    // Куда ушло топливо: машины не из парка, по карте и госномеру
    var outs = {};
    outsiderFuel.forEach(function (f) {
      var k = f.cardKey + '|' + f.plateKey;
      if (!outs[k]) outs[k] = { card: f.card, ownerCar: f.ownerCar, plate: f.actualCar, count: 0, liters: 0, amount: 0, rows: [] };
      var o = outs[k];
      o.count++; o.liters += f.liters; o.amount += f.amount; o.rows.push(f);
    });
    var outsiderList = Object.keys(outs).map(function (k) { return outs[k]; }).sort(function (a, b) { return b.amount - a.amount || b.liters - a.liters; });

    // Итоги
    var unknownL = 0, unknownTg = 0;
    unknownFuel.forEach(function (f) { unknownL += f.liters; unknownTg += f.amount; });
    var tot = { cars: list.length, fuelL: 0, fuelTg: 0, gpsKm: 0, wbKm: 0, unexplainedL: unknownL, unexplainedTg: unknownTg, red: 0, yellow: 0, green: 0, unknownL: unknownL, unknownTg: unknownTg, foreignCount: foreignUses.length, foreignL: 0 };
    foreignUses.forEach(function (f) { tot.foreignL += f.liters; });
    list.forEach(function (c) {
      tot.fuelL += c.fuelL; tot.fuelTg += c.fuelTg; tot.gpsKm += c.gpsKm; tot.wbKm += c.wbKm;
      tot.unexplainedL += c.unexplainedL; tot.unexplainedTg += c.unexplainedTg;
      tot[c.status]++;
    });
    tot.fuelTg += unknownTg; tot.fuelL += unknownL;
    tot.wrongL = 0; tot.wrongTg = 0; tot.wrongCount = 0; tot.overflowCount = 0; tot.idleCount = 0;
    tot.deficitL = 0; tot.deficitCars = 0;
    list.forEach(function (c) {
      tot.wrongL += c.wrongL; tot.wrongTg += c.wrongTg; tot.wrongCount += c.wrongFuel.length;
      tot.overflowCount += c.overflow.length; tot.idleCount += c.idleFuel.length;
      if (c.issues.some(function (i) { return i.type === 'deficit'; })) { tot.deficitCars++; tot.deficitL += -c.excessL; }
    });
    tot.outsiderL = 0; tot.outsiderTg = 0; tot.outsiderCount = outsiderFuel.length;
    outsiderFuel.forEach(function (f) {
      tot.outsiderL += f.liters; tot.outsiderTg += f.amount;
      tot.fuelL += f.liters; tot.fuelTg += f.amount;
      if (!f.ownerCar) { tot.unexplainedL += f.liters; tot.unexplainedTg += f.amount; } // с машиной-владельцем уже учтено в её итоге
    });

    var rank = { red: 2, yellow: 1, green: 0 };
    var top5 = list.filter(function (c) { return c.status !== 'green'; }).sort(function (a, b) {
      return (b.unexplainedTg - a.unexplainedTg) || (b.unexplainedL - a.unexplainedL) || (rank[b.status] - rank[a.status]) ||
        (Math.abs(b.wbDiffPct || 0) - Math.abs(a.wbDiffPct || 0));
    }).slice(0, 5);

    return {
      settings: S, period: period, days: days, cars: list, cards: cardList, flows: flowList,
      outsiders: outsiderList, outsiderFuel: outsiderFuel,
      unknownFuel: unknownFuel, cardConflicts: cardConflicts, totals: tot, top5: top5
    };
  }

  // ---------------------------------------------------------------------------
  // Форматирование
  // ---------------------------------------------------------------------------
  function fmtNum(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    digits = digits || 0;
    var s = (Math.round(x * Math.pow(10, digits)) / Math.pow(10, digits)).toFixed(digits);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return parts.join(',');
  }
  function fmtPct(x) { return x == null ? '—' : (isFinite(x) ? fmtNum(x, 1) + '%' : '∞'); }
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, FIELDS: FIELDS,
    parseNumber: parseNumber, parseDate: parseDate, parseDateTime: parseDateTime, parseTime: parseTime,
    plateKey: plateKey, cardKey: cardKey, splitCards: splitCards, fuelKind: fuelKind,
    tableFromArrays: tableFromArrays, autoMap: autoMap, missingFields: missingFields, normalize: normalize,
    parseCSV: parseCSV, analyze: analyze, addDays: addDays,
    fmtNum: fmtNum, fmtPct: fmtPct, fmtDate: fmtDate, r1: r1
  };
});
