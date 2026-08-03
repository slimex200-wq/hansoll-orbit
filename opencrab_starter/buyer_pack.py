"""Buyer pack runtime.

Aligned with the buyer-pack doctrine from the OneOrder ERP design: do not fork
the agent per buyer. Reusable engine code loads a versioned pack at runtime,
and an unknown buyer falls back to the generic pack with a visible warning
instead of silently receiving another buyer's workflow instructions.

A pack currently carries:

- ``playbook``: which action-plan/recommendation flow the work agent uses.
  ``talbots`` selects the tuned Talbots/MGF flow; anything else uses the
  conservative generic flow.
- ``source_roles``: ordered path/text rules that classify evidence files into
  roles (costing, wip, confirmed order, ...). First match wins.
- ``source_root_markers``: folder names that prove a OneDrive root belongs to
  this buyer. The desktop bridge uses them to locate the business source root.
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

DEFAULT_BUYER_ID = "talbots"
GENERIC_BUYER_ID = "generic"

# Last-resort copies so a broken or partially packaged knowledge directory can
# never crash the engine. tests/test_buyer_pack.py pins pack.json against these
# so the two definitions cannot drift apart.
BUILTIN_TALBOTS_SOURCE_ROLES: tuple[dict[str, Any], ...] = (
    {"role": "development_projection", "path_any": ["\\development\\", "allocation"]},
    {"role": "costing", "path_any": ["\\costing\\"]},
    {
        "role": "confirmed_order",
        "path_any": ["원단발주서", "po sheet", "\\vpo_", "agent-vendor po"],
    },
    {"role": "sbd_acc", "path_any": ["sbd", "acc detail"], "text_any": ["order recap"]},
    {"role": "wip", "path_any": ["\\wip\\", "production plan"]},
    {"role": "submit_artifact", "path_any": ["submit form"]},
    {
        "role": "tech_pack",
        "path_any": ["_tp_"],
        "path_suffix_any": [".pdf"],
        "text_any": ["tech pack"],
    },
)

_BUILTIN_PACKS: dict[str, dict[str, Any]] = {
    DEFAULT_BUYER_ID: {
        "buyer_id": DEFAULT_BUYER_ID,
        "label": "Talbots · MGF",
        "version": 1,
        "playbook": "talbots",
        "source_root_markers": ["Talbots"],
        "source_roles": [dict(rule) for rule in BUILTIN_TALBOTS_SOURCE_ROLES],
    },
    GENERIC_BUYER_ID: {
        "buyer_id": GENERIC_BUYER_ID,
        "label": "Generic buyer",
        "version": 1,
        "playbook": "generic",
        "source_root_markers": [],
        # Folder vocabulary below is Hansoll-side convention (costing, WIP,
        # fabric PO, SBD), not buyer-specific, so it is a sane starting point
        # for a buyer without a dedicated pack.
        "source_roles": [dict(rule) for rule in BUILTIN_TALBOTS_SOURCE_ROLES],
    },
}


def buyers_root() -> Path:
    configured = os.environ.get("OPENCRAB_BUYER_PACK_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "knowledge" / "buyers"


def normalize_buyer_id(value: Any) -> str:
    return re.sub(r"[^a-z0-9_-]", "", str(value or "").strip().lower())


def active_buyer_id() -> str:
    return normalize_buyer_id(os.environ.get("OPENCRAB_BUYER")) or DEFAULT_BUYER_ID


@lru_cache(maxsize=16)
def _read_pack(root: str, buyer_id: str) -> dict[str, Any] | None:
    path = Path(root) / buyer_id / "pack.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def load_buyer_pack(buyer_id: str | None = None) -> dict[str, Any]:
    """Load the pack for ``buyer_id`` (default: ``OPENCRAB_BUYER`` env).

    Resolution order: the buyer's own pack → the generic pack with
    ``fallback=True`` → built-in copies. A buyer other than the default never
    silently receives the Talbots playbook.
    """
    requested = normalize_buyer_id(buyer_id) or active_buyer_id()
    root = str(buyers_root())
    own = _read_pack(root, requested)
    if own is not None:
        return {**own, "buyer_id": requested, "fallback": False}
    if requested != DEFAULT_BUYER_ID:
        generic = _read_pack(root, GENERIC_BUYER_ID) or _BUILTIN_PACKS[GENERIC_BUYER_ID]
        return {**generic, "buyer_id": requested, "fallback": True}
    return {**_BUILTIN_PACKS[DEFAULT_BUYER_ID], "fallback": False}


def source_role_for(pack: dict[str, Any], relative_path: Any, text: Any) -> str:
    """Classify one evidence item using the pack's ordered rules."""
    path = str(relative_path or "").lower().replace("/", "\\")
    lowered_text = str(text or "").lower()
    for rule in pack.get("source_roles") or []:
        role = str(rule.get("role") or "")
        if not role:
            continue
        if any(pattern and pattern in path for pattern in rule.get("path_any") or []):
            return role
        if any(
            suffix and path.endswith(str(suffix).lower())
            for suffix in rule.get("path_suffix_any") or []
        ):
            return role
        if any(
            pattern and str(pattern).lower() in lowered_text
            for pattern in rule.get("text_any") or []
        ):
            return role
    return "other_source"


def clear_pack_cache() -> None:
    _read_pack.cache_clear()
