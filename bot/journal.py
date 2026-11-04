"""
Журнал машин для бота водителя: записи одометра и чеков в CSV-файл
и выгрузка в форматы, которые понимает страница «Сверка ГСМ».

Без зависимостей — только стандартная библиотека Python.
"""
import csv
import io
import os
from datetime import datetime

FIELDS = ["kind", "car", "driver", "date", "time", "odometer", "liters", "amount", "station", "card", "photo_id"]


class Journal:
    def __init__(self, path):
        self.path = path
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        if not os.path.exists(path):
            with open(path, "w", newline="", encoding="utf-8") as f:
                csv.writer(f, delimiter=";").writerow(FIELDS)

    def add(self, kind, car, driver, when=None, odometer="", liters="", amount="", station="", card="", photo_id=""):
        when = when or datetime.now()
        row = {
            "kind": kind, "car": car, "driver": driver,
            "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M"),
            "odometer": odometer, "liters": liters, "amount": amount,
            "station": station, "card": card, "photo_id": photo_id,
        }
        with open(self.path, "a", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=FIELDS, delimiter=";").writerow(row)
        return row

    def rows(self, month=None):
        """Все записи; month — строка 'ГГГГ-ММ' для фильтра."""
        with open(self.path, newline="", encoding="utf-8") as f:
            out = list(csv.DictReader(f, delimiter=";"))
        if month:
            out = [r for r in out if r["date"].startswith(month)]
        return out

    def last_odometer(self, car):
        vals = [float(r["odometer"]) for r in self.rows() if r["car"] == car and r["kind"] == "odo" and r["odometer"]]
        return vals[-1] if vals else None

    # --- выгрузки для страницы «Сверка ГСМ» ---------------------------------

    def export_waybills(self, month=None):
        """
        Путевые листы: по каждой машине и дню — первое показание одометра (выезд)
        и последнее (возврат). Если за день одно фото — выездом считается прошлое показание.
        """
        by_day = {}
        for r in self.rows(month):
            if r["kind"] != "odo" or not r["odometer"]:
                continue
            by_day.setdefault((r["car"], r["date"]), []).append(r)
        lines = [["Госномер", "Водитель", "Дата", "Одометр при выезде", "Одометр при возвращении"]]
        prev_in = {}
        for (car, date) in sorted(by_day, key=lambda k: (k[0], k[1])):
            recs = sorted(by_day[(car, date)], key=lambda r: r["time"])
            vals = [float(r["odometer"]) for r in recs]
            if len(vals) >= 2:
                out_v, in_v = vals[0], vals[-1]
            elif car in prev_in:
                out_v, in_v = prev_in[car], vals[0]
            else:
                prev_in[car] = vals[0]
                continue  # первое показание машины — точка отсчёта
            prev_in[car] = in_v
            lines.append([car, recs[0]["driver"], ru_date(date), fmt(out_v), fmt(in_v)])
        return to_csv(lines)

    def export_fuel(self, month=None):
        """Заправки по чекам — в формате выгрузки АЗС (с госномером)."""
        lines = [["Номер карты", "Дата и время", "АЗС", "Кол-во, л", "Сумма, тг", "Госномер ТС"]]
        for r in self.rows(month):
            if r["kind"] != "fuel":
                continue
            lines.append([r["card"] or "чек", ru_date(r["date"]) + " " + r["time"], r["station"],
                          r["liters"].replace(".", ","), r["amount"].replace(".", ","), r["car"]])
        return to_csv(lines)


def ru_date(iso):
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"


def fmt(x):
    return str(int(x)) if float(x).is_integer() else str(x).replace(".", ",")


def to_csv(lines):
    buf = io.StringIO()
    csv.writer(buf, delimiter=";").writerows(lines)
    return "﻿" + buf.getvalue()  # BOM — чтобы Excel открыл кириллицу


def parse_number(text):
    """'123 456,7' → 123456.7; мусор → None"""
    s = "".join(ch for ch in str(text) if ch.isdigit() or ch in ",.-")
    if not s:
        return None
    s = s.replace(",", ".")
    if s.count(".") > 1:
        head, _, tail = s.rpartition(".")
        s = head.replace(".", "") + "." + tail
    try:
        return float(s)
    except ValueError:
        return None
