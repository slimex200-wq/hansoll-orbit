from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from typing import Any


INTERACTION_ERRORS = {
    "interaction_required",
    "login_required",
    "consent_required",
    "account_unusable",
    "user_cancelled",
    "no_account",
}


def _clean_text(value: object) -> str:
    return str(value or "").strip()


def _public_account(result: dict[str, Any], accounts: list[dict[str, Any]]) -> dict[str, str]:
    claims = result.get("id_token_claims") or {}
    username = _clean_text(claims.get("preferred_username") or claims.get("upn"))
    tenant_id = _clean_text(claims.get("tid"))
    local_account_id = _clean_text(claims.get("oid") or claims.get("sub"))

    account = next(
        (
            item
            for item in accounts
            if username
            and _clean_text(item.get("username")).casefold() == username.casefold()
            and (not tenant_id or _clean_text(item.get("realm")) == tenant_id)
        ),
        accounts[0] if len(accounts) == 1 else {},
    )
    username = _clean_text(account.get("username") or username)
    tenant_id = _clean_text(account.get("realm") or tenant_id)
    local_account_id = _clean_text(account.get("local_account_id") or local_account_id)
    home_account_id = _clean_text(account.get("home_account_id"))
    if not home_account_id and local_account_id and tenant_id:
        home_account_id = f"{local_account_id}.{tenant_id}"

    return {
        "homeAccountId": home_account_id,
        "localAccountId": local_account_id,
        "tenantId": tenant_id,
        "username": username,
        "name": _clean_text(claims.get("name") or account.get("name") or username),
    }


def _needs_interaction(result: dict[str, Any]) -> bool:
    error = _clean_text(result.get("error")).casefold()
    description = _clean_text(result.get("error_description")).casefold()
    return (
        error in INTERACTION_ERRORS
        or "interaction" in error
        or "interaction" in description
        or "consent" in description
        or "account" in description
    )


def run_broker_request(
    payload: dict[str, Any],
    *,
    application_factory: Callable[..., Any] | None = None,
    cache_factory: Callable[[], Any] | None = None,
) -> dict[str, Any]:
    try:
        import msal
    except ImportError as exc:
        return {
            "available": False,
            "state": "unavailable",
            "error": 'WAM runtime is missing. Install "msal[broker]>=1.20,<2".',
            "detail": str(exc),
        }

    client_id = _clean_text(payload.get("clientId"))
    authority = _clean_text(payload.get("authority"))
    scopes = [_clean_text(item) for item in payload.get("scopes") or [] if _clean_text(item)]
    if not client_id or not authority or not scopes:
        return {
            "available": True,
            "state": "error",
            "error": "WAM requires clientId, authority, and at least one scope.",
        }

    cache = (cache_factory or msal.SerializableTokenCache)()
    serialized_cache = _clean_text(payload.get("cache"))
    if serialized_cache:
        try:
            cache.deserialize(serialized_cache)
        except (ValueError, TypeError):
            serialized_cache = ""

    factory = application_factory or msal.PublicClientApplication
    try:
        app = factory(
            client_id,
            authority=authority,
            token_cache=cache,
            enable_broker_on_windows=True,
        )
        interactive = bool(payload.get("interactive"))
        parent_window_handle = payload.get("parentWindowHandle")
        if parent_window_handle in (None, "", 0, "0"):
            parent_window_handle = app.CONSOLE_WINDOW_HANDLE
        elif isinstance(parent_window_handle, str):
            parent_window_handle = int(parent_window_handle)

        result = app.acquire_token_interactive(
            scopes,
            prompt=None if interactive else "none",
            login_hint=_clean_text(payload.get("loginHint")) or None,
            parent_window_handle=parent_window_handle,
            timeout=int(payload.get("timeoutSeconds") or 120),
        )
    except (ImportError, OSError) as exc:
        return {
            "available": False,
            "state": "unavailable",
            "error": "Windows Web Account Manager is unavailable.",
            "detail": str(exc),
        }
    except Exception as exc:  # Broker failures vary by Windows/MSAL runtime version.
        return {
            "available": True,
            "state": "error",
            "error": "Windows account authentication failed.",
            "detail": str(exc),
            "cache": cache.serialize() if getattr(cache, "has_state_changed", False) else serialized_cache,
        }

    next_cache = cache.serialize() if getattr(cache, "has_state_changed", False) else serialized_cache
    if "access_token" not in result:
        return {
            "available": True,
            "state": "needs_interaction" if _needs_interaction(result) else "error",
            "error": _clean_text(result.get("error_description") or result.get("error"))
            or "Windows account authentication did not return a token.",
            "cache": next_cache,
        }

    accounts = list(app.get_accounts())
    account = _public_account(result, accounts)
    if not account["username"] or not account["tenantId"] or not account["homeAccountId"]:
        return {
            "available": True,
            "state": "error",
            "error": "Windows account metadata is incomplete.",
            "cache": next_cache,
        }
    return {
        "available": True,
        "state": "connected",
        "account": account,
        "accessToken": result["access_token"],
        "expiresIn": int(result.get("expires_in") or 0),
        "cache": next_cache,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Acquire Microsoft Graph tokens through Windows WAM.")
    parser.add_argument("--request-json", help="JSON request. Defaults to stdin.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    raw = args.request_json if args.request_json is not None else sys.stdin.read()
    try:
        payload = json.loads(raw or "{}")
        if not isinstance(payload, dict):
            raise ValueError("request must be a JSON object")
    except (json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"available": False, "state": "error", "error": str(exc)}))
        return 2
    print(json.dumps(run_broker_request(payload), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
