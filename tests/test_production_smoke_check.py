from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import production_smoke_check as smoke


class ProductionSmokeCheckTests(unittest.TestCase):
    def make_git_repo(self, ignore_rules: str) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        subprocess.run(
            ["git", "init", "--quiet"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        (root / ".gitignore").write_text(ignore_rules, encoding="utf-8")
        return root

    def test_private_prefixes_are_ignored(self) -> None:
        root = self.make_git_repo(
            "\n".join(f"/{prefix}" for prefix in smoke.IGNORED_PRIVATE_PREFIXES) + "\n"
        )

        detail = smoke.check_private_prefixes_ignored(root)

        self.assertIn(str(len(smoke.IGNORED_PRIVATE_PREFIXES)), detail)

    def test_private_prefix_check_fails_when_rule_is_missing(self) -> None:
        rules = [prefix for prefix in smoke.IGNORED_PRIVATE_PREFIXES if prefix != "tmp/"]
        root = self.make_git_repo("\n".join(f"/{prefix}" for prefix in rules) + "\n")

        with self.assertRaisesRegex(RuntimeError, "tmp/"):
            smoke.check_private_prefixes_ignored(root)

    def test_generated_authentication_files_fail_even_when_ignored(self) -> None:
        root = self.make_git_repo("**/codex-home/\n")
        secret = root / "release" / "codex-home" / "tokens.json"
        secret.parent.mkdir(parents=True)
        secret.write_text("secret", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "tokens.json"):
            smoke.check_git_ignored_private_paths(root)

    def test_unignored_credentials_file_fails(self) -> None:
        root = self.make_git_repo("")
        secret = root / "credentials.json"
        secret.write_text("secret", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "credentials.json"):
            smoke.check_git_ignored_private_paths(root)

    def test_declared_runtime_dependencies_are_imported(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        (root / "pyproject.toml").write_text(
            """
[project]
dependencies = [
  "openpyxl>=3.1",
  "Pillow",
  "pypdf[crypto]>=5",
]
""".strip(),
            encoding="utf-8",
        )

        with patch.object(smoke.importlib, "import_module") as import_module:
            detail = smoke.check_declared_runtime_dependencies(root)

        imported = [call.args[0] for call in import_module.call_args_list]
        self.assertEqual(imported, ["openpyxl", "PIL", "pypdf"])
        self.assertIn("3", detail)

    def test_missing_runtime_dependency_fails(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        (root / "pyproject.toml").write_text(
            '[project]\ndependencies = ["missing-opencrab-runtime"]\n',
            encoding="utf-8",
        )

        with patch.object(
            smoke.importlib,
            "import_module",
            side_effect=ModuleNotFoundError("missing runtime"),
        ):
            with self.assertRaisesRegex(RuntimeError, "missing-opencrab-runtime"):
                smoke.check_declared_runtime_dependencies(root)

    def test_sbd_validator_is_required_and_imported(self) -> None:
        self.assertIn("opencrab_starter/sbd_validator.py", smoke.REQUIRED_FILES)
        self.assertIn("tests/test_sbd_validator.py", smoke.REQUIRED_FILES)

        with patch.object(smoke.importlib, "import_module") as import_module:
            smoke.check_imports()

        imported = [call.args[0] for call in import_module.call_args_list]
        self.assertIn("opencrab_starter.sbd_validator", imported)

    def test_packaged_app_rejects_private_database(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        package = Path(temp_dir.name)
        (package / "resources").mkdir()
        (package / "resources" / "mail-index.sqlite").write_bytes(b"private")

        with self.assertRaisesRegex(RuntimeError, "mail-index.sqlite"):
            smoke.check_packaged_private_data(package)

    def test_packaged_app_accepts_clean_archive(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        package = Path(temp_dir.name)
        (package / "resources").mkdir()
        (package / "resources" / "app.asar").write_bytes(b"clean application code")

        detail = smoke.check_packaged_private_data(package)
        self.assertIn("1 app archive", detail)

    def test_synthetic_fixture_scan_rejects_private_identifiers(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        fixture = root / "examples" / "sample.json"
        fixture.parent.mkdir(parents=True)
        fixture.write_text(
            '{"path":"C:\\\\Users\\\\employee\\\\OneDrive - Company",'
            '"email":"person@hansoll.com"}',
            encoding="utf-8",
        )

        with self.assertRaisesRegex(RuntimeError, "synthetic fixtures"):
            smoke.check_synthetic_fixture_privacy(root)

    def test_synthetic_fixture_scan_accepts_demo_only_data(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        fixture = root / "examples" / "sample.json"
        fixture.parent.mkdir(parents=True)
        fixture.write_text(
            '{"style":"DEMO-STYLE-001","email":"reviewer@example.com"}',
            encoding="utf-8",
        )

        detail = smoke.check_synthetic_fixture_privacy(root)

        self.assertIn("1 synthetic fixture", detail)


if __name__ == "__main__":
    unittest.main()
