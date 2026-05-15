from __future__ import annotations

import argparse
import json

from .config import load_config
from .knowledge import load_rule_files
from .thin_index import build_index, search_index


def main() -> None:
    parser = argparse.ArgumentParser(prog="opencrab-starter")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("build-index", help="Build or refresh the thin file index")

    search_parser = subparsers.add_parser("search", help="Search indexed file pointers")
    search_parser.add_argument("--query", required=True)
    search_parser.add_argument("--limit", type=int, default=20)

    subparsers.add_parser("rules", help="List project rule files")

    args = parser.parse_args()
    config = load_config()

    if args.command == "build-index":
        count = build_index(config.source_root, config.db_path)
        print(json.dumps({"indexed_files": count, "db_path": str(config.db_path)}, indent=2))
        return

    if args.command == "search":
        rows = search_index(config.db_path, args.query, args.limit)
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    if args.command == "rules":
        rules = load_rule_files(config.workspace / "knowledge")
        print(json.dumps([name for name, _ in rules], ensure_ascii=False, indent=2))
        return


if __name__ == "__main__":
    main()
