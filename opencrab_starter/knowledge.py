from __future__ import annotations

from pathlib import Path


def load_rule_files(knowledge_dir: Path) -> list[tuple[str, str]]:
    if not knowledge_dir.exists():
        return []
    rules: list[tuple[str, str]] = []
    for path in sorted(knowledge_dir.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        rules.append((path.name, path.read_text(encoding="utf-8")))
    return rules
