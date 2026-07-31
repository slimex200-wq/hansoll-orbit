from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from opencrab_starter.buyer_signals import collect_buyer_signals


class BuyerSignalsTests(unittest.TestCase):
    def test_aggregates_external_domains_without_returning_mail_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "mail.sqlite"
            with closing(sqlite3.connect(db_path)) as connection, connection:
                connection.execute(
                    "CREATE TABLE mails (received TEXT, sender TEXT, recipients TEXT, subject TEXT)"
                )
                connection.executemany(
                    "INSERT INTO mails VALUES (?, ?, ?, ?)",
                    [
                        ("2026-07-30", "Kate <kate@talbots.com>", "user@hansoll.com", "Talbots submit"),
                        ("2026-07-29", "New Buyer <a@newbuyer.example>", "user@hansoll.com", "New style"),
                        ("2026-07-28", "User <user@hansoll.com>", "team@hansoll.com", "Internal"),
                    ],
                )

            result = collect_buyer_signals(db_path, account_email="user@hansoll.com")

            self.assertTrue(result["available"])
            self.assertEqual(result["analyzedMessages"], 3)
            self.assertEqual(result["domains"][0], {"domain": "talbots.com", "count": 1})
            self.assertEqual(result["keywords"]["talbots"], 1)
            self.assertNotIn("subject", result)
            self.assertNotIn("hansoll.com", {item["domain"] for item in result["domains"]})

    def test_supports_legacy_mail_index_without_recipients(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "mail.sqlite"
            with closing(sqlite3.connect(db_path)) as connection, connection:
                connection.execute(
                    "CREATE TABLE mails (received TEXT, sender TEXT, subject TEXT)"
                )
                connection.execute(
                    "INSERT INTO mails VALUES (?, ?, ?)",
                    ("2026-07-30", "Kate <kate@talbots.com>", "Talbots submit"),
                )

            result = collect_buyer_signals(db_path, account_email="user@hansoll.com")

            self.assertTrue(result["available"])
            self.assertEqual(result["domains"], [{"domain": "talbots.com", "count": 1}])


if __name__ == "__main__":
    unittest.main()
