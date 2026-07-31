from __future__ import annotations

import unittest

from opencrab_starter.wam_broker import run_broker_request


class FakeCache:
    def __init__(self) -> None:
        self.value = ""
        self.has_state_changed = False

    def deserialize(self, value: str) -> None:
        self.value = value

    def serialize(self) -> str:
        return self.value or "next-cache"


class FakeApplication:
    CONSOLE_WINDOW_HANDLE = -1
    result: dict[str, object] = {}
    calls: list[dict[str, object]] = []

    def __init__(self, client_id: str, **kwargs: object) -> None:
        self.client_id = client_id
        self.kwargs = kwargs
        cache = kwargs["token_cache"]
        cache.has_state_changed = True

    def acquire_token_interactive(self, scopes: list[str], **kwargs: object) -> dict[str, object]:
        self.calls.append({"scopes": scopes, **kwargs})
        return dict(self.result)

    def get_accounts(self) -> list[dict[str, str]]:
        return [
            {
                "home_account_id": "employee.tenant",
                "local_account_id": "employee",
                "realm": "tenant",
                "username": "user@company.test",
            }
        ]


class WamBrokerTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeApplication.calls = []
        self.payload = {
            "clientId": "client",
            "authority": "https://login.microsoftonline.com/tenant",
            "scopes": ["Mail.Read"],
            "parentWindowHandle": "1234",
            "cache": "old-cache",
        }

    def test_startup_uses_prompt_none_for_silent_windows_account(self) -> None:
        FakeApplication.result = {
            "access_token": "token",
            "expires_in": 3600,
            "id_token_claims": {
                "oid": "employee",
                "tid": "tenant",
                "preferred_username": "user@company.test",
                "name": "User",
            },
        }
        result = run_broker_request(
            self.payload,
            application_factory=FakeApplication,
            cache_factory=FakeCache,
        )
        self.assertEqual(result["state"], "connected")
        self.assertEqual(result["account"]["username"], "user@company.test")
        self.assertEqual(result["cache"], "old-cache")
        self.assertEqual(FakeApplication.calls[0]["prompt"], "none")
        self.assertEqual(FakeApplication.calls[0]["parent_window_handle"], 1234)

    def test_interactive_request_allows_wam_account_ui(self) -> None:
        FakeApplication.result = {
            "access_token": "token",
            "id_token_claims": {
                "oid": "employee",
                "tid": "tenant",
                "preferred_username": "user@company.test",
            },
        }
        result = run_broker_request(
            {**self.payload, "interactive": True},
            application_factory=FakeApplication,
            cache_factory=FakeCache,
        )
        self.assertEqual(result["state"], "connected")
        self.assertIsNone(FakeApplication.calls[0]["prompt"])

    def test_silent_consent_failure_requests_one_time_interaction(self) -> None:
        FakeApplication.result = {
            "error": "interaction_required",
            "error_description": "Consent is required.",
        }
        result = run_broker_request(
            self.payload,
            application_factory=FakeApplication,
            cache_factory=FakeCache,
        )
        self.assertEqual(result["state"], "needs_interaction")
        self.assertNotIn("accessToken", result)


if __name__ == "__main__":
    unittest.main()
