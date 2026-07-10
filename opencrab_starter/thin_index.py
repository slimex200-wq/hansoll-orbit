from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


SUPPORTED_EXTENSIONS = {
    ".csv",
    ".docx",
    ".eml",
    ".html",
    ".md",
    ".pdf",
    ".pptx",
    ".txt",
    ".xls",
    ".xlsb",
    ".xlsm",
    ".xlsx",
}


@dataclass(frozen=True)
class IndexedFile:
    path: Path
    relative_path: str
    extension: str
    size: int
    modified_at: str
    fingerprint: str


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL,
                extension TEXT NOT NULL,
                size INTEGER NOT NULL,
                modified_at TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                indexed_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_runs (
                run_id TEXT PRIMARY KEY,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                stats_json TEXT NOT NULL
            )
            """
        )


def fingerprint_file(path: Path, sample_bytes: int = 65536) -> str:
    stat = path.stat()
    digest = hashlib.sha256()
    digest.update(str(stat.st_size).encode("utf-8"))
    digest.update(str(int(stat.st_mtime)).encode("utf-8"))
    with path.open("rb") as handle:
        digest.update(handle.read(sample_bytes))
    return digest.hexdigest()


def iter_supported_files(source_root: Path) -> list[IndexedFile]:
    source_root = source_root.resolve()
    files: list[IndexedFile] = []
    for root, _, names in os.walk(source_root):
        for name in names:
            path = Path(root) / name
            if path.name.startswith("~$"):
                continue
            extension = path.suffix.lower()
            if extension not in SUPPORTED_EXTENSIONS:
                continue
            try:
                stat = path.stat()
                fingerprint = fingerprint_file(path)
            except OSError:
                continue
            files.append(
                IndexedFile(
                    path=path,
                    relative_path=str(path.relative_to(source_root)),
                    extension=extension,
                    size=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                    fingerprint=fingerprint,
                )
            )
    return files


def build_index(source_root: Path, db_path: Path) -> int:
    source_root = source_root.expanduser().resolve()
    if not source_root.is_dir():
        raise FileNotFoundError(f"source root is missing or not a directory: {source_root}")
    init_db(db_path)
    indexed_at = datetime.now(UTC).isoformat()
    run_id = "thin-index-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    files = iter_supported_files(source_root)
    stats = {"root": str(source_root), "files_seen": len(files), "files_pruned": 0}
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute(
            "INSERT INTO ingest_runs(run_id, started_at, completed_at, stats_json) VALUES (?, ?, ?, ?)",
            (run_id, indexed_at, None, json.dumps(stats)),
        )
        conn.execute("CREATE TEMP TABLE current_paths(path TEXT PRIMARY KEY)")
        conn.executemany(
            "INSERT INTO current_paths(path) VALUES (?)", ((str(item.path),) for item in files)
        )
        conn.executemany(
            """
            INSERT INTO files (
                path, relative_path, extension, size, modified_at, fingerprint, indexed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                relative_path=excluded.relative_path,
                extension=excluded.extension,
                size=excluded.size,
                modified_at=excluded.modified_at,
                fingerprint=excluded.fingerprint,
                indexed_at=excluded.indexed_at
            """,
            [
                (
                    str(item.path),
                    item.relative_path,
                    item.extension,
                    item.size,
                    item.modified_at,
                    item.fingerprint,
                    indexed_at,
                )
                for item in files
            ],
        )
        cursor = conn.execute(
            "DELETE FROM files WHERE path NOT IN (SELECT path FROM current_paths)"
        )
        stats["files_pruned"] = cursor.rowcount
        completed_at = datetime.now(UTC).isoformat()
        conn.execute(
            "UPDATE ingest_runs SET completed_at = ?, stats_json = ? WHERE run_id = ?",
            (completed_at, json.dumps(stats), run_id),
        )
    return len(files)


def search_index(db_path: Path, query: str, limit: int = 20) -> list[dict[str, object]]:
    init_db(db_path)
    like = f"%{query}%"
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT path, relative_path, extension, size, modified_at, indexed_at
            FROM files
            WHERE relative_path LIKE ? OR path LIKE ?
            ORDER BY modified_at DESC
            LIMIT ?
            """,
            (like, like, limit),
        ).fetchall()
    return [dict(row) for row in rows]
