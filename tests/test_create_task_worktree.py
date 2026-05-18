from __future__ import annotations

import shutil
import unittest
from pathlib import Path

from scripts.create_task_worktree import copy_private_knowledge, default_worktree_root, slugify


class CreateTaskWorktreeTests(unittest.TestCase):
    def test_slugify_keeps_readable_task_names(self) -> None:
        self.assertEqual(slugify("Mail Follow-up / Talbots"), "mail-follow-up-talbots")
        self.assertEqual(slugify("  "), "task")

    def test_default_root_is_repo_sibling(self) -> None:
        repo_root = Path("C:/repo/open-crab")
        self.assertEqual(default_worktree_root(repo_root), Path("C:/repo/open-crab-worktrees"))

    def test_copy_private_knowledge_skips_public_readme(self) -> None:
        root = Path.cwd() / ".test_tmp" / "create_task_worktree_case"
        if root.exists():
            shutil.rmtree(root)
        try:
            root.mkdir(parents=True)
            repo = root / "repo"
            worktree = root / "worktree"
            (repo / "knowledge" / "workbook_layout_specs").mkdir(parents=True)
            (repo / "knowledge" / "README.md").write_text("public", encoding="utf-8")
            (repo / "knowledge" / "talbots_workflow_rules.md").write_text("private", encoding="utf-8")
            (repo / "knowledge" / "workbook_layout_specs" / "print.json").write_text(
                "{}", encoding="utf-8"
            )
            (worktree / "knowledge").mkdir(parents=True)

            copied = copy_private_knowledge(repo, worktree, dry_run=False)

            self.assertEqual(copied, 2)
            self.assertFalse((worktree / "knowledge" / "README.md").exists())
            self.assertTrue((worktree / "knowledge" / "talbots_workflow_rules.md").exists())
            self.assertTrue(
                (worktree / "knowledge" / "workbook_layout_specs" / "print.json").exists()
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
