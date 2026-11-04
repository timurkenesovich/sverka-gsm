"""Тесты журнала: python -m unittest bot/test_journal.py (или из папки bot: python -m unittest)"""
import os
import sys
import tempfile
import unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from journal import Journal, parse_number  # noqa: E402


class JournalTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.j = Journal(os.path.join(self.dir.name, "j.csv"))

    def tearDown(self):
        self.dir.cleanup()

    def test_waybills_from_odometer_photos(self):
        self.j.add("odo", "ДЕМО 01", "Водитель А.", datetime(2026, 10, 1, 8, 0), odometer="1000")
        self.j.add("odo", "ДЕМО 01", "Водитель А.", datetime(2026, 10, 1, 19, 0), odometer="1150")
        self.j.add("odo", "ДЕМО 01", "Водитель А.", datetime(2026, 10, 2, 19, 0), odometer="1300")
        lines = self.j.export_waybills("2026-10").lstrip("﻿").strip().splitlines()
        self.assertEqual(lines[1], "ДЕМО 01;Водитель А.;01.10.2026;1000;1150")
        self.assertEqual(lines[2], "ДЕМО 01;Водитель А.;02.10.2026;1150;1300")

    def test_fuel_export(self):
        self.j.add("fuel", "ДЕМО 02", "Б.", datetime(2026, 10, 3, 7, 45), liters="45.3", amount="10509.6")
        lines = self.j.export_fuel().lstrip("﻿").strip().splitlines()
        self.assertEqual(lines[1], "чек;03.10.2026 07:45;;45,3;10509,6;ДЕМО 02")

    def test_last_odometer_and_numbers(self):
        self.assertIsNone(self.j.last_odometer("X"))
        self.j.add("odo", "X", "a", odometer="500")
        self.assertEqual(self.j.last_odometer("X"), 500)
        self.assertEqual(parse_number("123 456,7"), 123456.7)
        self.assertEqual(parse_number("1.234,5"), 1234.5)
        self.assertIsNone(parse_number("абв"))


if __name__ == "__main__":
    unittest.main()
