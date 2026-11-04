"""
Бот водителя «Сверка ГСМ» (каркас, версия 2).

Водитель:
  /start            — выбрать свою машину
  фото одометра     — бот спрашивает показание, записывает в журнал
  фото чека АЗС     — бот спрашивает литры и сумму, записывает в журнал
Владелец (ID в OWNER_IDS):
  /export ГГГГ-ММ   — получить CSV «путевые листы» и «заправки» для страницы «Сверка ГСМ»

Распознавания текста на фото нет: фото сохраняется как подтверждение (file_id Telegram),
цифры водитель вводит сам. Запуск — см. README.md рядом.
"""
import io
import logging
import os
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, InputFile, Update
from telegram.ext import (Application, CallbackQueryHandler, CommandHandler, ContextTypes,
                          MessageHandler, filters)

from journal import Journal, parse_number

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TOKEN = os.environ.get("BOT_TOKEN", "")
CARS = [c.strip() for c in os.environ.get("CARS", "ДЕМО 01,ДЕМО 02,ДЕМО 03").split(",") if c.strip()]
OWNER_IDS = {int(x) for x in os.environ.get("OWNER_IDS", "").split(",") if x.strip().isdigit()}
journal = Journal(os.environ.get("JOURNAL", "data/journal.csv"))


def driver_name(update: Update) -> str:
    u = update.effective_user
    return (u.full_name or u.username or str(u.id)) if u else "?"


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    kb = [[InlineKeyboardButton(c, callback_data="car:" + c)] for c in CARS]
    await update.message.reply_text("Здравствуйте! Выберите свою машину:", reply_markup=InlineKeyboardMarkup(kb))


async def pick_car(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    car = q.data.split(":", 1)[1]
    ctx.user_data["car"] = car
    await q.edit_message_text(
        f"Машина: {car}.\n\nПрисылайте:\n• фото одометра — утром на выезде и вечером на возврате;\n"
        "• фото чека после каждой заправки.\n\nСменить машину — /start")


async def photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if "car" not in ctx.user_data:
        await update.message.reply_text("Сначала выберите машину: /start")
        return
    ctx.user_data["photo_id"] = update.message.photo[-1].file_id
    kb = [[InlineKeyboardButton("Одометр", callback_data="kind:odo"), InlineKeyboardButton("Чек АЗС", callback_data="kind:fuel")]]
    await update.message.reply_text("Что на фото?", reply_markup=InlineKeyboardMarkup(kb))


async def pick_kind(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    kind = q.data.split(":", 1)[1]
    ctx.user_data["kind"] = kind
    if kind == "odo":
        last = journal.last_odometer(ctx.user_data["car"])
        hint = f" (прошлое: {int(last)})" if last else ""
        ctx.user_data["step"] = "odometer"
        await q.edit_message_text("Введите показание одометра, км" + hint + ":")
    else:
        ctx.user_data["step"] = "liters"
        await q.edit_message_text("Сколько литров заправлено? (например 45,3)")


async def text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    step = ctx.user_data.get("step")
    if not step:
        await update.message.reply_text("Пришлите фото одометра или чека. Выбрать машину — /start")
        return
    val = parse_number(update.message.text)
    if val is None or val < 0:
        await update.message.reply_text("Не понял число, попробуйте ещё раз — только цифры.")
        return
    car, who = ctx.user_data["car"], driver_name(update)
    if step == "odometer":
        last = journal.last_odometer(car)
        if last is not None and val < last:
            await update.message.reply_text(f"Показание меньше прошлого ({int(last)}). Проверьте и введите снова.")
            return
        journal.add("odo", car, who, odometer=f"{val:g}", photo_id=ctx.user_data.pop("photo_id", ""))
        ctx.user_data["step"] = None
        await update.message.reply_text(f"Записано: {car}, одометр {val:g} км ✅")
    elif step == "liters":
        ctx.user_data["liters"] = val
        ctx.user_data["step"] = "amount"
        await update.message.reply_text("Сумма по чеку, тенге?")
    elif step == "amount":
        liters = ctx.user_data.pop("liters")
        journal.add("fuel", car, who, liters=f"{liters:g}", amount=f"{val:g}", photo_id=ctx.user_data.pop("photo_id", ""))
        ctx.user_data["step"] = None
        await update.message.reply_text(f"Записано: {car}, {liters:g} л на {val:g} ₸ ✅")


async def export(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in OWNER_IDS:
        await update.message.reply_text("Выгрузка доступна только владельцу.")
        return
    month = ctx.args[0] if ctx.args else datetime.now().strftime("%Y-%m")
    for name, content in ((f"путевые_листы_{month}.csv", journal.export_waybills(month)),
                          (f"заправки_по_чекам_{month}.csv", journal.export_fuel(month))):
        await update.message.reply_document(InputFile(io.BytesIO(content.encode("utf-8")), filename=name))
    await update.message.reply_text("Загрузите эти файлы на страницу «Сверка ГСМ» вместе с GPS.")


async def myid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"Ваш ID: {update.effective_user.id}")


def main():
    if not TOKEN:
        raise SystemExit("Укажите токен бота: переменная окружения BOT_TOKEN (см. README.md)")
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("export", export))
    app.add_handler(CommandHandler("myid", myid))
    app.add_handler(CallbackQueryHandler(pick_car, pattern="^car:"))
    app.add_handler(CallbackQueryHandler(pick_kind, pattern="^kind:"))
    app.add_handler(MessageHandler(filters.PHOTO, photo))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text))
    app.run_polling()


if __name__ == "__main__":
    main()
