from __future__ import annotations

import re
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any


EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})", re.IGNORECASE)
KNOWN_KEYWORDS = ("talbots",)
IGNORED_DOMAINS = {
    "gmail.com",
    "hotmail.com",
    "icloud.com",
    "live.com",
    "msn.com",
    "outlook.com",
    "yahoo.com",
}


def collect_buyer_signals(
    db_path: Path,
    *,
    account_email: str = "",
    limit: int = 2_000,
) -> dict[str, Any]:
    if not db_path.exists():
        return _empty_result("메일 검색 자료가 아직 준비되지 않았습니다.")

    internal_domain = _email_domain(account_email)
    try:
        with closing(sqlite3.connect(
            f"file:{db_path.as_posix()}?mode=ro",
            uri=True,
            timeout=3,
        )) as connection:
            connection.row_factory = sqlite3.Row
            with closing(connection.cursor()) as cursor:
                columns = {
                    str(row[1]).casefold()
                    for row in cursor.execute("PRAGMA table_info(mails)").fetchall()
                }
                if not {"sender", "subject"}.issubset(columns):
                    return _empty_result("메일 검색 자료에 바이어 감지용 필드가 없습니다.")
                recipients_expression = "recipients" if "recipients" in columns else "'' AS recipients"
                rows = cursor.execute(
                    f"""
                    SELECT sender, {recipients_expression}, subject
                    FROM mails
                    ORDER BY received DESC
                    LIMIT ?
                    """,
                    (max(1, min(limit, 10_000)),),
                ).fetchall()
    except sqlite3.Error as error:
        return _empty_result(f"메일 거래처 신호를 읽지 못했습니다: {error}")

    domains: Counter[str] = Counter()
    keywords: Counter[str] = Counter()
    for row in rows:
        text = " ".join(str(row[key] or "") for key in ("sender", "recipients", "subject"))
        lowered = text.casefold()
        for keyword in KNOWN_KEYWORDS:
            if keyword in lowered:
                keywords[keyword] += 1
        for domain in EMAIL_PATTERN.findall(text):
            normalized = domain.casefold().strip(".")
            if (
                not normalized
                or normalized == internal_domain
                or normalized in IGNORED_DOMAINS
            ):
                continue
            domains[normalized] += 1

    return {
        "available": True,
        "analyzedMessages": len(rows),
        "domains": [
            {"domain": domain, "count": count}
            for domain, count in domains.most_common(12)
        ],
        "keywords": dict(keywords),
        "warning": "",
    }


def _email_domain(value: str) -> str:
    match = EMAIL_PATTERN.search(value or "")
    return match.group(1).casefold() if match else ""


def _empty_result(warning: str) -> dict[str, Any]:
    return {
        "available": False,
        "analyzedMessages": 0,
        "domains": [],
        "keywords": {},
        "warning": warning,
    }
