from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from opencrab_starter.index_lock import (
    DEFAULT_WAIT_SECONDS,
    IndexWriterBusyError,
    _resolve_wait_seconds,
    index_writer_lock,
)


class IndexLockTests(unittest.TestCase):
    def test_release_keeps_a_lock_taken_over_by_another_writer(self) -> None:
        with TemporaryDirectory() as temp:
            db_path = Path(temp) / "index.sqlite"
            lock_path = db_path.with_suffix(f"{db_path.suffix}.refresh.lock")

            with index_writer_lock(db_path):
                self.assertTrue(lock_path.exists())
                # A slow refresh can be declared stale and replaced by a second
                # writer while it is still running.
                lock_path.write_text(
                    json.dumps({"pid": os.getpid(), "token": "other-writer"}),
                    encoding="utf-8",
                )

            self.assertTrue(
                lock_path.exists(),
                "the finished writer deleted a lock owned by another writer",
            )
            self.assertEqual(
                json.loads(lock_path.read_text(encoding="utf-8"))["token"],
                "other-writer",
            )

    def test_release_removes_its_own_lock(self) -> None:
        with TemporaryDirectory() as temp:
            db_path = Path(temp) / "index.sqlite"
            lock_path = db_path.with_suffix(f"{db_path.suffix}.refresh.lock")

            with index_writer_lock(db_path):
                payload = json.loads(lock_path.read_text(encoding="utf-8"))
                self.assertEqual(payload["pid"], os.getpid())
                self.assertTrue(payload["token"].startswith(f"{os.getpid()}:"))

            self.assertFalse(lock_path.exists())

    def test_reentrant_writer_in_the_same_process_is_rejected(self) -> None:
        with TemporaryDirectory() as temp:
            db_path = Path(temp) / "index.sqlite"
            with index_writer_lock(db_path):
                with self.assertRaises(IndexWriterBusyError):
                    with index_writer_lock(db_path, wait_seconds=0):
                        pass

    def test_malformed_wait_setting_falls_back_to_the_default(self) -> None:
        previous = os.environ.get("OPENCRAB_INDEX_LOCK_WAIT_SECONDS")
        os.environ["OPENCRAB_INDEX_LOCK_WAIT_SECONDS"] = "not-a-number"
        try:
            self.assertEqual(_resolve_wait_seconds(None), DEFAULT_WAIT_SECONDS)
            os.environ["OPENCRAB_INDEX_LOCK_WAIT_SECONDS"] = "2.5"
            self.assertEqual(_resolve_wait_seconds(None), 2.5)
            self.assertEqual(_resolve_wait_seconds(0), 0)
        finally:
            if previous is None:
                os.environ.pop("OPENCRAB_INDEX_LOCK_WAIT_SECONDS", None)
            else:
                os.environ["OPENCRAB_INDEX_LOCK_WAIT_SECONDS"] = previous


if __name__ == "__main__":
    unittest.main()
