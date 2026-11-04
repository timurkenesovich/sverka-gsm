/*
 * Тесты расчётов «Сверки ГСМ». Запуск: node tests/run.js
 * Проверяют разбор данных и что три заложенных в демо нарушения находятся,
 * а честные машины не подсвечиваются.
 */
'use strict';
var assert = require('assert');
var Core = require('../js/core.js');
var Demo = require('../js/demo.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

/** Прогон таблиц через тот же путь, что и в браузере: заголовки → сопоставление → нормализация. */
function load(arrays, kind) {
  var t = Core.tableFromArrays(arrays);
  var map = Core.autoMap(t.headers, kind);
  var miss = Core.missingFields(map, kind);
  if (miss.length) throw new Error(kind + ': не найдены колонки ' + miss.join(', '));
  var n = Core.normalize(kind, t.rows, map);
  if (n.errors.length) throw new Error(kind + ': ошибки разбора: ' + n.errors.slice(0, 3).join('; '));
  return { rows: n.rows, map: map };
}
function run(demo, opts) {
  opts = opts || {};
  var fuelArr = demo.fuel;
  if (opts.dropFuelCar) fuelArr = fuelArr.map(function (r) { return r.slice(0, 6); });
  var gpsArr = demo.gps, wbArr = demo.waybills, fuelA = fuelArr, refsArr = demo.refs;
  if (opts.viaCSV) { // проверяем и путь через CSV-текст
    gpsArr = Core.parseCSV(Demo.toCSV(gpsArr)); wbArr = Core.parseCSV(Demo.toCSV(wbArr));
    fuelA = Core.parseCSV(Demo.toCSV(fuelA)); refsArr = Core.parseCSV(Demo.toCSV(refsArr));
  }
  return Core.analyze({
    gps: load(gpsArr, 'gps').rows, waybills: load(wbArr, 'waybills').rows,
    fuel: load(fuelA, 'fuel').rows, refs: load(refsArr, 'refs').rows
  });
}
function carOf(res, n) {
  var name = Demo.plate(n);
  var c = res.cars.filter(function (x) { return x.car === name; })[0];
  assert.ok(c, 'нет машины ' + name);
  return c;
}

var demo = Demo.generate();

console.log('\nРазбор значений');
test('даты ДД.ММ.ГГГГ и ГГГГ-ММ-ДД', function () {
  assert.strictEqual(Core.parseDate('05.10.2026'), '2026-10-05');
  assert.strictEqual(Core.parseDate('2026-10-05'), '2026-10-05');
  assert.strictEqual(Core.parseDate('5.1.26'), '2026-01-05');
  assert.strictEqual(Core.parseDate('31.02.2026'), null);
  assert.strictEqual(Core.parseDate('мусор'), null);
});
test('дата со временем и серийный номер Excel', function () {
  assert.deepStrictEqual(Core.parseDateTime('01.10.2026 07:45'), { date: '2026-10-01', time: '07:45' });
  assert.deepStrictEqual(Core.parseDateTime('2026-10-01 7:05:00'), { date: '2026-10-01', time: '07:05' });
  assert.strictEqual(Core.parseDate(46296), '2026-10-01');
  assert.deepStrictEqual(Core.parseDateTime(46296.5), { date: '2026-10-01', time: '12:00' });
});
test('числа с запятой и пробелами', function () {
  assert.strictEqual(Core.parseNumber('45,3'), 45.3);
  assert.strictEqual(Core.parseNumber('10 419,50'), 10419.5);
  assert.strictEqual(Core.parseNumber('1.234,5'), 1234.5);
  assert.strictEqual(Core.parseNumber('1,234.5'), 1234.5);
  assert.strictEqual(Core.parseNumber('225 ₸'), 225);
  assert.strictEqual(Core.parseNumber(''), null);
});
test('госномера и карты сравниваются без учёта пробелов и раскладки', function () {
  assert.strictEqual(Core.plateKey('123 АВС 02'), Core.plateKey('123abc02'));
  assert.strictEqual(Core.cardKey('7000 1234 5678'), Core.cardKey('700012345678'));
  assert.deepStrictEqual(Core.splitCards('1111, 2222; 3333'), ['1111', '2222', '3333']);
});
test('CSV с «;» и кавычками', function () {
  var rows = Core.parseCSV('a;b\r\n"x;1";"2,5"\r\n');
  assert.deepStrictEqual(rows[1], ['x;1', '2,5']);
});
test('автосопоставление колонок демо-файлов', function () {
  var m = Core.autoMap(Core.tableFromArrays(demo.fuel).headers, 'fuel');
  assert.strictEqual(m.card, 'Номер карты');
  assert.strictEqual(m.date, 'Дата и время');
  assert.strictEqual(m.liters, 'Кол-во, л');
  assert.strictEqual(m.amount, 'Сумма, тг');
  assert.strictEqual(m.car, 'Госномер ТС');
  var w = Core.autoMap(Core.tableFromArrays(demo.waybills).headers, 'waybills');
  assert.strictEqual(w.odoOut, 'Одометр при выезде');
  assert.strictEqual(w.odoIn, 'Одометр при возвращении');
  var r = Core.autoMap(Core.tableFromArrays(demo.refs).headers, 'refs');
  assert.strictEqual(r.cards, 'Закреплённые карты');
  assert.strictEqual(r.reserve, 'Резервные карты');
  assert.strictEqual(r.startFuel, 'Остаток на начало, л');
  assert.strictEqual(r.endFuel, 'Остаток на конец, л');
});
test('другие названия колонок тоже узнаются', function () {
  var m = Core.autoMap(['Карта', 'Дата', 'Время', 'Станция', 'Объём, л', 'Стоимость'], 'fuel');
  assert.strictEqual(m.time, 'Время');
  assert.strictEqual(m.liters, 'Объём, л');
  assert.strictEqual(m.amount, 'Стоимость');
  assert.strictEqual(m.car, '');
});

var res = run(demo);

console.log('\nДемо: 12 машин, 1 месяц');
test('12 машин, период — октябрь 2026', function () {
  assert.strictEqual(res.cars.length, 12);
  assert.strictEqual(res.period.from, '2026-10-01');
  assert.strictEqual(res.period.to, '2026-10-31');
});

console.log('\nНарушение 1: слив (ДЕМО 03)');
test('ДЕМО 03 — «возможный слив», красный', function () {
  var c = carOf(res, 3);
  assert.ok(c.fuelFlag, 'слив не найден');
  assert.ok(c.excessPct > 15, 'перерасход ' + c.excessPct);
  assert.ok(c.unexplainedL > 150 && c.unexplainedL < 300, 'литры ' + c.unexplainedL);
  assert.ok(c.unexplainedTg > 0);
  assert.strictEqual(c.status, 'red');
});
test('ДЕМО 03 — путевые листы с GPS сходятся (это не одометр)', function () {
  var c = carOf(res, 3);
  assert.ok(!c.wbFlag, 'расхождение ' + c.wbDiffPct);
});

console.log('\nНарушение 2: чужая карта (карта ДЕМО 09 → ДЕМО 05)');
test('в «Чьих картах» есть переток с карты ДЕМО 09 на ДЕМО 05', function () {
  var f = res.flows.filter(function (x) { return x.ownerCar === Demo.plate(9) && x.actualCar === Demo.plate(5); })[0];
  assert.ok(f, 'переток не найден');
  assert.ok(f.count >= 3, 'заправок ' + f.count);
  assert.strictEqual(f.ownerIdle, f.count, 'машина-владелец в эти дни стояла в ремонте');
});
test('других перетоков нет (резервная карта ДЕМО 11 — не нарушение)', function () {
  assert.strictEqual(res.flows.length, 1, JSON.stringify(res.flows.map(function (f) { return f.ownerCar + '→' + f.actualCar; })));
  assert.ok(carOf(res, 11).reserveUses.length === 1);
});
test('ДЕМО 05 и ДЕМО 09 — без слива и без проблем с одометром', function () {
  [5, 9].forEach(function (n) {
    var c = carOf(res, n);
    assert.ok(!c.fuelFlag, n + ': слив ' + c.excessPct);
    assert.ok(!c.wbFlag, n + ': одометр ' + c.wbDiffPct);
    assert.strictEqual(c.status, 'yellow');
  });
});
test('без колонки «госномер» в АЗС: заправки карты ДЕМО 09 в дни ремонта подсвечены', function () {
  var r2 = run(demo, { dropFuelCar: true });
  var c9 = carOf(r2, 9);
  assert.ok(c9.idleFuel.length >= 3, 'заправок в простой ' + c9.idleFuel.length);
  assert.ok(c9.fuelFlag, 'топливо без пробега должно дать перерасход');
});

console.log('\nНарушение 3: подкрученный одометр (ДЕМО 07)');
test('ДЕМО 07 — путевые листы больше GPS на 15–25%', function () {
  var c = carOf(res, 7);
  assert.ok(c.wbFlag);
  assert.ok(c.wbDiffPct > 15 && c.wbDiffPct < 25, 'расхождение ' + c.wbDiffPct);
  assert.strictEqual(c.status, 'red');
  assert.ok(c.issues.some(function (i) { return i.type === 'odometer'; }));
});
test('ДЕМО 07 — топливо списано под накрученный пробег (перерасход к GPS)', function () {
  var c = carOf(res, 7);
  assert.ok(c.fuelFlag);
  assert.ok(c.excessPct > 15);
});

console.log('\nНарушение 4: картой компании заправляют чужую машину (карта ДЕМО 10 → ЧУЖАЯ 77)');
test('заправки машины не из парка найдены и посчитаны в тенге', function () {
  assert.strictEqual(res.outsiders.length, 1);
  var o = res.outsiders[0];
  assert.strictEqual(o.plate, Demo.OUTSIDER);
  assert.strictEqual(o.ownerCar, Demo.plate(10));
  assert.strictEqual(o.count, 4);
  assert.ok(o.liters > 150 && o.amount > 30000, o.liters + ' л, ' + o.amount + ' ₸');
});
test('ДЕМО 10 — красная, сумма в её «не объяснено»; сама машина расходует честно', function () {
  var c = carOf(res, 10);
  assert.strictEqual(c.status, 'red');
  assert.ok(c.issues.some(function (i) { return i.type === 'outsider'; }));
  assert.ok(!c.fuelFlag, 'перерасход ' + c.excessPct);
  assert.ok(Math.abs(c.unexplainedTg - res.outsiders[0].amount) < 0.01);
});
test('чужая машина не попадает в список машин парка', function () {
  assert.ok(!res.cars.some(function (c) { return c.car === Demo.OUTSIDER; }));
});
test('без госномера в АЗС те же заправки дают перерасход у ДЕМО 10', function () {
  var r2 = run(demo, { dropFuelCar: true });
  var c10 = carOf(r2, 10);
  assert.ok(c10.fuelFlag, 'перерасход ' + c10.excessPct);
  assert.strictEqual(r2.outsiders.length, 0);
});
test('незакреплённая карта + чужая машина: считается в итоге один раз', function () {
  var r = Core.analyze({
    gps: [{ car: 'A1', date: '2026-10-01', km: 100 }], waybills: [],
    fuel: [{ card: '555', date: '2026-10-01', time: '', station: '', liters: 40, amount: 10000, car: 'B2' }],
    refs: [{ car: 'A1', norm: 10, cards: ['111'], reserve: [] }]
  });
  assert.strictEqual(r.cars.length, 1);
  assert.strictEqual(r.totals.unexplainedTg, 10000);
  assert.strictEqual(r.totals.outsiderTg, 10000);
});

console.log('\nЧестные машины не подсвечиваются');
test('7 машин зелёные, расхождения в пределах ±5%', function () {
  [1, 2, 4, 6, 8, 11, 12].forEach(function (n) {
    var c = carOf(res, n);
    assert.strictEqual(c.status, 'green', c.car + ': ' + c.issues.map(function (i) { return i.text; }).join('; '));
    assert.ok(Math.abs(c.wbDiffPct) <= 5);
    assert.ok(c.excessPct <= 5);
  });
});
test('разрывов одометра в демо нет', function () {
  res.cars.forEach(function (c) { assert.strictEqual(c.odoGaps.length, 0, c.car); });
});

console.log('\nИтоги');
test('ТОП-5: первые три — ДЕМО 03, ДЕМО 10, ДЕМО 07; итог в тенге > 0', function () {
  var firstThree = res.top5.slice(0, 3).map(function (c) { return c.car; });
  assert.deepStrictEqual(firstThree, [Demo.plate(3), Demo.plate(10), Demo.plate(7)]);
  assert.ok(res.totals.unexplainedTg > 0);
  var sum = carOf(res, 3).unexplainedL + carOf(res, 7).unexplainedL + carOf(res, 10).unexplainedL;
  assert.ok(Math.abs(res.totals.unexplainedL - sum) < 0.01);
  assert.strictEqual(res.totals.red, 3);
  assert.strictEqual(res.totals.yellow, 2);
  assert.strictEqual(res.totals.green, 7);
});
test('тот же результат через CSV', function () {
  var r3 = run(demo, { viaCSV: true });
  assert.ok(Math.abs(r3.totals.unexplainedTg - res.totals.unexplainedTg) < 1);
});
test('остаток на начало по умолчанию 0 и учитывается в расчёте', function () {
  var base = { gps: [{ car: 'A1', date: '2026-10-01', km: 100 }], waybills: [], fuel: [], refs: [{ car: 'A1', norm: 10, cards: [], reserve: [] }] };
  var a = Core.analyze(base).cars[0];
  assert.strictEqual(a.startFuel, 0);
  base.refs[0].startFuel = 10;
  var b = Core.analyze(base).cars[0];
  assert.ok(Math.abs(b.excessL) < 1e-9 && !b.fuelFlag);
});

console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' с ошибкой\n');
console.log('Не объяснено в демо: ' + Core.fmtNum(res.totals.unexplainedL) + ' л ≈ ' + Core.fmtNum(res.totals.unexplainedTg) + ' ₸');
res.cars.forEach(function (c) {
  console.log('  ' + c.car + '  ' + c.status.padEnd(6) + ' GPS ' + Core.fmtNum(c.gpsKm) + ' км, путевые ' + Core.fmtPct(c.wbDiffPct) + ', топливо ' + Core.fmtPct(c.excessPct));
});
process.exit(failed ? 1 : 0);
