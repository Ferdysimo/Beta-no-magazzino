"""
P0 Bug Fix Tests: order_counter must NEVER decrement during the day.
Covers:
  - delete_order keeps counter at MAX(active, archived_today, deletion_logs_today)
  - Multiple consecutive deletes don't lower counter
  - New order after deletes uses next number (no reuse)
  - midnight_reset atomic archive + clear + counter=0
  - recover_stale_orders boots correctly archives yesterday orders
  - Regression: POST/GET /api/orders
"""
import os
import sys
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests

# Make backend importable for direct fn calls (midnight_reset, recover_stale_orders).
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
USERNAME = "Flaminio"
PASSWORD = os.environ.get("PASTA_TEST_PASSWORD", "")


# ---------- helpers ----------
def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": USERNAME, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["restaurant"]["id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _create_order(token, desc="TEST_p0"):
    r = requests.post(f"{BASE_URL}/api/orders", json={"description": desc},
                      headers=_h(token), timeout=15)
    assert r.status_code == 200, f"create order failed: {r.status_code} {r.text}"
    return r.json()


def _delete_order(token, order_id):
    r = requests.delete(f"{BASE_URL}/api/orders/{order_id}",
                        headers=_h(token), timeout=15)
    assert r.status_code == 200, f"delete failed: {r.status_code} {r.text}"


def _get_orders(token, status="pending"):
    r = requests.get(f"{BASE_URL}/api/orders", params={"status": status},
                     headers=_h(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _get_counter_via_db(restaurant_id):
    # Direct DB read (synchronous) to avoid creating short-lived motor clients
    # that bind to throw-away loops.
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    try:
        d = c[db_name].restaurants.find_one({"id": restaurant_id}, {"_id": 0, "order_counter": 1})
        return (d or {}).get("order_counter", 0)
    finally:
        c.close()


def _cleanup_restaurant(restaurant_id, token):
    """Delete all active TEST_ orders + scrub deletion_logs/archived_orders TEST_ rows
    and reset counter to 0. Used before each test to isolate."""
    # Delete via API only the active orders we know about (status=all)
    r = requests.get(f"{BASE_URL}/api/orders", params={"status": "all"},
                     headers=_h(token), timeout=15)
    if r.status_code == 200:
        for o in r.json():
            requests.delete(f"{BASE_URL}/api/orders/{o['id']}", headers=_h(token), timeout=15)

    # Direct DB scrub of deletion_logs / archived_orders for this restaurant + reset counter
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    try:
        d = c[db_name]
        d.deletion_logs.delete_many({"restaurant_id": restaurant_id})
        d.archived_orders.delete_many({"restaurant_id": restaurant_id})
        d.orders.delete_many({"restaurant_id": restaurant_id})
        d.restaurants.update_one({"id": restaurant_id}, {"$set": {"order_counter": 0}})
    finally:
        c.close()


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def event_loop():
    """Single session-wide loop so motor clients (in server module) stay alive."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def _run(coro, loop):
    return loop.run_until_complete(coro)


@pytest.fixture(scope="module")
def auth():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    token, rid = _login()
    return {"token": token, "restaurant_id": rid}


@pytest.fixture(autouse=True)
def isolate(auth):
    """Clean slate before every test."""
    _cleanup_restaurant(auth["restaurant_id"], auth["token"])
    yield
    _cleanup_restaurant(auth["restaurant_id"], auth["token"])


# ---------- regression tests ----------
class TestRegression:
    def test_post_order_increments_counter(self, auth):
        o1 = _create_order(auth["token"], "TEST_reg_1")
        o2 = _create_order(auth["token"], "TEST_reg_2")
        assert o1["order_number"] == 1
        assert o2["order_number"] == 2
        assert _get_counter_via_db(auth["restaurant_id"]) == 2

    def test_get_orders_default_pending(self, auth):
        _create_order(auth["token"], "TEST_get_1")
        _create_order(auth["token"], "TEST_get_2")
        orders = _get_orders(auth["token"])
        assert len(orders) == 2
        assert all(o["status"] == "pending" for o in orders)
        # sort desc by order_number
        assert orders[0]["order_number"] >= orders[-1]["order_number"]


# ---------- P0 bug fix tests ----------
class TestCounterNeverDecrements:
    def test_single_delete_keeps_counter(self, auth):
        """Create 5 orders, delete last, counter stays at 5."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        orders = [_create_order(token, f"TEST_single_{i}") for i in range(5)]
        assert _get_counter_via_db(rid) == 5
        _delete_order(token, orders[-1]["id"])
        assert _get_counter_via_db(rid) == 5, "counter dropped after single delete"

    def test_multiple_consecutive_deletes_keep_counter(self, auth):
        """Create 10 orders, delete 8/9/10, counter stays at 10."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        orders = [_create_order(token, f"TEST_multi_{i}") for i in range(10)]
        assert _get_counter_via_db(rid) == 10
        for o in orders[-3:]:
            _delete_order(token, o["id"])
        assert _get_counter_via_db(rid) == 10, "counter dropped after consecutive deletes"

    def test_create_after_delete_uses_next_number(self, auth):
        """Create 5, delete the 5th, new order must be #6 (no reuse of 5)."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        orders = [_create_order(token, f"TEST_reuse_{i}") for i in range(5)]
        assert orders[-1]["order_number"] == 5
        _delete_order(token, orders[-1]["id"])
        new_order = _create_order(token, "TEST_reuse_new")
        assert new_order["order_number"] == 6, (
            f"expected 6, got {new_order['order_number']} - reused number!"
        )
        assert _get_counter_via_db(rid) == 6

    def test_delete_all_then_create_continues(self, auth):
        """Edge: create 3, delete all 3, counter stays at 3, new order = 4."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        orders = [_create_order(token, f"TEST_all_{i}") for i in range(3)]
        for o in orders:
            _delete_order(token, o["id"])
        assert _get_counter_via_db(rid) == 3, "counter dropped when all active deleted"
        new_order = _create_order(token, "TEST_all_after")
        assert new_order["order_number"] == 4

    def test_archived_today_counted_in_max(self, auth, event_loop):
        """If archived_orders has higher today, counter must respect it."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        # create 2 orders, then move them to archived_orders manually (simulate prior partial archive
        # of today - this is the case that previously broke production)
        o1 = _create_order(token, "TEST_arch_1")
        o2 = _create_order(token, "TEST_arch_2")
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        c = MongoClient(mongo_url)
        try:
            d = c[db_name]
            doc2 = d.orders.find_one({"id": o2["id"]}, {"_id": 0})
            d.archived_orders.insert_one(doc2)
            d.orders.delete_one({"id": o2["id"]})
        finally:
            c.close()

        # Now delete o1 via API. Active orders are now empty, archived has #2.
        # _highest_order_number_today must consider archived → counter must remain >= 2.
        _delete_order(token, o1["id"])
        cnt = _get_counter_via_db(rid)
        assert cnt >= 2, f"counter dropped below archived order, got {cnt}"


# ---------- midnight_reset & recover_stale_orders ----------
class TestSchedulers:
    def test_midnight_reset_atomic(self, auth, event_loop):
        """Populate orders -> call midnight_reset -> archived has all, orders empty, counter=0."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        for i in range(4):
            _create_order(token, f"TEST_mid_{i}")
        from server import midnight_reset, db as srv_db

        async def _run():
            before_active = await srv_db.orders.count_documents({"restaurant_id": rid})
            await midnight_reset()
            after_active = await srv_db.orders.count_documents({"restaurant_id": rid})
            after_arch = await srv_db.archived_orders.count_documents({"restaurant_id": rid})
            rest = await srv_db.restaurants.find_one({"id": rid}, {"_id": 0, "order_counter": 1})
            return before_active, after_active, after_arch, rest["order_counter"]

        b, a, arch, cnt = event_loop.run_until_complete(_run())
        assert b == 4
        assert a == 0, "orders not cleared after midnight_reset"
        assert arch >= 4, "archived_orders missing entries"
        assert cnt == 0, "counter not reset to 0"

    def test_recover_stale_orders_archives_yesterday(self, auth, event_loop):
        """Insert an order with created_at = yesterday, call recover_stale_orders,
        verify it moved to archived_orders and removed from orders."""
        rid = auth["restaurant_id"]
        from server import recover_stale_orders, db as srv_db

        stale_id = str(uuid.uuid4())
        yesterday_utc = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        stale_doc = {
            "id": stale_id,
            "order_number": 99,
            "description": "TEST_stale_yesterday",
            "restaurant_id": rid,
            "status": "pending",
            "created_at": yesterday_utc,
            "timer_started": False,
            "timer_start_time": None,
            "timer_paused": False,
            "timer_elapsed": 0,
            "kitchen_completed": False,
            "monitor_visible": False,
            "hidden_generale": False,
        }
        fresh_id = str(uuid.uuid4())
        today_doc = {**stale_doc, "id": fresh_id, "order_number": 1,
                     "description": "TEST_fresh_today",
                     "created_at": datetime.now(timezone.utc).isoformat()}

        async def _run():
            await srv_db.orders.insert_one(stale_doc)
            await srv_db.orders.insert_one(today_doc)
            await recover_stale_orders()
            stale_in_orders = await srv_db.orders.find_one({"id": stale_id}, {"_id": 0})
            stale_in_arch = await srv_db.archived_orders.find_one({"id": stale_id}, {"_id": 0})
            fresh_in_orders = await srv_db.orders.find_one({"id": fresh_id}, {"_id": 0})
            return stale_in_orders, stale_in_arch, fresh_in_orders

        in_orders, in_arch, fresh = event_loop.run_until_complete(_run())
        assert in_orders is None, "stale order still in orders"
        assert in_arch is not None, "stale order not archived"
        assert fresh is not None, "today's order was wrongly archived"
