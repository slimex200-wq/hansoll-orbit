from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from opencrab_starter.cli import main


class RulesCliTests(unittest.TestCase):
    def run_rules(self, workspace: Path, *arguments: str) -> str:
        with (
            patch.dict(os.environ, {"OPENCRAB_WORKSPACE": str(workspace)}),
            patch(
                "opencrab_starter.cli.load_config",
                return_value=SimpleNamespace(project_root=workspace, workspace=workspace),
            ),
            patch("sys.argv", ["opencrab-starter", "rules", *arguments]),
            redirect_stdout(io.StringIO()) as output,
        ):
            main()
        return output.getvalue()

    def test_rules_prints_contents_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            knowledge = workspace / "knowledge"
            knowledge.mkdir()
            (knowledge / "workflow.md").write_text("Use the official template.\n", encoding="utf-8")

            output = self.run_rules(workspace)

        self.assertIn("===== workflow.md =====", output)
        self.assertIn("Use the official template.", output)

    def test_rules_names_only_preserves_compact_listing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            knowledge = workspace / "knowledge"
            knowledge.mkdir()
            (knowledge / "workflow.md").write_text("rule", encoding="utf-8")

            output = self.run_rules(workspace, "--names-only")

        self.assertEqual(output.strip(), '[\n  "workflow.md"\n]')


if __name__ == "__main__":
    unittest.main()
