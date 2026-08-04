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
    max_index_age_hours: int = 168
    project_root: Path | None = None
    fact_db_path: Path | None = None

    def __post_init__(self) -> None:
        if self.project_root is None:
            object.__setattr__(self, "project_root", self.workspace)
        if self.fact_db_path is None:
            object.__setattr__(
                self,
                "fact_db_path",
                self.workspace / "data" / "talbots_thin_ontology.sqlite",
            )


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


def find_project_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).expanduser().resolve()
    if (current / ".env").is_file():
        return current
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").is_file() and (candidate / "opencrab_starter").is_dir():
            return candidate
    return current


def load_config() -> OpenCrabConfig:
    project_root = find_project_root()
    env_file = load_env_file(project_root / ".env")
    workspace = Path(env_value("OPENCRAB_WORKSPACE", project_root, env_file)).expanduser()
    source_root = Path(
        env_value("OPENCRAB_SOURCE_ROOT", workspace / "sample_source", env_file)
    ).expanduser()
    db_path = Path(
        env_value("OPENCRAB_DB_PATH", workspace / "data" / "opencrab_thin_index.sqlite", env_file)
    )
    mail_db_path = Path(
        env_value(
            "OPENCRAB_MAIL_DB_PATH", workspace / "data" / "mail_thin_ontology.sqlite", env_file
        )
    )
    style_db_path = Path(
        env_value(
            "OPENCRAB_STYLE_DB_PATH", workspace / "data" / "business_style_index.sqlite", env_file
        )
    )
    visual_db_path = Path(
        env_value(
            "OPENCRAB_VISUAL_DB_PATH", workspace / "data" / "visual_sketch_index.sqlite", env_file
        )
    )
    fact_db_path = Path(
        env_value(
            "OPENCRAB_FACT_DB_PATH",
            workspace / "data" / "talbots_thin_ontology.sqlite",
            env_file,
        )
    )
    mail_source_value = env_value("OPENCRAB_MAIL_SOURCE", "", env_file)
    mail_source = Path(mail_source_value).expanduser() if mail_source_value else None
    max_mail_age_hours = int_env_value("OPENCRAB_MAX_MAIL_AGE_HOURS", 72, env_file)
    max_index_age_hours = int_env_value("OPENCRAB_MAX_INDEX_AGE_HOURS", 168, env_file)
    layout_spec_dir = Path(
        env_value(
            "OPENCRAB_LAYOUT_SPEC_DIR",
            project_root / "knowledge" / "workbook_layout_specs",
            env_file,
        )
    )
    if not db_path.is_absolute():
        db_path = workspace / db_path
    if not mail_db_path.is_absolute():
        mail_db_path = workspace / mail_db_path
    if not style_db_path.is_absolute():
        style_db_path = workspace / style_db_path
    if not visual_db_path.is_absolute():
        visual_db_path = workspace / visual_db_path
    if not fact_db_path.is_absolute():
        fact_db_path = workspace / fact_db_path
    if mail_source is not None and not mail_source.is_absolute():
        mail_source = workspace / mail_source
    if not layout_spec_dir.is_absolute():
        layout_spec_dir = project_root / layout_spec_dir
    return OpenCrabConfig(
        source_root=source_root,
        workspace=workspace,
        db_path=db_path,
        mail_db_path=mail_db_path,
        style_db_path=style_db_path,
        visual_db_path=visual_db_path,
        fact_db_path=fact_db_path,
        mail_source=mail_source,
        max_mail_age_hours=max_mail_age_hours,
        layout_spec_dir=layout_spec_dir,
        max_index_age_hours=max_index_age_hours,
        project_root=project_root,
    )
