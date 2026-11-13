# -*- coding: utf-8 -*-
"""
Обезличиватель проектной документации (локальный, офлайн).

Находит персональные и коммерческие данные. Окно программы закрывает их
чёрной плашкой. Запись PDF, Word и Excel — в doc_formats.py.
"""
import json
import os
import re
from dataclasses import dataclass, field

# --------------------------------------------------------------------------- #
#  Категории
# --------------------------------------------------------------------------- #
CATEGORIES = {
    "СЛОВАРЬ":  "Слова из словаря (объект, заказчик, проект)",
    "ОБЪЕКТ":   "Наименование проекта / объекта (из карточки проекта)",
    "ФИО":      "ФИО",
    "ОРГ":      "Организации (ООО, АО, ИП …)",
    "ИНН":      "ИНН",
    "КПП":      "КПП",
    "ОГРН":     "ОГРН / ОГРНИП",
    "БИК":      "БИК",
    "СЧЁТ":     "Расчётные, корр., лицевые счета",
    "СНИЛС":    "СНИЛС",
    "ПАСПОРТ":  "Паспорт",
    "ТЕЛ":      "Телефоны",
    "EMAIL":    "E-mail",
    "САЙТ":     "Сайты",
    "АДРЕС":    "Адреса",
    "ШИФР":     "Шифры проекта / документов",
    "ДОГОВОР":  "Номера договоров",
    "СУММА":    "Суммы договоров, стоимость, цены",
    "КАДАСТР":  "Кадастровые номера",
    "НОМЕР":    "Номера ГПЗУ, заявлений ДГП, ГЗК, разрешений, заключений",
    "ЛОГИН":    "Логины, пользователи и серверы в путях к файлам",
    "ДАТА":     "Даты",
    "ЧИСЛО":    "Длинные числа (от 7 цифр)",
    "ЦИФРЫ":    "ВСЕ числа подряд (осторожно: уберёт классы бетона, отметки)",
}
DEFAULT_ON = {k for k in CATEGORIES if k not in ("ЦИФРЫ",)}

TOKEN_RE = re.compile(r"\[([A-ZА-ЯЁ]+)_(\d+)\]")

# --------------------------------------------------------------------------- #
#  Проверка контрольных сумм
# --------------------------------------------------------------------------- #
def _inn_ok(s: str) -> bool:
    d = [int(c) for c in s]
    if len(d) == 10:
        k = [2, 4, 10, 3, 5, 9, 4, 6, 8]
        return sum(a * b for a, b in zip(k, d)) % 11 % 10 == d[9]
    if len(d) == 12:
        k1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
        k2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
        c1 = sum(a * b for a, b in zip(k1, d)) % 11 % 10
        c2 = sum(a * b for a, b in zip(k2, d)) % 11 % 10
        return c1 == d[10] and c2 == d[11]
    return False


def _ogrn_ok(s: str) -> bool:
    if len(s) == 13:
        return int(s[:12]) % 11 % 10 == int(s[12])
    if len(s) == 15:
        return int(s[:14]) % 13 % 10 == int(s[14])
    return False


def _person_passport(v):
    """Паспорт человека, а не паспорт изделия и не «выданной лицензии»."""
    s = (v or "").lower()
    if re.search(r"строительн|издели|сертификат|инструкц|маркиров|опалуб|отход|объект", s):
        return False
    return bool(re.search(r"\d|уфмс|мвд|овд|гувм", s))


# --------------------------------------------------------------------------- #
#  Регулярные выражения
# --------------------------------------------------------------------------- #
UP = "А-ЯЁ"
LO = "а-яё"
SURN = rf"[{UP}][{LO}]+(?:-[{UP}][{LO}]+)?"
NAME = rf"[{UP}][{LO}]+"
INIT = rf"[{UP}]\.\s?"
# отчество в любом падеже: Иванович / Ивановича / Михайловна / Михайловны / Михайловной
PATR = (rf"[{UP}][{LO}]+(?:ович|евич|ьич|ич|овн|евн|ичн|иничн|оглы|кызы)"
        rf"(?:а|я|у|ю|ем|ом|е|ы|и|ой|ою)?")
SURN_END = r"(?:ов|ев|ёв|ин|ын|ский|цкий|ской|ская|цкая|ова|ева|ёва|ина|ына|ко|ук|юк|чук|ич|дзе|швили|ян|ер|ман|их|ых)(?:а|у|ым|ом|ой|е|ым|ого|ому|ую)?"

OPF = (r"(?:Общество с ограниченной ответственностью|Акционерное общество|"
       r"Публичное акционерное общество|Закрытое акционерное общество|"
       r"Открытое акционерное общество|Индивидуальный предприниматель|"
       r"ООО|ОАО|ЗАО|ПАО|НАО|АО|ФГУП|ГУП|МУП|ФГБУ|ФГАУ|ГБУ|ГКУ|ГАУ|ГУ|"
       r"МКУ|МБУ|АНО|НКО|ТСЖ|ГК|ФАУ|СРО|НП)")
OPF_SHORT = (r"(?:ООО|ОАО|ЗАО|ПАО|НАО|АО|ФГУП|ГУП|МУП|ФГБУ|ФГАУ|ГБУ|ГКУ|ГАУ|ГУ|"
             r"МКУ|МБУ|АНО|НКО|ТСЖ|ФАУ|СРО|ИП)")
# ” часто стоит в начале названия: так распознавание скана ставит закрывающую кавычку
_Q = "«»\"“”„‘’'"
QUOTED = rf"[{_Q}](?P<q>[^{_Q}\n]{{1,100}})[{_Q}]"
QUOTED_BARE = rf"[{_Q}](?P<v>[^{_Q}\n]{{2,60}})[{_Q}]"

# Название организации в кавычках без «ООО» перед ним: «СТРОЙИНФОРМПРОЕКТ».
# Берём только ЗАГЛАВНЫЕ названия — так пишут фирмы, а заголовки документов
# («АКТ ПРИЁМА-ПЕРЕДАЧИ») отсекаем по первому слову.
ORG_TITLE_WORDS = {
    "АКТ", "ДОГОВОР", "КОНТРАКТ", "СОГЛАШЕНИЕ", "ПРОТОКОЛ", "ЗАКЛЮЧЕНИЕ", "ПРИКАЗ",
    "РАСПОРЯЖЕНИЕ", "УВЕДОМЛЕНИЕ", "ТРЕБОВАНИЕ", "ЗАДАНИЕ", "ТЕХЗАДАНИЕ", "ТЗ",
    "ПРОЕКТ", "ПРОЕКТНАЯ", "РАБОЧАЯ", "ДОКУМЕНТАЦИЯ", "ДОКУМЕНТ", "ВЕДОМОСТЬ",
    "СПЕЦИФИКАЦИЯ", "ПОЯСНИТЕЛЬНАЯ", "ЗАПИСКА", "РАЗДЕЛ", "ЛИСТ", "ТОМ", "СХЕМА",
    "ПЛАН", "РАЗРЕЗ", "ФАСАД", "УЗЕЛ", "СТАДИЯ", "ГОСТ", "СП", "СНИП", "ТУ", "ФЗ",
    "ПРИЛОЖЕНИЕ", "ПЕРЕЧЕНЬ", "РЕЕСТР", "ОПИСЬ", "РАСЧЕТ", "СМЕТА", "ТАБЛИЦА",
    "ФОРМА", "ОБРАЗЕЦ", "ПАМЯТКА", "ИНСТРУКЦИЯ", "РЕГЛАМЕНТ", "ИСХОДНЫЕ", "ДАННЫЕ",
    # сокращения из договора, а не название фирмы: «РИД» — результаты интеллектуальной деятельности
    "РИД", "НДС", "НДФЛ", "НМА", "ГПХ", "ЭЦП", "УКЭП", "МЧД", "КЭП",
    "ЕГРН", "ЕГРЮЛ", "ОГРН", "ОГРНИП", "ИНН", "КПП", "БИК", "СНИЛС", "ФИО",
}


def _quoted_org(v):
    s = (v or "").strip().strip("«»\"“”„'")
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", s)
    if len(letters) < 3 or any(ch.islower() for ch in s):
        return False
    first = re.split(r"[\s,.;:()—–-]+", s)[0].upper()
    return first not in ORG_TITLE_WORDS

STREET_T = (r"(?:улица|проспект|проезд|переулок|шоссе|набережная|бульвар|площадь|"
            r"микрорайон|квартал|тупик|просп|пр-т|пр-д|тракт|наб|пер|туп|мкр|кв-л|"
            r"ул|б-р|пл|ш|пр)")
HOUSE = (r"(?:,?[ \t]*(?:\n[ \t]*)?(?:д|дом|зд|здание|вл|владение|стр|строение|корп|корпус|к|пом|помещение|"
         r"оф|офис|кв|литер|лит|з\.у|уч|участок)\.?(?:[ \t]*\n[ \t]*|[ \t]+)?№?[ \t]*"
         r"[\dА-Яа-я]{0,3}\d[\dА-Яа-я/-]*)")
CITY = rf"(?:(?:г|гор|пос|пгт|с|дер|рп)\.[ \t]*|город[ \t]+)[{UP}][{LO}][\w-]*(?:[ \t-][{UP}][{LO}][\w-]*)?"
ADDR1 = (rf"(?:\b\d{{6}},?[ \t]*)?(?:(?:[{UP}][{LO}]+[ \t](?:обл|область|край|р-н|район)\.?,?[ \t]*)?"
         rf"{CITY},?[ \t]*)?"
         rf"(?:(?:(?<!\w)г\.?[ \t]+)?[{UP}][{LO}]{{4,}},[ \t]*)?"
         rf"(?:\b{STREET_T}\.?[ \t]+(?:[{UP}][\w.-]*|\d+(?:-?[а-я]{{1,2}})?[ \t]+[{UP}][\w-]+)(?:[ \t][{UP}][\w-]+)?|"
         rf"[{UP}][\w-]+(?:[ \t]+[{UP}][\w-]+)?[ \t]+{STREET_T}(?!\w)\.?)"
         rf"{HOUSE}*"
         rf"(?:,[ \t]*\d{{1,4}}(?![ \t]*\d)[а-яА-ЯёЁ]?)?"
         rf"(?:[ \t]*,?[ \t]*а[ \t]*/[ \t]*я[ \t]*\d{{1,6}})?")
ADDR_CITY = rf"(?:\b\d{{6}},?\s*)?\b{CITY}"

MONTHS = r"(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)"


_ADJ_END = re.compile(r"[А-Яа-яЁё-]+(?:ий|ый|ой|ая|яя|ое|ее|ого|его|ому|ему|ом|ем|ую|юю|ей|ые|ие|ых|их|ым|им)\b", re.I)


def _adj_first(v):
    """«Красноярский край», «Калининском районе» — да; «Характеристика района» — нет."""
    return bool(_ADJ_END.match((v or "").strip()))


def _area_word(v):
    """«Общая площадь», «Расчетная площадь» — это площадь помещения, не адрес."""
    return bool(re.fullmatch(r"[А-ЯЁа-яё]+(?:ая|яя)[ \t]+(?:площадь|пл)\.?", (v or "").strip(), re.I))


@dataclass
class Rule:
    cat: str
    rx: re.Pattern
    prio: int = 50          # больше — важнее при пересечении
    check: object = None    # функция проверки значения (получает только цифры)
    group: str = "v"        # какую группу заменять (иначе всё совпадение)
    ifc: bool = True        # применять ли к строкам IFC-модели
    vcheck: object = None   # проверка исходного значения целиком


STAMP_WORDS = {"Лист", "Листов", "Листы", "Стадия", "Изм", "Дата", "Подп", "Подпись", "Кол", "Кол.уч", "Масштаб",
               "Формат", "Масса", "Согласовано", "Инв", "Взам", "Разраб", "Пров", "Утв", "Исп", "Инж", "Нач",
               "Копировал", "Дата", "Код", "Наименование", "Примечание", "Номер", "Документ", "Изменение",
               "Шифр", "Объект", "Заказчик", "План", "Разрез", "Фасад", "Схема", "Узел", "Спецификация",
               "Ведомость", "Общие", "Главный", "Генеральный", "Раздел", "Том", "Книга", "Часть", "Проект"}
GUID_RE = re.compile(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}")
GENERIC_USERS = {"public", "default", "all users", "общие", "default user", "администратор",
                 "administrator", "все пользователи"}


def _r(p, flags=0):
    return re.compile(p, flags)


RULES = [
    # --- реквизиты с подписью (заменяется только значение, подпись остаётся)
    Rule("ИНН",  _r(r"ИНН(?:\s*/\s*КПП)?[\s:№]*(?P<v>\d{12}|\d{10})(?!\d)", re.I), 95),
    Rule("КПП",  _r(r"КПП[\s:№]*(?P<v>\d{9})(?!\d)", re.I), 95),
    Rule("КПП",  _r(r"ИНН\s*/\s*КПП[\s:№]*\d{10}\s*/\s*(?P<v>\d{9})(?!\d)", re.I), 95),
    Rule("ОГРН", _r(r"ОГРН(?:ИП)?[\s:№]*(?P<v>\d{15}|\d{13})(?!\d)", re.I), 95),
    Rule("БИК",  _r(r"БИК[\s:№]*(?P<v>\d{9})(?!\d)", re.I), 95),
    Rule("СЧЁТ", _r(r"(?:р/с|р\.с\.|рс|к/с|к\.с\.|кс|л/с|сч[её]т[а-я]*|корр?\.?\s*сч[её]т)[\s:№]*"
                    r"(?P<v>(?:\d[\s]?){19}\d)(?!\d)", re.I), 95),
    # вся строка паспорта: «гражданина РФ», серия и номер, а не только цифры
    # «паспортам», «паспортизация», «паспорт объекта» — не документ человека
    Rule("ПАСПОРТ", _r(r"(?P<v>паспорт(?!изац|ами\b|ах\b|ам\b)[а-яё]{0,3}\b"
                       r"(?:(?!\b(?:инн|огрн|кпп|адрес|телефон|строительн|издели|сертификат|инструкц)\b)[^\n]){0,200})",
                       re.I), 97, vcheck=_person_passport),
    Rule("ПАСПОРТ", _r(r"(?P<v>гр\.?\s*рф)\b", re.I), 88),
    Rule("АДРЕС", _r(r"(?<![A-Za-zА-Яа-яЁё])(?P<v>РФ)(?![A-Za-zА-Яа-яЁё])"), 80),
    Rule("АДРЕС", _r(r"(?P<v>российск[а-яё]+\s+федерац[а-яё]+)", re.I), 72),
    Rule("ПАСПОРТ", _r(r"(?P<v>выдан(?:а|о)?(?![а-яё])(?:\s*:\s*|\s+)[^\n]{0,180})", re.I), 96, vcheck=_person_passport),
    Rule("ПАСПОРТ", _r(r"(?P<v>(?:отдел(?:ом|е|а|у)?[ \t]+)?(?:уфмс|гу[ \t]+мвд|умвд|мвд|овд)\b[^\n]{0,160})", re.I), 94),
    Rule("ПАСПОРТ", _r(r"(?P<v>росси[ия][ \t]+по\b[^\n]{0,160})", re.I), 94),
    Rule("ПАСПОРТ", _r(r"паспорт[а-яё]*(?:[^\d\n]{0,80})(?P<v>\d{2}\s*\d{2}\s*[,.]?\s*№?\s*\d{6})(?!\d)", re.I), 95),
    Rule("ПАСПОРТ", _r(r"(?:код\s*)?(?:подр(?:азделени[а-яё]*)?|к\s*/\s*п|к\.?\s*п)\.?\s*[:.]?\s*(?P<v>\d{3}-\d{3})(?!\d)", re.I), 90),
    Rule("ДОГОВОР", _r(r"(?:договор|контракт|соглашени[а-яё]*|доверенност[а-яё]*|доп\.?\s*соглашени[а-яё]*)"
                       r"[^\n]{0,60}?(?:№|N[º°g]|(?<!\w)хе(?!\w)|[Nn][oо])\s*(?P<v>[0-9A-Za-zА-Яа-яЁё][\w./\-]{1,24})", re.I), 90),
    # «ДОГОВОР СИП/102»: на скане знак номера часто пропадает.
    # «сипло2» — то же место, если распознавание съело косую и буквы.
    Rule("ДОГОВОР", _r(r"(?:договор[а-яё]*)\s+(?P<v>(?=[^\s]{0,20}\d)[^\s,;)]{2,20})", re.I), 89,
         vcheck=lambda v: not re.fullmatch(r"\d+(?:\.\d+)+\.?", v.strip())),
    # «полис №23LM1896/000952», «договор страхования № 23 LM 1896»
    Rule("ДОГОВОР", _r(r"(?i:полис\w*|договор\w*)[^\n№]{0,40}?№[ \t]*(?P<v>\d[\w./-]*"
                       r"(?:[ \t]+[A-ZА-ЯЁ]{1,8})?(?:[ \t]+\d[\w./-]*){0,2})"), 92),
    # --- суммы: 1 234 567,89 руб. / 15 000 ₽ / (Один миллион ... рублей) / стоимость ... 1 200 000
    Rule("СУММА", _r(r"(?<![\w.,])(?P<v>(?:\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)"
                     r"[ \t]*(?:руб(?:л[а-яё]*)?\.?|р\.|р(?![\w/])|₽|RUB))(?![\w/])", re.I), 93),
    # «68 965,5 (Шестьдесят … рублей)» — цифра стоит перед скобкой, не перед «руб»
    Rule("СУММА", _r(r"(?:размер[а-яё]*|оплат[а-яё]*|оклад[а-яё]*|зарплат[а-яё]*|заработн[а-яё]*|"
                     r"ставк[а-яё]*)[^\d\n]{0,50}"
                     r"(?P<v>\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?)(?![\d%])", re.I), 94),
    Rule("СУММА", _r(r"(?<![\w.,])(?P<v>\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?)"
                     r"(?=\s*\([а-яёА-ЯЁ\s]{0,220}руб)", re.I), 94),
    Rule("СУММА", _r(r"(?P<v>\([а-яёА-ЯЁ][^()]{0,160}?рубл[а-яё]*[^()]{0,40}\))", re.I), 93),
    Rule("СУММА", _r(r"(?P<v>\d{2}\s*коп(?:\.|е[а-я]*))", re.I), 92),
    Rule("СУММА", _r(r"(?:сумм[а-я]*|стоимост[а-я]*|цен[аы]\b|цене\b|НДС|аванс[а-я]*)[^\d\n]{0,40}"
                     r"(?P<v>\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?)(?![\d%])", re.I), 91),
    # --- фамилии в штампах: «Разраб. Иванов», «ГИП Петров И.И.»
    Rule("ФИО", _r(r"(?<![А-Яа-яЁё])(?:Разраб|Разработал|Пров|Проверил|Т\.\s?контр|Н\.\s?контр|Нормоконтр[а-я]*|"
                   r"Утв|Утвердил|Согл|ГИП|ГАП|Нач\.\s?отд|Нач\.\s?гр|Исп|Выполнил|Гл\.\s?спец|Рук\.\s?гр|Инж|"
                   r"Составил|Подготовил)\.?[ \t]*:?[ \t]*(?:[ \t]|\n[ \t]*(?=[А-ЯЁ][а-яё]+(?:[ \t]+[А-ЯЁ]\.[ \t]?[А-ЯЁ]\.?)?[ \t]*(?:\n|$)))"
                   r"(?P<v>[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?:[ \t]+[А-ЯЁ]\.[ \t]?[А-ЯЁ]\.?)?)"),
         89, vcheck=lambda v: v.split()[0] not in STAMP_WORDS),
    Rule("КАДАСТР", _r(r"(?<![\d:])(?P<v>\d{2}:\d{2}:\d{6,7}:\d{1,6})(?![\d:])"), 96),
    Rule("НОМЕР", _r(r"(?<![\w-])(?P<v>ДГП-\d{2}-\d{3,}/\d{2})(?!\d)"), 96),
    Rule("НОМЕР", _r(r"(?<![\w-])(?P<v>(?:RU|РФ)-?\d{2}(?:-\d{1,6}){2,8})(?![\w-])"), 92),
    Rule("НОМЕР", _r(r"(?:ГПЗУ|ГЗК|разрешени[а-я]*|заключени[а-я]*|заявлени[а-я]*|протокол[а-я]*|"
                     r"свидетельств[а-я]*)[^\n№]{0,40}№\s*(?P<v>[\w./-]*\d[\w./-]*)", re.I), 88),
    Rule("ЛОГИН", _r(r"[A-Za-z]:\\+(?:Users|Пользователи|Documents and Settings)\\+"
                     r"(?P<v>[^\\/:*?\"<>|\r\n']+)", re.I), 97,
         vcheck=lambda v: v.strip().lower() not in GENERIC_USERS),
    Rule("ЛОГИН", _r(r"(?<![\\\w])\\\\(?P<v>[\w.-]{2,})\\"), 96),
    Rule("ШИФР", _r(r"шифр[а-я]*(?:\s+проекта)?[\s:№«\"]*(?P<v>(?=\S*\d)[\wА-Яа-яЁё][\wА-Яа-яЁё./_-]{1,}[\wА-Яа-яЁё])", re.I), 90),

    # --- реквизиты без подписи
    Rule("СНИЛС", _r(r"(?<!\d)(?P<v>\d{3}-\d{3}-\d{3}[\s-]\d{2})(?!\d)"), 80),
    Rule("СЧЁТ", _r(r"(?<![\w.,-])(?P<v>\d{20})(?![\w.,])"), 80),
    Rule("СЧЁТ", _r(r"(?<![\d.,])(?P<v>\d{5}\s\d{3}\s\d\s\d{4}\s\d{7})(?![\d.,])"), 80),
    Rule("ОГРН", _r(r"(?<![\w.,-])(?P<v>\d{15}|\d{13})(?![\w.,])"), 70, _ogrn_ok),
    Rule("ИНН",  _r(r"(?<![\w.,-])(?P<v>\d{12}|\d{10})(?![\w.,])"), 70, _inn_ok),
    Rule("БИК",  _r(r"(?<![\w.,-])(?P<v>04\d{7})(?![\w.,])"), 60),

    Rule("EMAIL", _r(r"(?P<v>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)"), 85),
    # поддомен тоже входит в совпадение: site.example.ru целиком, а не только example.ru
    Rule("САЙТ", _r(r"(?P<v>(?:https?://|www\.)[^\s,;)»\"]+"
                    r"|(?<![\w@.-])(?:[\w-]{1,63}\.)+"
                    r"(?:ru|рф|com|net|org|su|рус|moscow|online|pro)\b"
                    r"(?:/[^\s,;)»\"]*)?)", re.I), 75),
    Rule("ТЕЛ",   _r(r"(?P<v>(?:\+7|(?<!\d)8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})(?!\d)"), 85),

    # --- организации
    Rule("ФИО", _r(rf"(?<![А-Яа-яЁё])(?:ИП|Индивидуальн[а-я]+ предпринимател[а-я]+)[ \t]+(?P<v>{SURN}\s+(?:{INIT}{INIT}?|{NAME}(?:\s+{PATR})?))"), 88),
    Rule("ОРГ", _r(rf"(?P<v>\b{OPF}\s*{QUOTED})", re.I), 87),
    Rule("ОРГ", _r(r"(?P<v>Обществ[а-яё]+\s+с\s+ограниченн[а-яё]+\s+ответственност[а-яё]+)", re.I), 64),
    # 000 — так скан читает «ООО»
    Rule("ОРГ", _r(rf"(?P<v>\b(?:ООО|ОАО|ЗАО|ПАО|АО|ФГУП|ГУП|МУП|ГБУ|ГКУ|АНО|000)(?:[ \t]+[{UP}A-Z][\w-]{{2,}}){{1,4}})"), 70),
    # название без «ООО»: «СТРОЙИНФОРМПРОЕКТ»
    Rule("ОРГ", _r(QUOTED_BARE), 58, vcheck=_quoted_org),
    # строка из одной организационно-правовой формы — остаток названия, разорванного вёрсткой
    Rule("ОРГ", _r(rf"(?m)^[ \t]*\(?{OPF_SHORT}\)?[ \t]*$"), 60),

    # --- ФИО
    Rule("ФИО", _r(rf"(?P<v>\b{SURN}\s+{NAME}\s+{PATR})\b"), 68),
    Rule("ФИО", _r(rf"(?P<v>\b{NAME}\s+{PATR}\s+{SURN})\b"), 67),
    Rule("ФИО", _r(rf"(?P<v>\b{NAME}\s+{PATR})\b"), 60),
    Rule("ФИО", _r(rf"(?P<v>\b{SURN}\s+{INIT}{INIT}?)(?![{UP}{LO}])"), 66),
    Rule("ФИО", _r(rf"(?P<v>(?<![{UP}{LO}.]){INIT}{INIT}?{SURN})\b"), 66),

    # --- адреса
    Rule("АДРЕС", _r(rf"(?P<v>{ADDR1})"), 106, vcheck=lambda v: not _area_word(v)),
    # титул чертежа набран прописными: «ВАГОНОРЕМОНТНАЯ УЛИЦА, Д.11»
    Rule("АДРЕС", _r(r"(?P<v>[А-ЯЁ][А-ЯЁ-]{3,}(?:\s+[А-ЯЁ][А-ЯЁ-]{2,})?\s+"
                     r"(?:УЛИЦА|УЛ\.|ПРОСПЕКТ|ПРОЕЗД|ШОССЕ|ПЕРЕУЛОК|НАБЕРЕЖНАЯ|БУЛЬВАР|ПЛОЩАДЬ)"
                     r"\s*,?\s*(?:Д|ДОМ|ВЛ|К)\.?\s*\d[\d/]*)"), 73),
    # «2-я Ямская, вл. 9» — порядковая улица без слова «улица»
    Rule("АДРЕС", _r(rf"(?P<v>\d{{1,2}}-[яеа][ \t]+[{UP}][{LO}]{{2,}}(?:[ \t]+[{UP}][{LO}]{{2,}})?"
                     rf"(?:[ \t]*,?[ \t]*(?:вл|владение|д|дом|ул)\.?[ \t]*№?[ \t]*\d[\dА-Яа-я/-]*)?)"), 74),
    Rule("АДРЕС", _r(r"(?:юридическ[а-яё]*\s+адрес|адрес\s+регистрац[а-яё]*|"
                     r"адрес\s+проживан[а-яё]*|место\s+жительств[а-яё]*)\s*:\s*(?P<v>[^\n]{3,180})", re.I), 96),
    Rule("АДРЕС", _r(r"(?<!\d)(?P<v>\d{6})(?=\s*,)"), 78),
    # одно слово перед «край/область»: иначе «Округ Красноярский край» склеивается
    # в одно совпадение и пропадает, когда «округ» уже занят городом
    Rule("АДРЕС", _r(rf"(?P<v>[{UP}][{LO}]{{3,}}[ \t]+"
                     r"(?:област[а-яё]+|обл\.|кра[йяеюм]+|район[а-яё]*|р-н[а-яё]*\.?|"
                     r"округ[а-яё]*|республик[а-яё]*))(?!\w)", re.I), 64, vcheck=lambda v: _adj_first(v)),
    Rule("АДРЕС", _r(rf"(?P<v>[{UP}][{LO}]{{3,}}[ \t]+[{UP}][{LO}]{{3,}}(?:[ \t]+|[ \t]*\n[ \t]*)"
                     r"(?:округ[а-яё]*|район[а-яё]*|республик[а-яё]*))(?!\w)", re.I), 64, vcheck=lambda v: _adj_first(v)),
    Rule("АДРЕС", _r(r"(?P<v>вн\.?[ \t]*тер\.?[ \t]*г\.?[ \t]*(?:муниципальн[а-яё]*[ \t]+)?округ[а-яё]*)", re.I), 67),
    Rule("АДРЕС", _r(r"(?P<v>республик[а-яё]*)(?=[ \t]*,|[ \t]+в\b)", re.I), 63),
    Rule("АДРЕС", _r(r"(?P<v>а[ \t]*/[ \t]*я(?:[ \t]*\n[ \t]*\d{1,6}|[ \t]*\d{1,6})?)", re.I), 70),
    Rule("АДРЕС", _r(r"(?P<v>округ[а-яё]*)(?=[ \t]+[А-ЯЁа-яё])", re.I), 65),
    Rule("АДРЕС", _r(rf"(?P<v>\bгород[ \t]+[{UP}][{LO}]{{2,}})", re.I), 60),
    Rule("АДРЕС", _r(r"(?P<v>\b(?:г|Г|гор|Гор|ГОР)\.?[ \t]+[А-ЯЁ][А-Яа-яЁё-]{2,})"), 66),
    Rule("АДРЕС", _r(r"(?m)(?P<v>\bд\.?\s*\d{1,4}[0-9A-Za-zА-Яа-яЁё]?)(?=\s*»?\s*$)", re.I | re.M), 58),
    Rule("АДРЕС", _r(rf"(?P<v>[{UP}][{LO}]{{3,}}(?:[ \t]+[{UP}][{LO}]{{2,}})?[ \t]*,[ \t]*дом[ \t]*№?[ \t]*\d[\dА-Яа-я/-]*)"), 62),
    Rule("АДРЕС", _r(r"(?P<v>[А-ЯЁ][а-яё]{4,}(?:ский|ская|ское|цкий|цкая),[ \t]*\d{1,4}(?![ \t]*\d))"), 62),
    Rule("АДРЕС", _r(r"(?P<v>\d{1,4}\s*,\s*кв\.?\s*\d{1,4})"), 60),
    Rule("АДРЕС", _r(rf"(?P<v>{ADDR_CITY})"), 55),
    # «города Москвы», «в городе Москве» — падеж, не «г. Москва»
    Rule("АДРЕС", _r(r"(?P<v>\bМоскв(?:а|ы|е|у|ой)\b)", re.I), 56),

    # номер вида «СИП/66», «ОПЦ/2710»: заглавные буквы, косая черта и цифры
    Rule("ДОГОВОР", _r(r"(?<![\w/-])(?P<v>[А-ЯЁA-Z]{2,6}/\d{1,6}(?:/\d{1,4})?)(?![\w/-])"), 52, ifc=False),
    # --- шифры вида 12-2024-КР, ОПЦ-2710-Д (наши коды файлов НН_ОБ00_П04_АР_АГР не трогаем)
    Rule("ШИФР", _r(r"(?<![\w./-])(?P<v>(?=[\w/-]*\d)(?=[\w/-]*[A-Za-zА-Яа-яЁё])"
                    r"[0-9A-Za-zА-Яа-яЁё]{1,12}(?:[-/][0-9A-Za-zА-Яа-яЁё]{1,12}){2,})(?![\w/-])"), 50,
         ifc=False, vcheck=lambda v: not GUID_RE.search(v)),

    # --- даты и числа
    # З и О — так распознавание скана путает цифры 3 и 0
    Rule("ДАТА", _r(r"(?P<v>\b(?:19|20)\d{2}[ \t]*г\.?[ \t]*р\.)", re.I), 46, ifc=False),
    # «Москва 2023 г.» и отдельно «2023 г.»
    Rule("ДАТА", _r(r"(?P<v>\b(?:[А-ЯЁ][а-яё]{2,}\s+)?(?:19|20)\d{2}\s*г\.(?![ \t]*р\.))", re.I), 44, ifc=False),
    Rule("ДАТА", _r(rf"(?P<v>\b(?:\d|[ЗзОо]){{1,2}}\s*[./]\s*(?:\d|[ЗзОо]){{1,2}}\s*[./]\s*\d{{4}}(?!\d)"
                    rf"|\b(?:\d|[ЗзОо]){{2}}\s*[./]\s*(?:\d|[ЗзОо]){{2}}\s*[./]\s*\d{{2}}(?![\d.])"
                    rf"|\b(?:«\s*)?(?:\d{{1,2}}|[ЗзОо])(?:\s*»)?\s+{MONTHS}\s+\d{{4}}"
                    rf"(?:\s*г(?:ода|\.)?)?)", re.I), 45, ifc=False),
    Rule("ЧИСЛО", _r(r"(?<![\w.,-])(?P<v>\d{7,})(?![\w.,])"), 30, ifc=False),
    Rule("ЦИФРЫ", _r(r"(?P<v>\d+(?:[.,]\d+)*)"), 10, ifc=False),
]

# слова, которые выглядят как ФИО/адрес, но ими не являются
STOP_WORDS = {
    "Россия", "Российская", "Федерация", "Москва", "Раздел", "Лист", "Таблица",
    "Приложение", "Пояснительная", "Записка", "Свод", "Правил",
}


# --------------------------------------------------------------------------- #
#  Хранилище соответствий
# --------------------------------------------------------------------------- #
BLOCK = "██████"
FAKE_ORG = ["Альфа", "Бета", "Гамма", "Дельта", "Омега", "Вектор", "Сигма", "Орион", "Зенит", "Полюс",
            "Меридиан", "Горизонт", "Квадрат", "Модуль", "Каскад", "Пример", "Образец", "Базис", "Ракурс", "Контур"]
FAKE_SUR = ["Иванов", "Петров", "Сидоров", "Смирнов", "Кузнецов", "Попов", "Васильев", "Соколов",
            "Михайлов", "Новиков", "Фёдоров", "Морозов", "Волков", "Алексеев", "Лебедев", "Семёнов"]
FAKE_INI = "АБВГДЕЖЗИКЛМНОПР"


def fake_value(cat, n):
    """Правдоподобная подмена для режима «как настоящие»."""
    i = n - 1
    if cat == "ФИО":
        a = FAKE_INI[(i // len(FAKE_SUR)) % len(FAKE_INI)]
        return f"{FAKE_SUR[i % len(FAKE_SUR)]} {a}.{a}."
    if cat == "ОРГ":
        nm = FAKE_ORG[i % len(FAKE_ORG)] + ("" if i < len(FAKE_ORG) else f"-{i // len(FAKE_ORG) + 1}")
        return f"ООО «{nm}»"
    return {
        "ОБЪЕКТ": f"Объект «Пример-{n}»", "СЛОВАРЬ": f"Условное-{n}", "АДРЕС": f"ул. Условная, д. {n}",
        "ИНН": f"{n:010d}", "КПП": f"{n:09d}", "ОГРН": f"{n:013d}", "БИК": f"{n:09d}",
        "СЧЁТ": f"{n:020d}", "СНИЛС": f"000-000-000 {n % 100:02d}", "ПАСПОРТ": f"00 00 {n:06d}",
        "ТЕЛ": f"+7 (000) 000-{n // 100 % 100:02d}-{n % 100:02d}", "EMAIL": f"user{n}@example.com",
        "САЙТ": f"site{n}.example", "ШИФР": f"ШИФР-{n:03d}", "ДОГОВОР": f"000-{n:03d}",
        "КАДАСТР": f"00:00:0000000:{n}", "НОМЕР": f"000-{n:04d}", "ЛОГИН": f"user{n}",
        "ДАТА": f"01.01.{2000 + n % 100}", "ЧИСЛО": f"{n:07d}", "ЦИФРЫ": f"{n}",
    }.get(cat, f"[{cat}_{n}]")


@dataclass
class Vault:
    tokens: dict = field(default_factory=dict)    # token -> original
    by_key: dict = field(default_factory=dict)    # (cat, norm) -> token
    counters: dict = field(default_factory=dict)
    cats: dict = field(default_factory=dict)      # token -> cat
    fake: bool = False                            # правдоподобные подмены вместо меток
    black: bool = False                           # чёрная плашка вместо меток (без ключа)
    meta: dict = field(default_factory=dict)      # служебное (коэффициент ТЭП и т.п.)

    @staticmethod
    def _norm(cat, value):
        v = re.sub(r"\s+", " ", value.strip()).lower()
        if cat in ("ИНН", "КПП", "ОГРН", "БИК", "СЧЁТ", "СНИЛС", "ПАСПОРТ", "ТЕЛ"):
            v = re.sub(r"\D", "", v)
            if cat == "ТЕЛ" and len(v) == 11:
                v = v[1:]
        elif cat == "ФИО":
            # «Иванову И.И.» и «Иванов И.И.» -> один токен
            parts = re.findall(r"[а-яёa-z]+", v)
            v = " ".join(p[:max(4, len(p) - 3)] if len(p) > 2 else p for p in parts)
        elif cat in ("ОРГ", "ОБЪЕКТ"):
            v = re.sub(r"[«»\"“”„']", "", v)
        return (cat, v)

    def token(self, cat, value):
        key = self._norm(cat, value)
        if key in self.by_key:
            return BLOCK if self.black else self.by_key[key]
        n = self.counters.get(cat, 0) + 1
        self.counters[cat] = n
        tok = fake_value(cat, n) if self.fake else f"[{cat}_{n}]"
        self.by_key[key] = tok
        self.tokens[tok] = value.strip()
        self.cats[tok] = cat
        return BLOCK if self.black else tok

    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"version": 2, "fake": self.fake, "tokens": self.tokens, "cats": self.cats,
                       "counters": self.counters, "meta": self.meta}, f, ensure_ascii=False, indent=2)

    def save_report(self, path):
        with open(path, "w", encoding="utf-8") as f:
            f.write("Метка\tИсходное значение\n")
            for t, v in self.tokens.items():
                f.write(f"{t}\t{v}\n")

    @classmethod
    def from_data(cls, data):
        v = cls()
        v.tokens = data.get("tokens", data)
        v.fake = bool(data.get("fake")) if "tokens" in data else False
        v.cats = data.get("cats", {}) if "tokens" in data else {}
        v.meta = data.get("meta", {}) if "tokens" in data else {}
        v.counters = dict(data.get("counters", {})) if "tokens" in data else {}
        for t, orig in v.tokens.items():
            m = TOKEN_RE.fullmatch(t)
            cat = v.cats.get(t) or (m.group(1) if m else None)
            if not cat:
                continue
            v.cats[t] = cat
            if m:
                v.counters[cat] = max(v.counters.get(cat, 0), int(m.group(2)))
            v.by_key[cls._norm(cat, orig)] = t
        return v

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            return cls.from_data(json.load(f))


# --------------------------------------------------------------------------- #
#  Обезличиватель
# --------------------------------------------------------------------------- #
def norm_value(v):
    return re.sub(r"\s+", " ", v).strip().lower()


# границы слова: подчёркивание считаем разделителем (НН_ОБ00_..._ЧайкоДВ)
LB = r"(?<![0-9A-Za-zА-Яа-яЁё])"
RB = r"(?![0-9A-Za-zА-Яа-яЁё])"


def _stem_rx(w):
    parts = []
    for p in re.split(r"\s+", w.strip()):
        if re.fullmatch(r"[А-ЯЁа-яё][а-яё]{4,}", p):
            stem = p[:-2] if len(p) > 6 else p[:-1]
            parts.append(re.escape(stem) + r"[а-яё]{0,4}")
        else:
            parts.append(re.escape(p))
    return LB + r"\s+".join(parts) + RB


def surname_hits(text, values):
    """Фамилии из найденных ФИО в имени файла: «Белов_С_В», «Чайко_заявление».

    values — найденные ФИО («Белов Сергей Владимирович», «Белов С.В.»). Фамилия — слово
    из 3+ букв с заглавной, которое не является инициалом и не стоит в STOP_WORDS.
    """
    sur = set()
    for v in values or []:
        words = re.findall(r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?", v or "")
        for w in words:
            if len(w) >= 3 and w not in STOP_WORDS and not re.search(r"(?:ович|евич|ьич|овна|евна|ична|инична)$", w):
                sur.add(w)
    hits = []
    for w in sorted(sur, key=len, reverse=True):
        rx = re.compile(_stem_rx(w) if len(w) >= 5 else _exact_rx(w))
        for m in rx.finditer(text):
            hits.append((m.start(), m.end(), "ФИО", m.group(0), 90))
    return hits


def _exact_rx(w):
    return LB + r"\s+".join(map(re.escape, w.split())) + RB


class Anonymizer:
    def __init__(self, enabled=None, dictionary=None, exceptions=None,
                 use_ner=False, vault=None, manual=None, rejected=None,
                 card=None, known=None, fake=False, black=False):
        self.enabled = set(enabled if enabled is not None else DEFAULT_ON)
        # ручные метки: [(значение, категория)] — ищутся точно, без учёта регистра
        self.manual = [(re.compile(_exact_rx(v), re.I), c)
                       for v, c in (manual or []) if v and v.strip()]
        # карточка объекта: [(значение, категория)] — с учётом падежей
        self.card = [(re.compile(_stem_rx(v), re.I), c)
                     for v, c in sorted(card or [], key=lambda x: -len(x[0])) if v and len(v.strip()) >= 2]
        # уже найденные во всех файлах значения — чтобы метка была одна везде
        self.known_rx, self.known_cat = None, {}
        self.add_known(known or [])
        # отклонённые пользователем значения — не заменять
        self.rejected = {norm_value(v) for v in (rejected or [])}
        self.vault = vault or Vault(fake=fake, black=black)
        self.exceptions = [e.strip().lower() for e in (exceptions or []) if e.strip()]
        self.dict_rx = self._build_dict(dictionary or [])
        self.ner = self._load_ner() if use_ner else None
        self.stats = {}
        self.hide_numbers = False

    def add_known(self, pairs):
        """Значения, уже найденные в документе: ищутся везде, в том числе через перенос строки."""
        kn = [(v.strip(), c) for v, c in (pairs or []) if v and len(v.strip()) >= 3]
        if not kn:
            return
        for v, c in kn:
            self.known_cat.setdefault(norm_value(v), c)
        alts = sorted({v for v, _ in kn} | set(getattr(self, "_known_alts", ())), key=len, reverse=True)
        self._known_alts = alts
        self.known_rx = re.compile(LB + "(?:" + "|".join(r"\s+".join(map(re.escape, v.split()))
                                                       for v in alts) + ")" + RB, re.I)

    # словарь: название объекта, заказчика, проекта — с учётом падежных окончаний
    @staticmethod
    def _build_dict(words):
        return [re.compile(_stem_rx(w), re.I)
                for w in sorted({w.strip() for w in words if w.strip()}, key=len, reverse=True)]

    @staticmethod
    def _load_ner():
        try:
            from natasha import Segmenter, NewsEmbedding, NewsNERTagger, Doc
            emb = NewsEmbedding()
            return (Segmenter(), NewsNERTagger(emb), Doc)
        except Exception:
            return None

    def _is_exception(self, value):
        lv = re.sub(r"\s+", " ", value).strip().lower()
        if any(e in lv or lv in e for e in self.exceptions):
            return True
        return value.strip() in STOP_WORDS

    def find(self, text, use_ner=True, ifc=False):
        """Список (start, end, cat, value, prio)."""
        found = []
        for rx, cat in self.manual:
            for m in rx.finditer(text):
                found.append((m.start(), m.end(), cat, m.group(0), 110))
        for rx, cat in self.card:
            for m in rx.finditer(text):
                found.append((m.start(), m.end(), cat, m.group(0), 105))
        if self.known_rx is not None:
            for m in self.known_rx.finditer(text):
                cat = self.known_cat.get(norm_value(m.group(0)))
                if cat and not (ifc and cat in ("ЧИСЛО", "ЦИФРЫ", "ДАТА")):
                    found.append((m.start(), m.end(), cat, m.group(0), 104))
        if "СЛОВАРЬ" in self.enabled:
            for rx in self.dict_rx:
                for m in rx.finditer(text):
                    found.append((m.start(), m.end(), "СЛОВАРЬ", m.group(0), 100))
        for rule in RULES:
            if rule.cat not in self.enabled or (ifc and not rule.ifc):
                continue
            for m in rule.rx.finditer(text):
                g = rule.group if rule.group in m.re.groupindex else 0
                s, e = m.span(g)
                val = m.group(g)
                if BLOCK in val:          # это уже закрытое плашкой — второй раз не ищем
                    continue
                if rule.check and not rule.check(re.sub(r"\D", "", val)):
                    continue
                if rule.vcheck and not rule.vcheck(val):
                    continue
                if self._is_exception(m.group(0)) or self._is_exception(val):
                    continue
                if rule.cat == "ФИО" and any(w in STOP_WORDS for w in re.findall(r"\w+", val)):
                    continue
                found.append((s, e, rule.cat, val, rule.prio))
        if use_ner and self.ner and ("ФИО" in self.enabled or "ОРГ" in self.enabled):
            seg, tagger, Doc = self.ner
            doc = Doc(text)
            doc.segment(seg)
            doc.tag_ner(tagger)
            for sp in doc.spans:
                cat = {"PER": "ФИО", "ORG": "ОРГ"}.get(sp.type)
                if cat in self.enabled and not self._is_exception(sp.text) and len(sp.text) > 3:
                    found.append((sp.start, sp.stop, cat, sp.text, 40))
        if self.rejected:
            found = [f for f in found if f[4] >= 110 or norm_value(f[3]) not in self.rejected]
        # совпадение внутри более длинного той же категории («Иванов» внутри «Иванов И.И.») — берём длинное
        found = [f for f in found if not any(g[0] <= f[0] and g[1] >= f[1] and
                                             (g[1] - g[0]) > (f[1] - f[0]) and g[4] >= 60 and
                                             (g[2] == f[2] or g[4] >= f[4]) for g in found)]
        # убрать пересечения: важнее приоритет, затем длина
        found.sort(key=lambda x: (-x[4], -(x[1] - x[0]), x[0]))
        taken, result = [], []
        for f in found:
            if f[0] == f[1]:
                continue
            if any(not (f[1] <= a or f[0] >= b) for a, b in taken):
                continue
            taken.append((f[0], f[1]))
            result.append(f)
        return sorted(result)

    def text(self, text, use_ner=True, ifc=False, count=True):
        if not text or not text.strip():
            return text
        out, pos = [], 0
        for s, e, cat, val, _ in self.find(text, use_ner, ifc):
            out.append(text[pos:s])
            out.append(self.vault.token(cat, val))
            if count:
                self.stats[cat] = self.stats.get(cat, 0) + 1
            pos = e
        out.append(text[pos:])
        return "".join(out)


# --------------------------------------------------------------------------- #
#  Восстановление
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
#  Работа с файлами
# --------------------------------------------------------------------------- #
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


# сноски, концевые сноски, примечания и список людей — отдельные части пакета
_DOCX_EXTRA_REL = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
    "http://schemas.microsoft.com/office/2011/relationships/people",
)


def _part_xml(part):
    """Корень части пакета. У сносок python-docx не разбирает XML сам — читаем байты."""
    kind = type(part).__name__
    if kind != "Part":
        try:
            return part.element, None
        except Exception:
            pass
    from lxml import etree
    return etree.fromstring(part.blob), part


def _docx_roots(doc):
    """XML-корни: тело, колонтитулы, сноски, концевые сноски, примечания."""
    cached = getattr(doc, "_anon_roots", None)
    if cached is not None:
        return cached
    roots = [doc.element.body]
    for sec in doc.sections:
        for part in (sec.header, sec.footer, sec.first_page_header, sec.first_page_footer,
                     sec.even_page_header, sec.even_page_footer):
            try:
                roots.append(part._element)
            except Exception:
                pass
    raw = []
    seen = set(roots)
    for rel in list(getattr(doc.part, "rels", {}).values()):
        if getattr(rel, "reltype", "") not in _DOCX_EXTRA_REL:
            continue
        try:
            el, raw_part = _part_xml(rel.target_part)
        except Exception:
            continue
        if el is None or el in seen:
            continue
        seen.add(el)
        roots.append(el)
        if raw_part is not None:
            raw.append((raw_part, el))
    doc._anon_roots = roots
    doc._anon_raw = raw
    return roots


def _flush_raw_parts(doc):
    from lxml import etree
    for part, el in getattr(doc, "_anon_raw", ()):
        data = etree.tostring(el, xml_declaration=True, encoding="UTF-8", standalone=True)
        try:
            part.blob = data
        except Exception:
            part._blob = data


def _scrub_author_attrs(element):
    """Имена авторов правок и примечаний живут в атрибутах, не в тексте абзаца."""
    for el in element.iter():
        for key in list(el.attrib):
            if key.rsplit("}", 1)[-1] not in ("author", "initials"):
                continue
            if (el.attrib.get(key) or "").strip():
                el.set(key, "—")


def _docx_text_nodes(p_el, qn):
    """Видимые текстовые узлы абзаца по порядку; содержимое надписей (текстовых полей)
    исключаем — у него свои абзацы."""
    for t in p_el.iter(qn("w:t")):
        el, inside = t.getparent(), False
        while el is not None and el is not p_el:
            if el.tag == qn("w:txbxContent"):
                inside = True
                break
            el = el.getparent()
        if not inside:
            yield t


def _set_wt(node, text):
    node.text = text
    if text != text.strip():
        node.set(XML_SPACE, "preserve")


def _anonymize_paragraph(p_el, func):
    """Обходит ВСЕ текстовые узлы абзаца, включая гиперссылки, поля и элементы управления."""
    from docx.oxml.ns import qn
    nodes = list(_docx_text_nodes(p_el, qn))
    if not nodes:
        return False
    texts = [n.text or "" for n in nodes]
    full = "".join(texts)
    if not full.strip():
        return False
    new = func(full)
    if new == full:
        return False
    # повторный проход по кускам — только для раскладки по узлам, без второго счёта в статистике
    quiet = getattr(func, "quiet", None) or func
    per = [quiet(t) for t in texts]
    if "".join(per) == new:
        for n, t in zip(nodes, per):
            _set_wt(n, t)
    else:
        _set_wt(nodes[0], new)
        for n in nodes[1:]:
            _set_wt(n, "")
    return True


def _docx_all_paragraphs(doc):
    """Все абзацы: тело, таблицы, надписи, элементы управления, колонтитулы."""
    from docx.oxml.ns import qn
    # Храним сами элементы, а не id(): lxml создаёт временные обёртки, их id()
    # переиспользуются после сборки мусора, и новые абзацы считались «уже пройденными».
    seen = set()
    for root in _docx_roots(doc):
        for p_el in list(root.iter(qn("w:p"))):
            if p_el in seen:
                continue
            seen.add(p_el)
            yield p_el


def _docx_links(doc, func):
    """Адреса гиперссылок (mailto:, сайты) лежат не в тексте, а в связях документа."""
    for rel in list(getattr(doc.part, "rels", {}).values()):
        try:
            if not rel.is_external:
                continue
            target = rel._target
            new = func(target)
            if new != target:
                rel._target = new
        except Exception:
            pass


def _apply_docx(path_in, path_out, func):
    import docx
    doc = docx.Document(path_in)
    roots = _docx_roots(doc)
    for p_el in _docx_all_paragraphs(doc):
        _anonymize_paragraph(p_el, func)
    for root in roots:
        _scrub_author_attrs(root)
    _flush_raw_parts(doc)
    _docx_links(doc, func)
    cp = doc.core_properties
    cp.author = cp.last_modified_by = ""
    cp.title = func(cp.title or "")
    cp.comments = ""
    cp.keywords = func(cp.keywords or "")
    cp.subject = func(cp.subject or "")
    cp.category = func(cp.category or "")
    doc.save(path_out)


def _read_text(path):
    for enc in ("utf-8-sig", "cp1251"):
        try:
            with open(path, encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    raise ValueError("Не удалось определить кодировку " + path)


def _paragraph_text(p_el):
    from docx.oxml.ns import qn
    return "".join(n.text or "" for n in _docx_text_nodes(p_el, qn))


def extract_text(path):
    """Текст файла для предпросмотра (тот же, что обрабатывается)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".docx":
        import docx
        doc = docx.Document(path)
        out = []
        for p_el in _docx_all_paragraphs(doc):
            t = _paragraph_text(p_el)
            if t.strip():
                out.append(t)
        return "\n".join(out)
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True)
        out = []
        for ws in wb.worksheets:
            out.append(f"=== Лист «{ws.title}» ===")
            for row in ws.iter_rows(values_only=True):
                vals = ["" if v is None else str(v) for v in row]
                if any(vals):
                    out.append("\t".join(vals).rstrip())
        return "\n".join(out)
    return _read_text(path)
