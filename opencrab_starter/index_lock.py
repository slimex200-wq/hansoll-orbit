from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator


INDEX_LOCK_STALE_SECONDS = 4 * 60 * 60
DEFAULT_WAIT_SECONDS = 60.0


class IndexWriterBusyError(RuntimeError):
    pass


def _process_is_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _stale_lock(lock_path: Path) -> bool:
    try:
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        age = time.time() - lock_path.stat().st_mtime
        return (
            age > INDEX_LOCK_STALE_SECONDS
            or not _process_is_running(int(payload.get("pid") or 0))
        )
    except (OSError, ValueError, json.JSONDecodeError):
        return True


def _lock_payload(lock_path: Path) -> dict:
    try:
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _lock_owner_pid(lock_path: Path) -> int:
    try:
        return int(_lock_payload(lock_path).get("pid") or 0)
    except (TypeError, ValueError):
        return 0


def _lock_token(lock_path: Path) -> str:
    return str(_lock_payload(lock_path).get("token") or "")


def _resolve_wait_seconds(wait_seconds: float | None) -> float:
    if wait_seconds is not None:
        return wait_seconds
    configured = os.environ.get("OPENCRAB_INDEX_LOCK_WAIT_SECONDS")
    if configured is None:
        return DEFAULT_WAIT_SECONDS
    try:
        return float(configured)
    except ValueError:
        # A malformed operator setting must not take the whole CLI down.
        return DEFAULT_WAIT_SECONDS


@contextmanager
def index_writer_lock(
    db_path: Path,
    *,
    wait_seconds: float | None = None,
) -> Iterator[None]:
    timeout = _resolve_wait_seconds(wait_seconds)
    token = f"{os.getpid()}:{uuid.uuid4().hex}"
    lock_path = db_path.with_suffix(f"{db_path.suffix}.refresh.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + max(0.0, timeout)

    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                payload = json.dumps(
                    {
                        "pid": os.getpid(),
                        "token": token,
                        "started_at": datetime.now(UTC).isoformat(),
                    }
                ).encode("utf-8")
                os.write(descriptor, payload)
            finally:
                os.close(descriptor)
            break
        except FileExistsError:
            if _stale_lock(lock_path):
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    pass
                continue
            if _lock_owner_pid(lock_path) == os.getpid():
                raise IndexWriterBusyError(
                    f"Index refresh is already running for {db_path.name}."
                )
            if time.monotonic() >= deadline:
                raise IndexWriterBusyError(
                    f"Index refresh is already running for {db_path.name}."
                )
            time.sleep(0.2)

    try:
        yield
    finally:
        # Only remove the lock this call actually owns. A long refresh can be
        # declared stale and taken over by another writer; deleting that
        # writer's lock here would let a third process open the same SQLite
        # index concurrently.
        if _lock_token(lock_path) == token:
            try:
                lock_path.unlink()
            except FileNotFoundError:
                pass
