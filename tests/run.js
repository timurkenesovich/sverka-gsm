/*
 * Тесты расчётов «Сверки ГСМ». Запуск: node tests/run.js
 * Проверяют разбор данных и что четыре заложенных в демо нарушения находятся,
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
test('вид топлива приводится к общему виду', function () {
  assert.strictEqual(Core.fuelKind('Аи-92'), 'АИ-92');
  assert.strictEqual(Core.fuelKind('AI 95'), 'АИ-95');
  assert.strictEqual(Core.fuelKind('92'), 'АИ-92');
  assert.strictEqual(Core.fuelKind('Дизельное топливо'), 'ДТ');
  assert.strictEqual(Core.fuelKind('ДТ-Л'), 'ДТ');
  assert.strictEqual(Core.fuelKind('Пропан'), 'ГАЗ');
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
  assert.strictEqual(m.fuelType, 'Топливо');
  assert.strictEqual(m.car, '', 'в настоящей выгрузке АЗС госномера нет');
  var w = Core.autoMap(Core.tableFromArrays(demo.waybills).headers, 'waybills');
  assert.strictEqual(w.odoOut, 'Одометр при выезде');
  assert.strictEqual(w.odoIn, 'Одометр при возвращении');
  var r = Core.autoMap(Core.tableFromArrays(demo.refs).headers, 'refs');
  assert.strictEqual(r.cards, 'Закреплённые карты');
  assert.strictEqual(r.reserve, 'Резервные карты');
  assert.strictEqual(r.startFuel, 'Остаток на начало, л');
  assert.strictEqual(r.endFuel, 'Остаток на конец, л');
  assert.strictEqual(r.fuelType, 'Топливо');
  assert.strictEqual(r.tank, 'Бак, л');
});
test('другие названия колонок тоже узнаются', function () {
  var m = Core.autoMap(['Номер топливной карты', 'Дата', 'Время', 'Станция', 'Вид топлива', 'Объём, л', 'Стоимость'], 'fuel');
  assert.strictEqual(m.card, 'Номер топливной карты');
  assert.strictEqual(m.fuelType, 'Вид топлива');
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

console.log('\nНарушение 2: картой ДЕМО 09 заправляют ДЕМО 05, пока ДЕМО 09 в ремонте');
test('ДЕМО 09 — заправки в дни, когда машина не ездила, и больше бака; красная', function () {
  var c = carOf(res, 9);
  assert.ok(c.idleFuel.length >= 3, 'заправок в простой ' + c.idleFuel.length);
  assert.ok(c.overflow.length >= 1, 'больше бака ' + c.overflow.length);
  assert.ok(c.fuelFlag, 'топливо без пробега — перерасход');
  assert.strictEqual(c.status, 'red');
  assert.ok(!c.wbFlag);
});
test('ДЕМО 05 — недорасход: заправок меньше, чем нужно на пробег; жёлтая', function () {
  var c = carOf(res, 5);
  assert.ok(c.issues.some(function (i) { return i.type === 'deficit'; }));
  assert.ok(!c.fuelFlag && !c.wbFlag);
  assert.strictEqual(c.status, 'yellow');
  assert.strictEqual(res.totals.deficitCars, 1);
});
test('без госномера в выгрузке АЗС прямых перетоков нет; резервная карта ДЕМО 11 — не нарушение', function () {
  assert.strictEqual(res.flows.length, 0);
  assert.strictEqual(res.outsiders.length, 0);
  assert.strictEqual(carOf(res, 11).reserveUses.length, 1);
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

console.log('\nНарушение 4: по карте дизельного ДЕМО 10 покупают бензин — заправляют чужую машину');
test('ДЕМО 10 — «не то топливо»: 4 заправки АИ-92, красная, сумма в «не объяснено»', function () {
  var c = carOf(res, 10);
  assert.strictEqual(c.wrongFuel.length, 4);
  assert.ok(c.wrongFuel.every(function (f) { return f.fuelType === 'АИ-92'; }));
  assert.ok(c.issues.some(function (i) { return i.type === 'wrongfuel' && i.severity === 'red'; }));
  assert.strictEqual(c.status, 'red');
  assert.ok(c.wrongTg > 30000 && Math.abs(c.unexplainedTg - c.wrongTg) < 0.01, c.wrongTg + ' / ' + c.unexplainedTg);
});
test('ДЕМО 10 — сам грузовик расходует честно: бензин не идёт в его расход', function () {
  var c = carOf(res, 10);
  assert.ok(!c.fuelFlag, 'перерасход ' + c.excessPct);
  assert.ok(Math.abs(c.excessPct) <= 5);
  assert.strictEqual(c.overflow.length, 0);
});
test('ДЕМО 10 — заправки чужой машины были в воскресенье, когда грузовик не ездил', function () {
  var c = carOf(res, 10);
  assert.strictEqual(c.idleFuel.length, 4);
});

console.log('\nЕсли АЗС всё же пишет госномер');
test('картой одной машины парка заправили другую — видно напрямую', function () {
  var r = Core.analyze({
    gps: [{ car: 'A1', date: '2026-10-01', km: 0 }, { car: 'B2', date: '2026-10-01', km: 300 }], waybills: [],
    fuel: [{ card: '111', date: '2026-10-01', time: '10:00', station: '', liters: 30, amount: 7000, car: 'B2' }],
    refs: [{ car: 'A1', norm: 10, cards: ['111'], reserve: [] }, { car: 'B2', norm: 10, cards: ['222'], reserve: [] }]
  });
  assert.strictEqual(r.flows.length, 1);
  assert.strictEqual(r.flows[0].ownerCar, 'A1');
  assert.strictEqual(r.flows[0].actualCar, 'B2');
  assert.strictEqual(r.flows[0].ownerIdle, 1);
});
test('машина не из парка: в парк не добавляется, сумма — в «не объяснено» владельца карты', function () {
  var r = Core.analyze({
    gps: [{ car: 'A1', date: '2026-10-01', km: 100 }], waybills: [],
    fuel: [{ card: '111', date: '2026-10-01', time: '', station: '', liters: 40, amount: 10000, car: 'X9' }],
    refs: [{ car: 'A1', norm: 10, cards: ['111'], reserve: [] }]
  });
  assert.strictEqual(r.cars.length, 1);
  assert.strictEqual(r.cars[0].status, 'red');
  assert.strictEqual(r.totals.unexplainedTg, 10000);
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
test('ТОП-5: ДЕМО 09, ДЕМО 03, ДЕМО 10, ДЕМО 07; итог складывается из них', function () {
  var top4 = res.top5.slice(0, 4).map(function (c) { return c.car; });
  assert.deepStrictEqual(top4, [Demo.plate(9), Demo.plate(3), Demo.plate(10), Demo.plate(7)]);
  var sum = 0;
  [3, 7, 9, 10].forEach(function (n) { sum += carOf(res, n).unexplainedL; });
  assert.ok(Math.abs(res.totals.unexplainedL - sum) < 0.01);
  assert.strictEqual(res.totals.red, 4);
  assert.strictEqual(res.totals.yellow, 1);
  assert.strictEqual(res.totals.green, 7);
});
test('бак: честная двойная заправка в пределах места не подсвечивается, лишнее — подсвечивается', function () {
  function one(l2) {
    return Core.analyze({
      gps: [{ car: 'A1', date: '2026-10-01', km: 200 }], waybills: [],
      fuel: [{ card: '1', date: '2026-10-01', time: '08:00', station: '', liters: 30, amount: 0 },
             { card: '1', date: '2026-10-01', time: '18:00', station: '', liters: l2, amount: 0 }],
      refs: [{ car: 'A1', norm: 10, cards: ['1'], reserve: [], tank: 50, startFuel: 10 }]
    }).cars[0];
  }
  assert.strictEqual(one(25).overflow.length, 0); // 10+30=40, минус 20 л пробега → свободно 30
  assert.strictEqual(one(45).overflow.length, 1);
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
