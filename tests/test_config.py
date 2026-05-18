from __future__ import annotations

import os
import shutil
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from opencrab_starter.config import load_config, load_env_file


class ConfigTests(unittest.TestCase):
    def test_load_env_file_reads_simple_key_values(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"config_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            env_path = root / ".env"
            env_path.write_text(
                "OPENCRAB_WORKSPACE=C:\\work\n"
                "OPENCRAB_DB_PATH=data\\thin.sqlite\n"
                "# ignored\n",
                encoding="utf-8",
            )
            values = load_env_file(env_path)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(values["OPENCRAB_WORKSPACE"], "C:\\work")
        self.assertEqual(values["OPENCRAB_DB_PATH"], "data\\thin.sqlite")

    def test_load_config_uses_dotenv_when_environment_is_empty(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"config_{uuid.uuid4().hex}"
        workspace = root / "workspace"
        try:
            root.mkdir(parents=True)
            (root / ".env").write_text(
                f"OPENCRAB_WORKSPACE={workspace}\n"
                f"OPENCRAB_SOURCE_ROOT={root / 'source'}\n"
                "OPENCRAB_DB_PATH=data\\thin.sqlite\n"
                "OPENCRAB_MAIL_DB_PATH=data\\mail.sqlite\n"
                "OPENCRAB_STYLE_DB_PATH=data\\style.sqlite\n"
                "OPENCRAB_VISUAL_DB_PATH=data\\visual.sqlite\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=True), patch("opencrab_starter.config.Path.cwd", return_value=root):
                config = load_config()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(config.workspace, workspace)
        self.assertEqual(config.db_path, workspace / "data" / "thin.sqlite")
        self.assertEqual(config.style_db_path, workspace / "data" / "style.sqlite")
        self.assertEqual(
            config.layout_spec_dir,
            workspace / "knowledge" / "workbook_layout_specs",
        )


if __name__ == "__main__":
    unittest.main()
