"""Multi-tenancy + carry-over tests for cash/beverages daily endpoints.

Covers:
- Admin can target a specific restaurant via X-Restaurant-Id header (PUT/GET)
- Non-admin cannot impersonate (their token's restaurant_id wins)
- Isolation: data of Flaminio is not visible to Grazie and vice versa
- prev_cash_sera carry-over (yesterday -> today)
- /api/admin/closures admin-only + isolated by restaurant
- /api/beverages/daily/history honors X-Restaurant-Id
"""
import os
import sys
import asyncio
import pytest
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

if not BASE_URL:
    # Read frontend .env directly as fallback
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass

ROME_TZ = ZoneInfo("Europe/Rome")
PASSWORD = "Pastasciutt4!"
TIMEOUT = 30


def _today_str() -> str:
    return datetime.now(ROME_TZ).strftime("%Y-%m-%d")


def _yesterday_str() -> str:
    return (datetime.now(ROME_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")


# ---------- session-scoped fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "Admin", "password": PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def flaminio_session():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "Flaminio", "password": PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Flaminio login failed: {r.text}"
    body = r.json()
    return {"token": body["token"], "id": body["restaurant"]["id"]}


@pytest.fixture(scope="session")
def grazie_session():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "Grazie", "password": PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Grazie login failed: {r.text}"
    body = r.json()
    return {"token": body["token"], "id": body["restaurant"]["id"]}


def _hdr(token, rid=None):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if rid:
        h["X-Restaurant-Id"] = rid
    return h


# ---------- Cleanup helpers (direct mongo, sync via pymongo) ----------
@pytest.fixture(scope="module", autouse=True)
def cleanup_data(flaminio_session, grazie_session):
    from pymongo import MongoClient
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    today = _today_str()
    yest = _yesterday_str()
    flaminio_id = flaminio_session["id"]
    grazie_id = grazie_session["id"]
    # pre-clean today
    for rid in (flaminio_id, grazie_id):
        db.cash_daily_counts.delete_many({"restaurant_id": rid, "date_rome": today})
        db.beverage_daily_counts.delete_many({"restaurant_id": rid, "date_rome": today})
    yield
    # post-clean today + test_marker yesterday rows
    for rid in (flaminio_id, grazie_id):
        db.cash_daily_counts.delete_many({"restaurant_id": rid, "date_rome": today})
        db.beverage_daily_counts.delete_many({"restaurant_id": rid, "date_rome": today})
        db.cash_daily_counts.delete_many(
            {"restaurant_id": rid, "date_rome": yest, "_test_marker": True}
        )
        db.beverage_daily_counts.delete_many(
            {"restaurant_id": rid, "date_rome": yest, "_test_marker": True}
        )
        db.cash_audit_log.delete_many(
            {"restaurant_id": rid, "date_rome": today, "_test_marker": True}
        )
    client.close()


# ============ CASH DAILY ============
class TestCashDailyMultiTenancy:
    def test_admin_put_flaminio_then_grazie_isolation(
        self, admin_token, flaminio_session, grazie_session
    ):
        flaminio_id = flaminio_session["id"]
        grazie_id = grazie_session["id"]

        # Admin writes to Flaminio
        r1 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"mattina": "100", "vers": "5", "vers_color": "red"},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        assert r1.json().get("ok") is True

        # Admin writes to Grazie
        r2 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, grazie_id),
            json={"mattina": "200"},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text

        # GET as Admin scoped to Flaminio
        g_fl = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g_fl.status_code == 200
        d_fl = g_fl.json()
        assert d_fl["data"]["mattina"] == "100", d_fl
        assert d_fl["data"]["vers"] == "5", d_fl
        assert d_fl["vers_color"] == "red", d_fl

        # GET as Admin scoped to Grazie - must NOT see 100/5/red
        g_gr = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, grazie_id),
            timeout=TIMEOUT,
        )
        assert g_gr.status_code == 200
        d_gr = g_gr.json()
        assert d_gr["data"]["mattina"] == "200", d_gr
        assert d_gr["data"]["vers"] == "", d_gr  # Grazie did not set vers
        assert d_gr["vers_color"] == "", d_gr

    def test_non_admin_cannot_impersonate(self, flaminio_session, grazie_session):
        """Flaminio sending X-Restaurant-Id=grazie_id must still operate on its own."""
        # Flaminio writes a normal field while trying to spoof Grazie via header.
        # `mattina` is protected server-side and cannot be forced by non-admin users.
        r = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(flaminio_session["token"], grazie_session["id"]),
            json={"altro": "777", "mattina": "777"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

        # GET as Flaminio (own scope) -> normal field changed on his own row, mattina stayed protected.
        g_self = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(flaminio_session["token"]),
            timeout=TIMEOUT,
        )
        assert g_self.status_code == 200
        self_data = g_self.json()["data"]
        assert self_data["altro"] == "777"
        assert self_data["mattina"] == "100"

        # GET as Grazie -> must NOT have Flaminio's write.
        g_gr = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(grazie_session["token"]),
            timeout=TIMEOUT,
        )
        assert g_gr.status_code == 200
        grazie_data = g_gr.json()["data"]
        assert grazie_data["mattina"] == "200"
        assert grazie_data["altro"] != "777"

    def test_prev_cash_sera_carry_over(
        self, admin_token, flaminio_session
    ):
        """Insert yesterday doc with vers=50 -> today's GET must return prev_cash_sera numeric."""
        flaminio_id = flaminio_session["id"]
        yest = _yesterday_str()
        # Seed yesterday row using pymongo (sync, avoid asyncio loop issues)
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        try:
            sync_db = sync_client[DB_NAME]
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": yest,
                    "mattina": "0",
                    "vers": "50",
                    "vers_color": "",
                    "_test_marker": True,
                }
            )
        finally:
            sync_client.close()

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200
        body = g.json()
        # prev_cash_sera should be a number (possibly 0/negative depending on formula, but key must exist)
        assert "prev_cash_sera" in body
        assert isinstance(body["prev_cash_sera"], (int, float))
        # Today's row should not have inherited yesterday's vers value
        assert body["data"]["vers"] != "50" or body["date"] == yest

    def test_cash_daily_materializes_morning_and_residual_cassetto(
        self, admin_token, flaminio_session
    ):
        """New report day must inherit cash morning and cassetto residual from yesterday."""
        flaminio_id = flaminio_session["id"]
        today = _today_str()
        yest = _yesterday_str()
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        try:
            sync_db = sync_client[DB_NAME]
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today}
            )
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": yest,
                    "mattina": "100",
                    "vers": "10",
                    "cd5": "12",
                    "sp5": "3",
                    "cd2": "8",
                    "sp2": "2",
                    "cd1": "6",
                    "sp1": "1",
                    "cd05": "5",
                    "sp05": "4",
                    "_test_marker": True,
                }
            )
        finally:
            sync_client.close()

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        body = g.json()
        assert body["prev_cash_sera"] == 445
        assert body["data"]["mattina"] == "445"
        assert body["data"]["cd5"] == "9"
        assert body["data"]["cd2"] == "6"
        assert body["data"]["cd1"] == "5"
        assert body["data"]["cd05"] == "1"

        sync_client = MongoClient(MONGO_URL)
        try:
            persisted = sync_client[DB_NAME].cash_daily_counts.find_one(
                {"restaurant_id": flaminio_id, "date_rome": today},
                {"_id": 0},
            )
        finally:
            sync_client.close()
        assert persisted["mattina"] == body["data"]["mattina"]
        assert persisted["cd5"] == "9"

    def test_cash_daily_reconciles_legacy_auto_morning_after_formula_fix(
        self, admin_token, flaminio_session
    ):
        """Existing automatic mattina from the legacy total must follow recalculated cash sera."""
        flaminio_id = flaminio_session["id"]
        today = _today_str()
        yest = _yesterday_str()
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        try:
            sync_db = sync_client[DB_NAME]
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today}
            )
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.beverage_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.cash_audit_log.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today, "_test_marker": True}
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": yest,
                    "mattina": "100",
                    "paste_text": "1 CARB\n2 X UNKNOWN",
                    "manual_prices": {"2 X UNKNOWN": "395"},
                    "_test_marker": True,
                }
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": today,
                    "mattina": "108",
                    "_test_marker": True,
                }
            )
        finally:
            sync_client.close()

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        body = g.json()
        assert body["prev_cash_sera"] == 503
        assert body["data"]["mattina"] == "503"

        sync_client = MongoClient(MONGO_URL)
        try:
            persisted = sync_client[DB_NAME].cash_daily_counts.find_one(
                {"restaurant_id": flaminio_id, "date_rome": today},
                {"_id": 0},
            )
        finally:
            sync_client.close()
        assert persisted["mattina"] == "503"
        assert persisted["mattina_auto_carry"] is True
        assert persisted["mattina_carry_from_date"] == yest

    def test_cash_daily_does_not_reconcile_manual_morning_audit(
        self, admin_token, flaminio_session
    ):
        """A mattina value with an explicit audit entry is treated as manual."""
        flaminio_id = flaminio_session["id"]
        today = _today_str()
        yest = _yesterday_str()
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        try:
            sync_db = sync_client[DB_NAME]
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today}
            )
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.beverage_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.cash_audit_log.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today, "_test_marker": True}
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": yest,
                    "mattina": "100",
                    "paste_text": "1 CARB\n2 X UNKNOWN",
                    "manual_prices": {"2 X UNKNOWN": "395"},
                    "_test_marker": True,
                }
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": today,
                    "mattina": "108",
                    "_test_marker": True,
                }
            )
            sync_db.cash_audit_log.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": today,
                    "category": "cash",
                    "field": "mattina",
                    "old_value": "",
                    "new_value": "108",
                    "_test_marker": True,
                }
            )
        finally:
            sync_client.close()

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        body = g.json()
        assert body["prev_cash_sera"] == 503
        assert body["data"]["mattina"] == "108"

    def test_cash_daily_does_not_rewrite_synced_auto_morning(
        self, admin_token, flaminio_session
    ):
        """Already synced automatic mattina should not change the row revision on read."""
        flaminio_id = flaminio_session["id"]
        today = _today_str()
        yest = _yesterday_str()
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        try:
            sync_db = sync_client[DB_NAME]
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today}
            )
            sync_db.cash_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.beverage_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest}
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": yest,
                    "mattina": "100",
                    "paste_text": "1 CARB\n2 X UNKNOWN",
                    "manual_prices": {"2 X UNKNOWN": "395"},
                    "_test_marker": True,
                }
            )
            sync_db.cash_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": today,
                    "mattina": "503",
                    "mattina_auto_carry": True,
                    "mattina_carry_from_date": yest,
                    "mattina_carry_value": "503",
                    "updated_at": "keep-this-revision",
                    "_test_marker": True,
                }
            )
        finally:
            sync_client.close()

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        body = g.json()
        assert body["prev_cash_sera"] == 503
        assert body["data"]["mattina"] == "503"

        sync_client = MongoClient(MONGO_URL)
        try:
            persisted = sync_client[DB_NAME].cash_daily_counts.find_one(
                {"restaurant_id": flaminio_id, "date_rome": today},
                {"_id": 0},
            )
        finally:
            sync_client.close()
        assert persisted["updated_at"] == "keep-this-revision"

    def test_cash_daily_partial_patch_preserves_other_fields(
        self, admin_token, flaminio_session
    ):
        """PUT /cash/daily with one field must not blank the rest of the report."""
        flaminio_id = flaminio_session["id"]
        r1 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"mattina": "100", "vers": "25", "bp": "10"},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        revision = r1.json()["revision"]

        r2 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"bp": "12", "revision": revision},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        data = g.json()["data"]
        assert data["mattina"] == "100"
        assert data["vers"] == "25"
        assert data["bp"] == "12"

    def test_cash_daily_accepts_stale_partial_patch_without_blanket_overwrite(
        self, admin_token, flaminio_session
    ):
        """Old tabs can still save a partial patch; unrelated newer fields must survive."""
        flaminio_id = flaminio_session["id"]
        r1 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"altro": "1"},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        stale_revision = r1.json()["revision"]

        r2 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"altro": "2", "revision": stale_revision},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text

        r3 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"bp": "99", "revision": stale_revision},
            timeout=TIMEOUT,
        )
        assert r3.status_code == 200, r3.text

        g = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        data = g.json()["data"]
        assert data["altro"] == "2"
        assert data["bp"] == "99"

    def test_cash_daily_paste_manual_override_roundtrip(
        self, admin_token, flaminio_session
    ):
        """Manual paste lock is persisted, and unlocking can replace text with live paste text."""
        flaminio_id = flaminio_session["id"]
        r1 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"paste_manual_override": True, "paste_text": "MANUAL CARB"},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        revision = r1.json()["revision"]

        g1 = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g1.status_code == 200, g1.text
        body1 = g1.json()
        assert body1["paste_manual_override"] is True
        assert body1["paste_text"] == "MANUAL CARB"

        r2 = requests.put(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={
                "paste_manual_override": False,
                "paste_text": "1 CARB\n2 AMAT",
                "revision": revision,
            },
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text

        g2 = requests.get(
            f"{BASE_URL}/api/cash/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g2.status_code == 200, g2.text
        body2 = g2.json()
        assert body2["paste_manual_override"] is False
        assert body2["paste_text"] == "1 CARB\n2 AMAT"


# ============ BEVERAGES DAILY ============
class TestBeveragesDailyMultiTenancy:
    def test_admin_put_isolation(
        self, admin_token, flaminio_session, grazie_session
    ):
        flaminio_id = flaminio_session["id"]
        grazie_id = grazie_session["id"]

        # Catalog uses 'CZ' (Coca Cola Zero) — request mentions CCZ but server validates against BEVERAGES_CATALOG
        SIGLA = "CZ"
        r1 = requests.put(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"sigla": SIGLA, "mattina": "10", "sera": "5"},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text

        r2 = requests.put(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, grazie_id),
            json={"sigla": SIGLA, "mattina": "20", "sera": "7"},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text

        g_fl = requests.get(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        ).json()
        assert g_fl["counts"][SIGLA]["mattina"] == "10"
        assert g_fl["counts"][SIGLA]["sera"] == "5"

        g_gr = requests.get(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, grazie_id),
            timeout=TIMEOUT,
        ).json()
        assert g_gr["counts"][SIGLA]["mattina"] == "20"
        assert g_gr["counts"][SIGLA]["sera"] == "7"

    def test_history_isolated_by_restaurant(
        self, admin_token, flaminio_session, grazie_session
    ):
        flaminio_id = flaminio_session["id"]
        grazie_id = grazie_session["id"]

        h_fl = requests.get(
            f"{BASE_URL}/api/beverages/daily/history?days=7",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert h_fl.status_code == 200, h_fl.text
        fl_days = h_fl.json().get("days", [])

        h_gr = requests.get(
            f"{BASE_URL}/api/beverages/daily/history?days=7",
            headers=_hdr(admin_token, grazie_id),
            timeout=TIMEOUT,
        )
        assert h_gr.status_code == 200, h_gr.text
        gr_days = h_gr.json().get("days", [])

        # Find today's record on both sides
        today = _today_str()
        fl_today = next((d for d in fl_days if d["date"] == today), None)
        gr_today = next((d for d in gr_days if d["date"] == today), None)
        assert fl_today is not None, f"Flaminio today missing in history: {fl_days}"
        assert gr_today is not None, f"Grazie today missing in history: {gr_days}"
        # The row sets must NOT cross-contaminate (mattina values differ)
        fl_ccz = next((r for r in fl_today["rows"] if r["sigla"] == "CZ"), None)
        gr_ccz = next((r for r in gr_today["rows"] if r["sigla"] == "CZ"), None)
        assert fl_ccz and fl_ccz.get("mattina") == "10"
        assert gr_ccz and gr_ccz.get("mattina") == "20"

    def test_beverage_daily_materializes_morning_from_previous_sera(
        self, admin_token, flaminio_session
    ):
        """New report day must persist beverage mattina from yesterday sera."""
        flaminio_id = flaminio_session["id"]
        today = _today_str()
        yest = _yesterday_str()
        SIGLA = "CZ"
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        try:
            sync_db = sync_client[DB_NAME]
            sync_db.beverage_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": today, "sigla": SIGLA}
            )
            sync_db.beverage_daily_counts.delete_many(
                {"restaurant_id": flaminio_id, "date_rome": yest, "sigla": SIGLA}
            )
            sync_db.beverage_daily_counts.insert_one(
                {
                    "restaurant_id": flaminio_id,
                    "date_rome": yest,
                    "sigla": SIGLA,
                    "mattina": "70",
                    "sera": "52",
                    "_test_marker": True,
                }
            )
        finally:
            sync_client.close()

        g = requests.get(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        row = g.json()["counts"][SIGLA]
        assert row["mattina"] == "52"
        assert row["mattina_casse"] == "2"
        assert row["mattina_sfuse"] == "4"

        sync_client = MongoClient(MONGO_URL)
        try:
            persisted = sync_client[DB_NAME].beverage_daily_counts.find_one(
                {"restaurant_id": flaminio_id, "date_rome": today, "sigla": SIGLA},
                {"_id": 0},
            )
        finally:
            sync_client.close()
        assert persisted["mattina"] == "52"
        assert persisted["mattina_casse"] == "2"
        assert persisted["mattina_sfuse"] == "4"

    def test_beverage_daily_partial_patch_preserves_other_fields(
        self, admin_token, flaminio_session
    ):
        """PUT /beverages/daily with one field must not blank the beverage row."""
        flaminio_id = flaminio_session["id"]
        SIGLA = "CZ"
        r1 = requests.put(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"sigla": SIGLA, "mattina": "20", "inUsc": "5", "sera": "7"},
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        revision = r1.json()["revision"]

        r2 = requests.put(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, flaminio_id),
            json={"sigla": SIGLA, "scarti": "1", "revision": revision},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text

        g = requests.get(
            f"{BASE_URL}/api/beverages/daily",
            headers=_hdr(admin_token, flaminio_id),
            timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        row = g.json()["counts"][SIGLA]
        assert row["mattina"] == "20"
        assert row["inUsc"] == "5"
        assert row["sera"] == "7"
        assert row["scarti"] == "1"


# ============ CLOSURES (Admin only) ============
class TestClosures:
    def test_closures_admin_only(self, flaminio_session):
        r = requests.get(
            f"{BASE_URL}/api/admin/closures",
            headers=_hdr(flaminio_session["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403, f"Non-admin should be 403, got {r.status_code}"

    def test_closures_admin_ok(self, admin_token, flaminio_session):
        r = requests.get(
            f"{BASE_URL}/api/admin/closures?days=30&restaurant_id={flaminio_session['id']}",
            headers=_hdr(admin_token),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Endpoint should return a dict with closures/items - just assert it's a dict
        assert isinstance(body, dict)
