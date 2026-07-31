from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path
from typing import BinaryIO


def pdf_reader_source(path: Path) -> str | BinaryIO:
    """Return a pypdf source for a regular or Base64-encoded PDF file."""
    with path.open("rb") as handle:
        prefix = handle.read(16).lstrip()
        if not prefix.startswith(b"JVBER"):
            return str(path)
        encoded = prefix + handle.read()

    decoded = base64.b64decode(b"".join(encoded.split()), validate=True)
    if not decoded.startswith(b"%PDF"):
        raise ValueError("decoded Base64 content is not a PDF")
    return BytesIO(decoded)
