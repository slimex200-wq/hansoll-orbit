from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class OpenCrabConfig:
    source_root: Path
    workspace: Path
    db_path: Path
    mail_db_path: Path
    style_db_path: Path
    visual_db_path: Path
    mail_source: Path | None
    max_mail_age_hours: int
    layout_spec_dir: Path


def load_env_file(path: Path | None = None) -> dict[str, str]:
    env_path = path or Path.cwd() / ".env"
    if not env_path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def env_value(name: str, default: object, env_file: dict[str, str]) -> object:
    return os.getenv(name) or env_file.get(name) or default


def int_env_value(name: str, default: int, env_file: dict[str, str]) -> int:
    value = env_value(name, default, env_file)
    try:
        return int(str(value))
    except ValueError:
        return default


def load_config() -> OpenCrabConfig:
    env_file = load_env_file()
    workspace = Path(env_value("OPENCRAB_WORKSPACE", Path.cwd(), env_file)).expanduser()
    source_root = Path(env_value("OPENCRAB_SOURCE_ROOT", workspace / "sample_source", env_file)).expanduser()
    db_path = Path(env_value("OPENCRAB_DB_PATH", workspace / "data" / "opencrab_thin_index.sqlite", env_file))
    mail_db_path = Path(env_value("OPENCRAB_MAIL_DB_PATH", workspace / "data" / "mail_thin_ontology.sqlite", env_file))
    style_db_path = Path(
        env_value("OPENCRAB_STYLE_DB_PATH", workspace / "data" / "business_style_index.sqlite", env_file)
    )
    visual_db_path = Path(
        env_value("OPENCRAB_VISUAL_DB_PATH", workspace / "data" / "visual_sketch_index.sqlite", env_file)
    )
    mail_source_value = env_value("OPENCRAB_MAIL_SOURCE", "", env_file)
    mail_source = Path(mail_source_value).expanduser() if mail_source_value else None
    max_mail_age_hours = int_env_value("OPENCRAB_MAX_MAIL_AGE_HOURS", 72, env_file)
    layout_spec_dir = Path(
        env_value("OPENCRAB_LAYOUT_SPEC_DIR", workspace / "knowledge" / "workbook_layout_specs", env_file)
    )
    if not db_path.is_absolute():
        db_path = workspace / db_path
    if not mail_db_path.is_absolute():
        mail_db_path = workspace / mail_db_path
    if not style_db_path.is_absolute():
        style_db_path = workspace / style_db_path
    if not visual_db_path.is_absolute():
        visual_db_path = workspace / visual_db_path
    if mail_source is not None and not mail_source.is_absolute():
        mail_source = workspace / mail_source
    if not layout_spec_dir.is_absolute():
        layout_spec_dir = workspace / layout_spec_dir
    return OpenCrabConfig(
        source_root=source_root,
        workspace=workspace,
        db_path=db_path,
        mail_db_path=mail_db_path,
        style_db_path=style_db_path,
        visual_db_path=visual_db_path,
        mail_source=mail_source,
        max_mail_age_hours=max_mail_age_hours,
        layout_spec_dir=layout_spec_dir,
    )
