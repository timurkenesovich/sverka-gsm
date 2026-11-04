/*
 * Сверка ГСМ — обезличенные демо-данные.
 * 12 машин, октябрь 2026. Все номера, карты, водители и АЗС выдуманы.
 *
 * Заложенные нарушения:
 *   1. ДЕМО 03 — слив: вечерние заправки «в канистру», топлива больше, чем нужно на пробег.
 *   2. ДЕМО 09 — чужая карта: машина стоит в ремонте, а её картой заправляют ДЕМО 05.
 *   3. ДЕМО 07 — подкрученный одометр: в путевых листах пробег на ~20% больше, чем по GPS,
 *      и под этот «лишний» пробег списано топливо.
 * Генератор детерминированный (фиксированное зерно) — данные всегда одинаковые.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SverkaDemo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ru(n, d) { return n.toFixed(d).replace('.', ','); }

  var YEAR = 2026, MONTH = 10, DAYS = 31;
  var STATIONS = [
    { name: 'АЗС №1 (демо), ул. Первая', add: 0 },
    { name: 'АЗС №2 (демо), трасса', add: 4 },
    { name: 'АЗС №3 (демо), ул. Вторая', add: -3 }
  ];
  var PRICE = { 'АИ-92': 232, 'ДТ': 318 };

  var CARS = [
    { n: 1, type: 'легковой', norm: 9.5, tank: 50, fuel: 'АИ-92', base: 140, drivers: ['Водитель А.'] },
    { n: 2, type: 'легковой', norm: 10.0, tank: 55, fuel: 'АИ-92', base: 160, drivers: ['Водитель Б.'] },
    { n: 3, type: 'фургон', norm: 13.5, tank: 70, fuel: 'АИ-92', base: 170, drivers: ['Водитель В.'] },
    { n: 4, type: 'фургон', norm: 14.0, tank: 70, fuel: 'АИ-92', base: 180, drivers: ['Водитель Г.'] },
    { n: 5, type: 'фургон', norm: 13.0, tank: 70, fuel: 'АИ-92', base: 175, drivers: ['Водитель Д.'] },
    { n: 6, type: 'грузовой', norm: 28.0, tank: 200, fuel: 'ДТ', base: 230, drivers: ['Водитель Е.', 'Водитель Ж.'], twoCards: true },
    { n: 7, type: 'фургон', norm: 12.5, tank: 65, fuel: 'АИ-92', base: 165, drivers: ['Водитель З.'] },
    { n: 8, type: 'грузовой', norm: 31.0, tank: 250, fuel: 'ДТ', base: 260, drivers: ['Водитель И.', 'Водитель К.'], twoCards: true },
    { n: 9, type: 'легковой', norm: 10.5, tank: 55, fuel: 'АИ-92', base: 150, drivers: ['Водитель Л.'] },
    { n: 10, type: 'грузовой', norm: 26.0, tank: 200, fuel: 'ДТ', base: 210, drivers: ['Водитель М.'] },
    { n: 11, type: 'легковой', norm: 9.0, tank: 50, fuel: 'АИ-92', base: 130, drivers: ['Водитель Н.'] },
    { n: 12, type: 'фургон', norm: 14.5, tank: 75, fuel: 'АИ-92', base: 185, drivers: ['Водитель О.'] }
  ];

  var REPAIR_FROM = 12, REPAIR_TO = 23; // ДЕМО 09 в ремонте
  var THEFT_DAYS = [3, 7, 10, 15, 21, 27, 30]; // ДЕМО 03 — вечерние заправки «в канистру»

  function plate(n) { return 'ДЕМО ' + pad(n); }
  function card(n, k) { return 'DEMO-' + (k ? '2' : '1') + pad(n) + (k ? '2' : '1'); }
  var RESERVE_CARD = 'DEMO-3990'; // резервная карта бывшей машины, теперь у ДЕМО 11

  function generate() {
    var R = rng(20261031);
    var gps = [['Госномер', 'Дата', 'Пробег за сутки, км']];
    var wbs = [['Гос. номер', 'Водитель', 'Дата', 'Одометр при выезде', 'Одометр при возвращении']];
    var fuelRows = [];
    var refs = [['Машина', 'Норма, л/100 км', 'Закреплённые карты', 'Резервные карты', 'Остаток на начало, л', 'Остаток на конец, л']];
    var truth = {};

    CARS.forEach(function (c) {
      var p = plate(c.n);
      var cards = [card(c.n, 0)].concat(c.twoCards ? [card(c.n, 1)] : []);
      var level = Math.round(c.tank * (0.45 + R() * 0.3));
      var start = level;
      var odo = 40000 + Math.round(R() * 160000);
      var phantom = 0, reserveUsed = false;
      var t = truth[p] = { gpsKm: 0, wbKm: 0, consumed: 0, fuelL: 0 };

      for (var d = 1; d <= DAYS; d++) {
        var date = new Date(Date.UTC(YEAR, MONTH - 1, d));
        var dmy = pad(d) + '.' + pad(MONTH) + '.' + YEAR;
        var iso = YEAR + '-' + pad(MONTH) + '-' + pad(d);
        var sunday = date.getUTCDay() === 0;
        var off = R() < 0.05;
        var repair = c.n === 9 && d >= REPAIR_FROM && d <= REPAIR_TO;
        var km = (sunday || off || repair) ? 0 : Math.round(c.base * (0.75 + R() * 0.5) * 10) / 10;
        gps.push([p, dmy, ru(km, 1)]);
        t.gpsKm += km;
        if (km <= 0) continue;

        var consume = km * c.norm / 100 * (0.97 + R() * 0.05);
        // заправка утром, если в баке мало
        if (level < Math.max(c.tank * 0.4, consume + c.tank * 0.15)) {
          var fill = Math.round((c.tank - level) * 10) / 10;
          level = c.tank;
          var rec = fill;
          if (c.n === 7 && phantom > 0) { // списываем топливо под «накрученный» пробег
            var add = Math.min(phantom, c.tank * 0.6);
            rec = Math.round((fill + add) * 10) / 10; phantom -= add;
          }
          var usedCard = cards[(d % cards.length)];
          if (c.n === 5 && d >= REPAIR_FROM && d <= REPAIR_TO) usedCard = card(9, 0); // чужая карта
          if (c.n === 11 && !reserveUsed && d > 14) { usedCard = RESERVE_CARD; reserveUsed = true; }
          fuelRows.push(fuelRow(R, d, 7 + Math.floor(R() * 2), usedCard, rec, c, p));
          t.fuelL += rec;
        }
        level -= consume;
        t.consumed += consume;

        // путевой лист
        var wbKm = km * (1 + (R() - 0.5) * 0.04);
        if (c.n === 7) { wbKm = km * (1.19 + R() * 0.02); phantom += (wbKm - km) * c.norm / 100; }
        var odoIn = odo + Math.round(wbKm);
        wbs.push([p, c.drivers[d % c.drivers.length], iso, odo, odoIn]);
        t.wbKm += odoIn - odo;
        odo = odoIn;

        // слив: вечерняя заправка, топливо в бак не попадает
        if (c.n === 3 && THEFT_DAYS.indexOf(d) >= 0) {
          var stolen = Math.round((26 + R() * 12) * 10) / 10;
          fuelRows.push(fuelRow(R, d, 20 + Math.floor(R() * 2), cards[0], stolen, c, p));
          t.fuelL += stolen;
        }
      }
      if (c.n === 7 && phantom > 1) { // остаток «фантомных» литров — последней заправкой месяца
        fuelRows.push(fuelRow(R, 31, 18, cards[0], Math.round(phantom * 10) / 10, c, p));
        t.fuelL += Math.round(phantom * 10) / 10;
      }
      var end = Math.round(level);
      t.start = start; t.end = end;
      refs.push([p, ru(c.norm, 1), cards.join(', '), c.n === 11 ? RESERVE_CARD : '', start, end]);
    });

    fuelRows.sort(function (a, b) { return a._k < b._k ? -1 : 1; });
    var fuel = [['Номер карты', 'Дата и время', 'АЗС', 'Топливо', 'Кол-во, л', 'Сумма, тг', 'Госномер ТС']]
      .concat(fuelRows.map(function (r) { return r.row; }));

    return { gps: gps, waybills: wbs, fuel: fuel, refs: refs, truth: truth };
  }

  function fuelRow(R, d, hour, cardNo, liters, c, p) {
    var st = STATIONS[Math.floor(R() * STATIONS.length)];
    var price = PRICE[c.fuel] + st.add;
    var min = Math.floor(R() * 60);
    var dt = pad(d) + '.' + pad(MONTH) + '.' + YEAR + ' ' + pad(hour) + ':' + pad(min);
    return {
      _k: pad(d) + pad(hour) + pad(min) + p,
      row: [cardNo, dt, st.name, c.fuel, ru(liters, 2), ru(Math.round(liters * price * 100) / 100, 2).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), p]
    };
  }

  /** Таблица → CSV (разделитель «;», как любит Excel в русской локали) */
  function toCSV(arr) {
    return arr.map(function (row) {
      return row.map(function (v) {
        var s = String(v == null ? '' : v);
        return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
  }

  return { generate: generate, toCSV: toCSV, plate: plate, card: card, RESERVE_CARD: RESERVE_CARD };
});
