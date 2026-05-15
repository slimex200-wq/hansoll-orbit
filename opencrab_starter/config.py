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


def load_config() -> OpenCrabConfig:
    workspace = Path(os.getenv("OPENCRAB_WORKSPACE", Path.cwd())).expanduser()
    source_root = Path(os.getenv("OPENCRAB_SOURCE_ROOT", workspace / "sample_source")).expanduser()
    db_path = Path(os.getenv("OPENCRAB_DB_PATH", workspace / "data" / "opencrab_thin_index.sqlite"))
    mail_db_path = Path(os.getenv("OPENCRAB_MAIL_DB_PATH", workspace / "data" / "mail_thin_ontology.sqlite"))
    if not db_path.is_absolute():
        db_path = workspace / db_path
    if not mail_db_path.is_absolute():
        mail_db_path = workspace / mail_db_path
    return OpenCrabConfig(
        source_root=source_root,
        workspace=workspace,
        db_path=db_path,
        mail_db_path=mail_db_path,
    )
