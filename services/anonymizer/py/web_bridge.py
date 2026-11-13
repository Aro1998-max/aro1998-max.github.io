# -*- coding: utf-8 -*-
"""
Мост между страницей в браузере и ядром поиска (anonymizer_core.py — то же ядро, что в программе для Windows).

PDF разбирает и правит MuPDF.js на стороне страницы; сюда приходят символы страницы с координатами,
отсюда уходят найденные значения и прямоугольники. Word, Excel и текст обрабатываются здесь целиком.
Ничего не отправляется по сети: всё работает в памяти вкладки.
"""
import io
import json
import re

import anonymizer_core as core

_PDF_CHARS = {
    "­": "-", "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-",
    "−": "-", "﹣": "-",
    " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
    "‘": "'", "’": "'", "“": '"', "”": '"', "„": '"',
}
_TABLE = str.maketrans(_PDF_CHARS)
MONEY_HEAD = re.compile(r"стоимост|сумм[аы]|цен[аы]\b|руб|₽|НДС|аванс|оплат|смет", re.I)
REDACT_INSET = .20
PLATE_INSET = .10

CAT_NAMES = {
    "ФИО": "ФИО", "ОРГ": "Организации", "ОБЪЕКТ": "Наименование проекта", "СУММА": "Суммы",
    "КАДАСТР": "Кадастровые номера", "НОМЕР": "Номера ГПЗУ/ДГП", "ЛОГИН": "Логины и пути",
    "ИНН": "ИНН", "КПП": "КПП", "ОГРН": "ОГРН", "БИК": "БИК", "СЧЁТ": "Счета", "СНИЛС": "СНИЛС",
    "ПАСПОРТ": "Паспорта", "ТЕЛ": "Телефоны", "EMAIL": "E-mail", "САЙТ": "Сайты", "АДРЕС": "Адреса",
    "ШИФР": "Шифры", "ДОГОВОР": "Договоры и номера", "ДАТА": "Даты", "ЧИСЛО": "Длинные числа",
    "ЦИФРЫ": "Все числа", "РУЧНОЕ": "Добавлено вручную",
}


def categories():
    return json.dumps({"names": CAT_NAMES, "on": sorted(core.DEFAULT_ON)}, ensure_ascii=False)


# --------------------------------------------------------------------- состояние сеанса
STATE = {"enabled": None, "manual": [], "known": [], "rejected": set(), "office": {}}


def configure(cfg_json):
    cfg = json.loads(cfg_json or "{}")
    if "enabled" in cfg:
        STATE["enabled"] = list(cfg["enabled"])
    if "manual" in cfg:
        STATE["manual"] = [(v, "РУЧНОЕ") for v in cfg["manual"] if v and v.strip()]
    if "rejected" in cfg:
        STATE["rejected"] = set(core.norm_value(v) for v in cfg["rejected"])
    if "enabled" in cfg or "manual" in cfg:
        rebuild_known()
    return "ok"


def rebuild_known():
    """После смены правил: значения, найденные в любом документе, ищутся заново во всех."""
    STATE["known"] = []
    an = _an()
    found = []
    texts = [t for pages in _PDF.values() for t, _b in pages]
    for path in list(STATE["office"]):
        try:
            texts.append(office_text(path))
        except Exception:
            STATE["office"].pop(path, None)
    for t in texts:
        found += [(v, c) for _s, _e, c, v in _ents(an, t) if c not in ("ЧИСЛО", "ЦИФРЫ") and len(v.strip()) >= 5]
    STATE["known"] = found
    return "ok"


def forget(doc_id_or_path):
    _PDF.pop(doc_id_or_path, None)
    STATE["office"].pop(doc_id_or_path, None)
    return "ok"


def _an(with_rejected=False):
    an = core.Anonymizer(enabled=STATE["enabled"], manual=STATE["manual"], black=True,
                         rejected=list(STATE["rejected"]) if with_rejected else None)
    an.add_known(STATE["known"])
    return an


def _ents(an, text):
    return [(s, e, c, v) for s, e, c, v, _p in an.find(text, use_ner=False)] if text.strip() else []


# ------------------------------------------------------------------------- PDF: текст
class _R:
    __slots__ = ("x0", "y0", "x1", "y1")

    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1

    @property
    def width(self):
        return self.x1 - self.x0

    @property
    def height(self):
        return self.y1 - self.y0

    def __or__(self, o):
        return _R(min(self.x0, o.x0), min(self.y0, o.y0), max(self.x1, o.x1), max(self.y1, o.y1))

    def t(self):
        return [round(self.x0, 2), round(self.y0, 2), round(self.x1, 2), round(self.y1, 2)]


def _page_text(chars):
    """Тот же порядок чтения, что в программе: строки, пробелы между словами, колонки."""
    items = []
    for c in chars:
        ch, x0, y0, x1, y1 = c[0], float(c[1]), float(c[2]), float(c[3]), float(c[4])
        if ch == "\n":
            continue
        items.append((y0, x0, x1, y1, _R(x0, y0, x1, y1), ch))
    if not items:
        return "", []
    heights = sorted(c[3] - c[0] for c in items if c[3] > c[0])
    h = heights[len(heights) // 2] if heights else 8
    items.sort(key=lambda c: (c[0], c[1]))
    lines, line_y = [], None
    for it in items:
        yc = (it[0] + it[3]) / 2
        if line_y is None or abs(yc - line_y) > max(h * 0.65, 2):
            lines.append([it])
            line_y = yc
        else:
            lines[-1].append(it)
    for line in lines:
        line.sort(key=lambda c: c[1])
    gap_min = max(14.0, h * 1.6)
    starts = [b[1] for line in lines for a, b in zip(line, line[1:]) if b[1] - a[2] > gap_min]
    gutter = None
    if len(starts) >= 3:
        best = []
        for m in starts:
            cl = [x for x in starts if abs(x - m) < 22]
            if len(cl) > len(best):
                best = cl
        if len(best) >= 3:
            gutter = sum(best) / len(best)
    text, boxes = [], []

    def emit(run):
        prev = None
        for y0, x0, x1, y1, r, ch in run:
            if (prev is not None and x0 - prev > max(h * 0.18, 1.2) and text and not text[-1].isspace()
                    and not ch.isspace()):
                text.append(" ")
                boxes.append(None)
            text.append(ch)
            boxes.append(r)
            prev = x1

    left_runs, right_runs = [], []
    for line in lines:
        if gutter is None:
            left_runs.append(line)
            continue
        left = [c for c in line if c[1] < gutter - 8]
        right = [c for c in line if c[1] >= gutter - 8]
        has_gap = False
        if left and right:
            gap = min(c[1] for c in right) - max(c[2] for c in left)
            has_gap = gap > gap_min and abs(min(c[1] for c in right) - gutter) < 22
        if left and right and has_gap:
            left_runs.append(left)
            right_runs.append(right)
        elif right and not left:
            right_runs.append(line)
        else:
            left_runs.append(line)
    for run in left_runs + right_runs:
        if not run:
            continue
        if text:
            text.append("\n")
            boxes.append(None)
        emit(run)
    return "".join(text).translate(_TABLE), boxes


def _median(vals, fb):
    vals = sorted(vals)
    return vals[len(vals) // 2] if vals else fb


def _line_rects(boxes, s, e):
    out, cur, chars = [], None, []
    for b in boxes[s:e]:
        if b is None:
            if cur is not None:
                out.append((cur, chars))
            cur, chars = None, []
        elif b.width > 0 or b.height > 0:
            cur, chars = (b, [b]) if cur is None else (cur | b, chars + [b])
    if cur is not None:
        out.append((cur, chars))
    res = []
    for r, chars in out:
        vertical = r.height > 1.8 * max(_median([c.height for c in chars], r.height), 1)
        if vertical:
            ink = _R(r.x0 + r.width * REDACT_INSET, r.y0, r.x1 - r.width * REDACT_INSET, r.y1)
            plate = r
        else:
            ink = _R(r.x0, r.y0 + r.height * REDACT_INSET, r.x1, r.y1 - r.height * REDACT_INSET)
            plate = _R(r.x0, r.y0 + r.height * PLATE_INSET, r.x1, r.y1 - r.height * PLATE_INSET)
        res.append({"ink": ink.t(), "plate": plate.t()})
    return res


_PDF = {}


def pdf_scan(doc_id, pages_json):
    """pages: [[ [ch,x0,y0,x1,y1], ... ], ...] -> найденное по листам с прямоугольниками."""
    pages = json.loads(pages_json)
    texts = []
    for chars in pages:
        texts.append(_page_text(chars))
    _PDF[doc_id] = texts
    # первый проход: что нашлось хоть на одном листе, ищем на всех (и через перенос строки)
    an = _an()
    found = []
    for t, _b in texts:
        found += [(v, c) for _s, _e, c, v in _ents(an, t) if c not in ("ЧИСЛО", "ЦИФРЫ") and len(v.strip()) >= 5]
    STATE["known"] += found
    return pdf_hits(doc_id)


def pdf_hits(doc_id):
    an = _an()
    out = []
    for i, (t, boxes) in enumerate(_PDF.get(doc_id, [])):
        hits = []
        for s, e, c, v in _ents(an, t):
            for r in _line_rects(boxes, s, e):
                hits.append({"cat": c, "val": v, "key": core.norm_value(v), **r})
        out.append({"page": i, "chars": len(t.strip()), "hits": hits})
    return json.dumps(out, ensure_ascii=False)


def pdf_control(texts_json):
    """Контрольный прогон по тексту готового PDF: какие скрытые значения ещё читаются."""
    texts = json.loads(texts_json)
    return _control([_page_text(chars)[0] for chars in texts])


def _control(texts):
    vals = {}
    an = _an(with_rejected=True)
    for t in texts:
        for _s, _e, c, v in _ents(an, t):
            pass
    hidden = set(STATE.get("hidden") or [])
    if not hidden:
        return "[]"
    alts = sorted(hidden, key=len, reverse=True)
    rx = re.compile(core.LB + "(?:" + "|".join(r"\s+".join(map(re.escape, v.split())) for v in alts if len(v) >= 4)
                    + ")" + core.RB, re.I) if any(len(v) >= 4 for v in alts) else None
    res = []
    for i, t in enumerate(texts):
        if rx is None:
            break
        for m in rx.finditer(t or ""):
            if core.BLOCK in m.group(0):
                continue
            res.append({"page": i + 1, "value": m.group(0)})
    return json.dumps(res, ensure_ascii=False)


def set_hidden(vals_json):
    STATE["hidden"] = [v.strip() for v in json.loads(vals_json) if v and v.strip()]
    return "ok"


# ----------------------------------------------------------------- Word, Excel, текст
def _decode(data):
    for enc in ("utf-8-sig", "cp1251"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace"), "utf-8"


def office_text(path):
    """Текст для просмотра и поиска — тот же, что будет обработан."""
    if path.lower().endswith((".docx", ".xlsx", ".xlsm")):
        return core.extract_text(path)
    with open(path, "rb") as f:
        return _decode(f.read())[0]


def text_scan(path):
    STATE["office"][path] = True
    t = office_text(path)
    an = _an()
    ents = _ents(an, t)
    STATE["known"] += [(v, c) for _s, _e, c, v in ents if c not in ("ЧИСЛО", "ЦИФРЫ") and len(v.strip()) >= 5]
    return json.dumps({"text": t, "ents": [{"s": s, "e": e, "cat": c, "val": v, "key": core.norm_value(v)}
                                           for s, e, c, v in ents]}, ensure_ascii=False)


def text_hits(path):
    t = office_text(path)
    an = _an()
    return json.dumps({"text": t, "ents": [{"s": s, "e": e, "cat": c, "val": v, "key": core.norm_value(v)}
                                           for s, e, c, v in _ents(an, t)]}, ensure_ascii=False)


def _xlsx_apply(path_in, path_out, an):
    import openpyxl
    block = core.BLOCK
    keep_vba = path_in.lower().endswith(".xlsm")
    wb = openpyxl.load_workbook(path_in, keep_vba=keep_vba)
    func = an.text
    used = set()
    for ws in wb.worksheets:
        money_cols = set()
        nt = re.sub(r"[\[\]:*?/\\]", "", func(ws.title).replace(block, "XXX"))[:31].strip()
        base, n = nt or ws.title, 2
        while nt and nt.lower() in used:
            nt = f"{base[:28]}_{n}"
            n += 1
        ws.title = nt or ws.title
        used.add(ws.title.lower())
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str) and MONEY_HEAD.search(v) and len(v) < 80:
                    money_cols.add(c.column)
                if isinstance(v, str) and not v.startswith("="):
                    nv = func(v)
                    if nv != v:
                        c.value = nv
                elif c.column in money_cols and (isinstance(v, str) and v.startswith("=") or
                                                 isinstance(v, (int, float)) and not isinstance(v, bool)
                                                 and abs(v) >= 1000):
                    c.value = block
                    an.stats["СУММА"] = an.stats.get("СУММА", 0) + 1
                elif isinstance(v, (int, float)) and not isinstance(v, bool) and len(re.sub(r"\D", "", str(v))) >= 7:
                    sv = str(v)
                    nv = func(sv)
                    if nv != sv:
                        c.value = nv
                try:
                    if c.hyperlink is not None and c.hyperlink.target:
                        c.hyperlink.target = func(c.hyperlink.target)
                except Exception:
                    pass
                try:
                    if c.comment is not None and c.comment.text:
                        c.comment.text = func(c.comment.text)
                        c.comment.author = "-"
                except Exception:
                    pass
        try:
            for ft in (ws.oddHeader, ws.oddFooter, ws.evenHeader, ws.evenFooter, ws.firstHeader, ws.firstFooter):
                for part in (ft.left, ft.center, ft.right):
                    if part.text:
                        part.text = func(part.text)
        except Exception:
            pass
    wb.properties.creator = wb.properties.lastModifiedBy = ""
    wb.properties.title = func(wb.properties.title or "")
    wb.save(path_out)
    core.scrub_package(path_out)


def office_apply(path_in, path_out):
    an = _an(with_rejected=True)
    low = path_in.lower()
    if low.endswith(".docx"):
        def f(t):
            return an.text(t, use_ner=False)
        f.quiet = lambda t: an.text(t, use_ner=False, count=False)
        core._apply_docx(path_in, path_out, f)
    elif low.endswith((".xlsx", ".xlsm")):
        _xlsx_apply(path_in, path_out, an)
    else:
        with open(path_in, "rb") as fh:
            text, enc = _decode(fh.read())
        out = an.text(text, use_ner=False)
        with open(path_out, "wb") as fh:
            fh.write(out.encode("utf-8"))
    hidden = sorted(set(an.vault.tokens.values()))
    ctrl_text = office_text(path_out)
    STATE["hidden"] = hidden
    ctrl = json.loads(_control([ctrl_text]))
    return json.dumps({"stats": an.stats, "hidden": hidden, "control": ctrl}, ensure_ascii=False)


def anonymize_name(stem):
    an = _an(with_rejected=True)
    t0 = stem.replace("_", " ")
    hits = [(s, e) for s, e, *_ in an.find(t0, use_ner=False)]
    fio = [v for v, c in STATE["known"] if c == "ФИО"]
    for s, e, _c, v, _p in core.surname_hits(t0, fio):
        if core.norm_value(v) not in STATE["rejected"] and not any(not (e <= a or s >= b) for a, b in hits):
            hits.append((s, e))
    out, pos = [], 0
    for s, e in sorted(hits):
        if s < pos:
            continue
        out.append(stem[pos:s])
        out.append("XXX")
        pos = e
    out.append(stem[pos:])
    t = "".join(out)
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", t).strip() or "Документ"
    return t
