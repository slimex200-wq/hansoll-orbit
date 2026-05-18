from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from email.utils import format_datetime
from pathlib import Path
from typing import Iterable


INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


@dataclass(frozen=True)
class ExportedMail:
    path: Path
    subject: str
    received: str
    sender: str
    entry_id_hash: str


def safe_filename(value: str, max_chars: int = 80) -> str:
    text = INVALID_FILENAME_CHARS.sub("_", value)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return (text or "mail")[:max_chars]


def entry_hash(entry_id: str) -> str:
    return hashlib.sha256(entry_id.encode("utf-8", "ignore")).hexdigest()[:16]


def as_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def rfc_date(value: object) -> str:
    dt = as_datetime(value)
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return format_datetime(dt)


def item_text(item: object) -> tuple[str, str, str, str, str]:
    subject = str(getattr(item, "Subject", "") or "")
    sender = str(getattr(item, "SenderName", "") or getattr(item, "SenderEmailAddress", "") or "")
    received = rfc_date(getattr(item, "ReceivedTime"))
    entry_id = str(getattr(item, "EntryID", "") or "")
    body = str(getattr(item, "Body", "") or "")
    text = (
        f"Subject: {subject}\n"
        f"From: {sender}\n"
        f"Date: {received}\n"
        f"EntryID: {entry_id}\n"
        "\n"
        f"{body}"
    )
    return subject, sender, received, entry_id, text


def output_path(output_dir: Path, subject: str, received: str, entry_id: str) -> Path:
    digest = entry_hash(entry_id or f"{subject}|{received}")
    prefix = safe_filename(received.replace(",", "").replace(":", "-"), max_chars=32)
    name = safe_filename(subject, max_chars=90)
    return output_dir / f"{prefix}_{digest}_{name}.txt"


def iter_recent_outlook_items(
    folder: str | None,
    count: int,
    *,
    launch_outlook: bool = False,
) -> Iterable[object]:
    try:
        import win32com.client  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("pywin32 is required for Outlook export") from exc

    try:
        outlook = win32com.client.GetActiveObject("Outlook.Application")
    except Exception as exc:
        if not launch_outlook:
            raise RuntimeError(
                "Outlook is not available via COM. Open Outlook first or rerun with --launch-outlook."
            ) from exc
        outlook = win32com.client.Dispatch("Outlook.Application")
    namespace = outlook.GetNamespace("MAPI")
    if folder:
        mail_folder = namespace.Folders.Item(1).Folders[folder]
    else:
        mail_folder = namespace.GetDefaultFolder(6)
    items = mail_folder.Items
    items.Sort("[ReceivedTime]", True)
    exported = 0
    index = 1
    while exported < count and index <= min(items.Count, count * 4):
        item = items.Item(index)
        index += 1
        # Outlook MailItem class is 43. Skip meetings/tasks/etc.
        if getattr(item, "Class", None) != 43:
            continue
        exported += 1
        yield item


def export_items(items: Iterable[object], output_dir: Path) -> list[ExportedMail]:
    output_dir.mkdir(parents=True, exist_ok=True)
    exported: list[ExportedMail] = []
    for item in items:
        subject, sender, received, entry_id, text = item_text(item)
        path = output_path(output_dir, subject, received, entry_id)
        path.write_text(text, encoding="utf-8")
        exported.append(
            ExportedMail(
                path=path,
                subject=subject,
                received=received,
                sender=sender,
                entry_id_hash=entry_hash(entry_id),
            )
        )
    return exported


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export recent Outlook mail to thin text files.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--folder", help="Outlook folder name. Defaults to the default Inbox.")
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--launch-outlook", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    exported = export_items(
        iter_recent_outlook_items(args.folder, args.count, launch_outlook=args.launch_outlook),
        args.output.expanduser(),
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "exported": len(exported),
                "items": [
                    {
                        "path": str(item.path),
                        "subject": item.subject,
                        "received": item.received,
                        "sender": item.sender,
                        "entry_id_hash": item.entry_id_hash,
                    }
                    for item in exported[:20]
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
