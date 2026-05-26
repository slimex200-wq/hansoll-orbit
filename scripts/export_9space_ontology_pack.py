from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from opencrab_starter.config import load_config


GRAMMAR_SLOTS = [
    {"slot": 1, "source_label": "주체", "key": "subject"},
    {"slot": 2, "source_label": "리소스", "key": "resource"},
    {"slot": 3, "source_label": "증거", "key": "evidence"},
    {"slot": 4, "source_label": "컨셉", "key": "concept"},
    {"slot": 5, "source_label": "의도", "key": "intent"},
    {"slot": 6, "source_label": "대상", "key": "target"},
    {"slot": 7, "source_label": "정책", "key": "policy"},
    {"slot": 8, "source_label": "전략", "key": "strategy"},
    {"slot": 9, "source_label": "대상", "key": "target_context"},
]


@dataclass(frozen=True)
class ExportPaths:
    root: Path
    zip_path: Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def stable_id(prefix: str, *parts: Any) -> str:
    text = "|".join("" if part is None else str(part) for part in parts)
    digest = hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()[:20]
    return f"{prefix}:{digest}"


def connect(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def table_exists(con: sqlite3.Connection, table: str) -> bool:
    row = con.execute(
        "select 1 from sqlite_master where type='table' and name=?",
        (table,),
    ).fetchone()
    return row is not None


def count_rows(con: sqlite3.Connection, table: str) -> int:
    if not table_exists(con, table):
        return 0
    return int(con.execute(f'select count(*) from "{table}"').fetchone()[0])


def row_iter(con: sqlite3.Connection, table: str, limit: int | None = None) -> Iterable[sqlite3.Row]:
    if limit is None or limit <= 0:
        yield from con.execute(f'select * from "{table}"')
    else:
        yield from con.execute(f'select * from "{table}" limit ?', (limit,))


def compact(value: Any, max_len: int = 500) -> str:
    if value is None:
        return ""
    text = str(value).replace("\x00", "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def split_pipe(value: Any) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in str(value).split("|") if item.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            count += 1
    return count


def envelope(
    *,
    subject: dict[str, Any],
    resource: dict[str, Any],
    evidence: dict[str, Any],
    concept: dict[str, Any],
    intent: dict[str, Any],
    target: dict[str, Any],
    policy: dict[str, Any],
    strategy: dict[str, Any],
    target_context: dict[str, Any],
    time: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "subject": subject,
        "resource": resource,
        "evidence": evidence,
        "concept": concept,
        "intent": intent,
        "target": target,
        "policy": policy,
        "strategy": strategy,
        "target_context": target_context,
        "time": time or {},
    }


def style_hit_chunk(row: sqlite3.Row) -> dict[str, Any]:
    chunk_id = stable_id("chunk", "style_hit", row["style_no"], row["relative_path"], row["location"], row["snippet_hash"])
    doc_id = stable_id("doc", "file", row["relative_path"])
    evidence_id = stable_id("evidence", "style_hit", row["style_no"], row["relative_path"], row["location"], row["snippet_hash"])
    return {
        "id": chunk_id,
        "type": "style_hit",
        "document_id": doc_id,
        "text": compact(row["snippet"]),
        "style_no": row["style_no"],
        "source_path": row["path"],
        "relative_path": row["relative_path"],
        "location": row["location"],
        "source_kind": row["source"],
        "evidence_id": evidence_id,
        "nine_spaces": envelope(
            subject={"type": "system_layer", "name": "business_style_index"},
            resource={"type": "file_chunk", "path": row["relative_path"], "location": row["location"]},
            evidence={"id": evidence_id, "pointer": f"{row['path']}#{row['location']}", "hash": row["snippet_hash"]},
            concept={"type": "style_reference", "source": row["source"]},
            intent={"type": "retrieve_style_context"},
            target={"type": "style", "id": row["style_no"]},
            policy={"privacy": "private_pointer_only", "source_priority": "thin_index_pointer"},
            strategy={"retrieval": ["bm25", "style_index"], "route": "style-search"},
            target_context={"scope": row["top_folder"], "relative_path": row["relative_path"]},
            time={"indexed_at": row["indexed_at"]},
        ),
    }


def mail_chunk(row: sqlite3.Row) -> dict[str, Any]:
    styles = split_pipe(row["style_numbers"])
    chunk_id = stable_id("chunk", "mail", row["mail_id"], row["body_hash"])
    evidence_id = stable_id("evidence", "mail", row["mail_id"], row["body_hash"])
    return {
        "id": chunk_id,
        "type": "mail_preview",
        "document_id": stable_id("doc", "mail", row["mail_id"]),
        "text": compact(row["body_preview"], 900),
        "mail_id": row["mail_id"],
        "subject": row["subject"],
        "sender": row["sender"],
        "received": row["received"],
        "style_numbers": styles,
        "quality_codes": split_pipe(row["quality_codes"]),
        "action_terms": split_pipe(row["action_terms"]),
        "evidence_id": evidence_id,
        "nine_spaces": envelope(
            subject={"type": "mail_sender", "name": row["sender"]},
            resource={"type": "mail", "id": row["mail_id"], "folder": row["folder"], "subject": row["subject"]},
            evidence={"id": evidence_id, "mail_id": row["mail_id"], "body_hash": row["body_hash"], "body_chars": row["body_chars"]},
            concept={"type": "mail_context", "seasons": split_pipe(row["seasons"]), "quality_codes": split_pipe(row["quality_codes"])},
            intent={"type": "mail_follow_up", "action_terms": split_pipe(row["action_terms"])},
            target={"type": "style_or_thread", "style_numbers": styles, "subject": row["subject"]},
            policy={"privacy": "private_mail_preview", "freshness_required": True, "human_review": True},
            strategy={"retrieval": ["mail_fts", "style_mail_refs"], "route": "mail-context"},
            target_context={"scope": "mail_history", "folder": row["folder"]},
            time={"received": row["received"], "indexed_at": row["indexed_at"]},
        ),
    }


def fact_chunk(row: sqlite3.Row) -> dict[str, Any]:
    fact_id = row["fact_id"]
    evidence_id = stable_id("evidence", "fact", fact_id, row["evidence_pointer"])
    return {
        "id": stable_id("chunk", "fact", fact_id),
        "type": "structured_fact",
        "document_id": stable_id("doc", "file", row["relative_path"]),
        "text": compact(row["raw_compact"], 900),
        "fact_id": fact_id,
        "style_no": row["style_no"],
        "fact_type": row["fact_type"],
        "status": row["status"],
        "evidence_id": evidence_id,
        "nine_spaces": envelope(
            subject={"type": "business_record", "buyer": row["buyer"], "vendor": row["vendor"]},
            resource={"type": "workbook_row", "path": row["relative_path"], "sheet": row["sheet_name"], "row": row["row_no"]},
            evidence={"id": evidence_id, "pointer": row["evidence_pointer"], "confidence": row["confidence"]},
            concept={"type": row["fact_type"], "season": row["season"], "division": row["division"], "form_type": row["form_type"]},
            intent={"type": "business_status_or_action", "stage": row["stage"], "status": row["status"]},
            target={"type": "style_color_quality", "style_no": row["style_no"], "color": row["color_name"], "quality_code": row["quality_code"]},
            policy={"privacy": "private_business_fact", "source_priority": "structured_fact_then_original_file"},
            strategy={"retrieval": ["facts_fts", "style_index"], "route": "rules+style-search"},
            target_context={"scope": "talbots_workflow", "department": row["department"], "description": row["description"]},
            time={"gac_date": row["gac_date"], "updated_at": row["updated_at"]},
        ),
    }


def sketch_chunk(row: sqlite3.Row) -> dict[str, Any]:
    evidence_id = stable_id("evidence", "sketch", row["sketch_id"], row["image_sha256"])
    return {
        "id": stable_id("chunk", "sketch", row["sketch_id"]),
        "type": "visual_sketch",
        "document_id": stable_id("doc", "file", row["relative_path"]),
        "text": compact(row["nearby_text"], 700),
        "sketch_id": row["sketch_id"],
        "style_no": row["style_no"],
        "thumb_path": row["thumb_path"],
        "evidence_id": evidence_id,
        "nine_spaces": envelope(
            subject={"type": "system_layer", "name": "visual_sketch_index"},
            resource={"type": "image_or_embedded_sketch", "path": row["relative_path"], "location": row["location"]},
            evidence={"id": evidence_id, "image_sha256": row["image_sha256"], "width": row["width"], "height": row["height"]},
            concept={"type": "visual_shape_reference", "ink_density": row["ink_density"], "source": row["source"]},
            intent={"type": "support_visual_similarity_search"},
            target={"type": "style_or_visual_reference", "style_no": row["style_no"]},
            policy={"privacy": "thumbnail_only", "visual_similarity_is_supporting_evidence": True},
            strategy={"retrieval": ["visual_vector", "nearby_text"], "route": "visual-sketch-search"},
            target_context={"scope": row["top_folder"], "relative_path": row["relative_path"]},
            time={"indexed_at": row["indexed_at"]},
        ),
    }


def export_pack(args: argparse.Namespace) -> ExportPaths:
    config = load_config()
    output_root = Path(args.output_root or config.workspace / "outputs" / "opencrab_9space_private_pack")
    output_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    pack_root = output_root / f"opencrab_9space_private_pack_{stamp}"
    pack_root.mkdir(parents=True, exist_ok=True)

    con_style = connect(config.style_db_path)
    con_mail = connect(config.mail_db_path)
    con_fact = connect(config.workspace / "data" / "talbots_thin_ontology.sqlite")
    con_visual = connect(config.visual_db_path)

    source_counts = {
        "style_files": count_rows(con_style, "files"),
        "style_hits": count_rows(con_style, "style_hits"),
        "mails": count_rows(con_mail, "mails"),
        "mail_style_refs": count_rows(con_mail, "mail_style_refs"),
        "facts": count_rows(con_fact, "facts"),
        "sketches": count_rows(con_visual, "sketches"),
    }

    max_style_hits = args.max_style_hits
    max_mails = args.max_mails
    max_facts = args.max_facts
    max_sketches = args.max_sketches

    docs: dict[str, dict[str, Any]] = {}
    entities: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    evidence_rows: dict[str, dict[str, Any]] = {}
    chunk_type_counts: Counter[str] = Counter()

    def add_doc(doc_id: str, doc: dict[str, Any]) -> None:
        docs.setdefault(doc_id, doc)

    def add_entity(entity_id: str, entity_type: str, name: str, **extra: Any) -> None:
        if not name:
            return
        entities.setdefault(entity_id, {"id": entity_id, "type": entity_type, "name": name, **extra})

    def add_relation(source: str, rel_type: str, target: str, evidence_id: str, **extra: Any) -> None:
        rel_id = stable_id("rel", source, rel_type, target, evidence_id)
        relations.setdefault(
            rel_id,
            {"id": rel_id, "source": source, "type": rel_type, "target": target, "evidence_id": evidence_id, **extra},
        )

    def add_evidence(evidence_id: str, payload: dict[str, Any]) -> None:
        evidence_rows.setdefault(evidence_id, {"id": evidence_id, **payload})

    chunks_path = pack_root / "chunks.jsonl"
    with chunks_path.open("w", encoding="utf-8", newline="\n") as chunks_out:
        for row in row_iter(con_style, "style_hits", max_style_hits):
            chunk = style_hit_chunk(row)
            chunks_out.write(json.dumps(chunk, ensure_ascii=False, sort_keys=True) + "\n")
            chunk_type_counts[chunk["type"]] += 1
            doc_id = chunk["document_id"]
            add_doc(
                doc_id,
                {
                    "id": doc_id,
                    "type": "file",
                    "relative_path": row["relative_path"],
                    "path": row["path"],
                    "top_folder": row["top_folder"],
                    "extension": row["extension"],
                },
            )
            style_entity = f"style:{row['style_no']}"
            file_entity = f"document:{doc_id}"
            add_entity(style_entity, "Style", row["style_no"])
            add_entity(file_entity, "Document", row["relative_path"], extension=row["extension"])
            add_evidence(
                chunk["evidence_id"],
                {
                    "type": "style_hit",
                    "pointer": f"{row['path']}#{row['location']}",
                    "snippet_hash": row["snippet_hash"],
                    "snippet": compact(row["snippet"]),
                },
            )
            add_relation(style_entity, "MENTIONED_IN", file_entity, chunk["evidence_id"], location=row["location"])

        for row in row_iter(con_mail, "mails", max_mails):
            chunk = mail_chunk(row)
            chunks_out.write(json.dumps(chunk, ensure_ascii=False, sort_keys=True) + "\n")
            chunk_type_counts[chunk["type"]] += 1
            doc_id = chunk["document_id"]
            add_doc(
                doc_id,
                {
                    "id": doc_id,
                    "type": "mail",
                    "mail_id": row["mail_id"],
                    "folder": row["folder"],
                    "subject": row["subject"],
                    "sender": row["sender"],
                    "received": row["received"],
                },
            )
            mail_entity = f"mail:{row['mail_id']}"
            add_entity(mail_entity, "Mail", row["subject"], sender=row["sender"], received=row["received"])
            add_evidence(
                chunk["evidence_id"],
                {
                    "type": "mail_preview",
                    "mail_id": row["mail_id"],
                    "body_hash": row["body_hash"],
                    "body_chars": row["body_chars"],
                    "preview": compact(row["body_preview"]),
                },
            )
            for style_no in split_pipe(row["style_numbers"]):
                style_entity = f"style:{style_no}"
                add_entity(style_entity, "Style", style_no)
                add_relation(style_entity, "MENTIONED_IN_MAIL", mail_entity, chunk["evidence_id"], received=row["received"])

        for row in row_iter(con_fact, "facts", max_facts):
            chunk = fact_chunk(row)
            chunks_out.write(json.dumps(chunk, ensure_ascii=False, sort_keys=True) + "\n")
            chunk_type_counts[chunk["type"]] += 1
            doc_id = chunk["document_id"]
            add_doc(
                doc_id,
                {
                    "id": doc_id,
                    "type": "structured_source_file",
                    "relative_path": row["relative_path"],
                    "path": row["source_path"],
                    "sheet": row["sheet_name"],
                },
            )
            fact_entity = f"fact:{row['fact_id']}"
            add_entity(fact_entity, "StructuredFact", row["fact_id"], fact_type=row["fact_type"], confidence=row["confidence"])
            if row["style_no"]:
                style_entity = f"style:{row['style_no']}"
                add_entity(style_entity, "Style", row["style_no"])
                add_relation(style_entity, "HAS_FACT", fact_entity, chunk["evidence_id"], fact_type=row["fact_type"])
            add_evidence(
                chunk["evidence_id"],
                {
                    "type": "structured_fact",
                    "pointer": row["evidence_pointer"],
                    "confidence": row["confidence"],
                    "raw_compact": compact(row["raw_compact"]),
                },
            )

        for row in row_iter(con_visual, "sketches", max_sketches):
            chunk = sketch_chunk(row)
            chunks_out.write(json.dumps(chunk, ensure_ascii=False, sort_keys=True) + "\n")
            chunk_type_counts[chunk["type"]] += 1
            doc_id = chunk["document_id"]
            add_doc(
                doc_id,
                {
                    "id": doc_id,
                    "type": "visual_source_file",
                    "relative_path": row["relative_path"],
                    "path": row["path"],
                    "extension": row["extension"],
                },
            )
            sketch_entity = f"sketch:{row['sketch_id']}"
            add_entity(sketch_entity, "Sketch", row["sketch_id"], thumb_path=row["thumb_path"])
            if row["style_no"]:
                style_entity = f"style:{row['style_no']}"
                add_entity(style_entity, "Style", row["style_no"])
                add_relation(style_entity, "HAS_VISUAL_REFERENCE", sketch_entity, chunk["evidence_id"], location=row["location"])
            add_evidence(
                chunk["evidence_id"],
                {
                    "type": "visual_sketch",
                    "pointer": f"{row['path']}#{row['location']}",
                    "image_sha256": row["image_sha256"],
                    "thumb_path": row["thumb_path"],
                    "nearby_text": compact(row["nearby_text"]),
                },
            )

    exported_counts = {
        "documents": write_jsonl(pack_root / "documents.jsonl", docs.values()),
        "entities": write_jsonl(pack_root / "entities.jsonl", entities.values()),
        "relations": write_jsonl(pack_root / "relations.jsonl", relations.values()),
        "evidence": write_jsonl(pack_root / "evidence.jsonl", evidence_rows.values()),
        "chunks": sum(chunk_type_counts.values()),
    }

    grammar = {
        "name": "OpenCrab 9 Spaces Grammar",
        "source": "KakaoTalk_20260515_1223_42_774_group.txt lines 10015-10030",
        "slots": GRAMMAR_SLOTS,
        "time_note": "Time is exported as optional metadata and is not counted as one of the 9 core spaces.",
        "duplicate_note": "The source text repeats 대상 in slots 6 and 9. This pack uses target and target_context while preserving the source labels.",
    }
    (pack_root / "9spaces_grammar.json").write_text(json.dumps(grammar, ensure_ascii=False, indent=2), encoding="utf-8")
    (pack_root / "9spaces_grammar.md").write_text(
        "\n".join(
            [
                "# OpenCrab 9 Spaces Grammar",
                "",
                "Source: KakaoTalk export lines 10015-10030.",
                "",
                "| Slot | Source Label | Export Key |",
                "|---:|---|---|",
                *[f"| {slot['slot']} | {slot['source_label']} | `{slot['key']}` |" for slot in GRAMMAR_SLOTS],
                "",
                "The source repeats `대상`; this export keeps both labels and disambiguates them as `target` and `target_context`.",
                "Time is exported as metadata only.",
            ]
        ),
        encoding="utf-8",
    )

    def ratio(exported: int, source: int) -> float:
        return round(exported / source, 4) if source else 1.0

    coverage = {
        "created_at": utc_now(),
        "source_counts": source_counts,
        "exported_counts": exported_counts,
        "chunk_type_counts": dict(chunk_type_counts),
        "limits": {
            "max_style_hits": max_style_hits,
            "max_mails": max_mails,
            "max_facts": max_facts,
            "max_sketches": max_sketches,
        },
        "coverage_ratio": {
            "style_hits": ratio(chunk_type_counts["style_hit"], source_counts["style_hits"]),
            "mails": ratio(chunk_type_counts["mail_preview"], source_counts["mails"]),
            "facts": ratio(chunk_type_counts["structured_fact"], source_counts["facts"]),
            "sketches": ratio(chunk_type_counts["visual_sketch"], source_counts["sketches"]),
            "chunk_total": ratio(
                sum(chunk_type_counts.values()),
                source_counts["style_hits"] + source_counts["mails"] + source_counts["facts"] + source_counts["sketches"],
            ),
        },
        "notes": [
            "This pack stores pointers, short snippets, hashes, and structured evidence. It does not copy raw OneDrive source files.",
            "If any max_* limit is non-zero, the pack is a sampled/limited export.",
            "Private paths and mail previews may contain sensitive business information; do not upload this private pack publicly.",
        ],
    }
    (pack_root / "coverage_report.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "pack_name": "opencrab_9space_private_pack",
        "created_at": utc_now(),
        "privacy": "private_internal_only",
        "grammar": "9spaces_grammar.json",
        "files": [
            "manifest.json",
            "9spaces_grammar.md",
            "9spaces_grammar.json",
            "documents.jsonl",
            "chunks.jsonl",
            "entities.jsonl",
            "relations.jsonl",
            "evidence.jsonl",
            "coverage_report.json",
        ],
        "counts": exported_counts,
        "source_counts": source_counts,
    }
    (pack_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    readme = "\n".join(
        [
            "# OpenCrab 9-Space Private Pack",
            "",
            "This pack applies the 9-space grammar found in the KakaoTalk OpenCrab discussion to the current local OpenCrab/Talbots indexes.",
            "",
            "It is private and contains source paths, business snippets, and mail previews. Do not upload this pack to a public site.",
            "",
            "Core files:",
            "- `9spaces_grammar.md` / `9spaces_grammar.json`",
            "- `documents.jsonl`",
            "- `chunks.jsonl`",
            "- `entities.jsonl`",
            "- `relations.jsonl`",
            "- `evidence.jsonl`",
            "- `coverage_report.json`",
        ]
    )
    (pack_root / "README.md").write_text(readme, encoding="utf-8")

    zip_path = pack_root.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for file_path in sorted(pack_root.rglob("*")):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(pack_root).as_posix())

    for con in (con_style, con_mail, con_fact, con_visual):
        con.close()

    return ExportPaths(root=pack_root, zip_path=zip_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export current OpenCrab indexes into a 9-space ontology pack.")
    parser.add_argument("--output-root")
    parser.add_argument("--max-style-hits", type=int, default=0, help="0 means all style hits.")
    parser.add_argument("--max-mails", type=int, default=0, help="0 means all mails.")
    parser.add_argument("--max-facts", type=int, default=0, help="0 means all facts.")
    parser.add_argument("--max-sketches", type=int, default=0, help="0 means all sketches.")
    return parser


def main() -> int:
    paths = export_pack(build_parser().parse_args())
    print(json.dumps({"pack_root": str(paths.root), "zip_path": str(paths.zip_path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
