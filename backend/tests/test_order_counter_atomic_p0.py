"""
P0 Bug Fix Tests (iteration 6): atomic counter via aggregation pipeline + concurrency safety.

Covers:
  - POST /api/orders WITHOUT order_number: counter +1, order has counter+1
  - POST /api/orders WITH order_number=N (higher than counter): counter jumps to N
  - POST /api/orders WITH order_number=N (lower than counter): counter +1 (NOT N) - KEY FIX
  - Concurrent POSTs (10 parallel): all order_numbers UNIQUE
  - Concurrent POSTs all with same order_number=100: all receive different numbers
  - GET /api/orders/next-number returns counter+1
  - UNIQUE index (restaurant_id, order_number): direct duplicate insert -> DuplicateKeyError
"""
import os
import sys
import asyncio
from pathlib import Path

import pytest
import requests

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
USERNAME = "Flaminio"
PASSWORD = os.environ.get("PASTA_TEST_PASSWORD", "")


# ---------- helpers ----------
def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["restaurant"]["id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _create_order(token, desc="TEST_atom", order_number=None):
    payload = {"description": desc}
    if order_number is not None:
        payload["order_number"] = order_number
    r = requests.post(
        f"{BASE_URL}/api/orders", json=payload, headers=_h(token), timeout=15
    )
    return r


def _delete_order(token, order_id):
    return requests.delete(
        f"{BASE_URL}/api/orders/{order_id}", headers=_h(token), timeout=15
    )


def _get_counter(restaurant_id):
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    try:
        d = c[db_name].restaurants.find_one(
            {"id": restaurant_id}, {"_id": 0, "order_counter": 1}
        )
        return (d or {}).get("order_counter", 0)
    finally:
        c.close()


def _cleanup(restaurant_id, token):
    """Delete every order for this restaurant + reset counter to 0."""
    r = requests.get(
        f"{BASE_URL}/api/orders",
        params={"status": "all"},
        headers=_h(token),
        timeout=15,
    )
    if r.status_code == 200:
        for o in r.json():
            requests.delete(
                f"{BASE_URL}/api/orders/{o['id']}", headers=_h(token), timeout=15
            )
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    try:
        d = c[db_name]
        d.deletion_logs.delete_many({"restaurant_id": restaurant_id})
        d.archived_orders.delete_many({"restaurant_id": restaurant_id})
        d.orders.delete_many({"restaurant_id": restaurant_id})
        d.restaurants.update_one(
            {"id": restaurant_id}, {"$set": {"order_counter": 0}}
        )
    finally:
        c.close()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def auth():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    token, rid = _login()
    return {"token": token, "restaurant_id": rid}


@pytest.fixture(autouse=True)
def isolate(auth):
    _cleanup(auth["restaurant_id"], auth["token"])
    yield
    _cleanup(auth["restaurant_id"], auth["token"])


# ---------- tests ----------
class TestAtomicCounter:
    def test_post_without_order_number_increments_by_one(self, auth):
        token = auth["token"]
        rid = auth["restaurant_id"]
        r = _create_order(token, "TEST_no_num_1")
        assert r.status_code == 200, r.text
        assert r.json()["order_number"] == 1
        assert _get_counter(rid) == 1
        r2 = _create_order(token, "TEST_no_num_2")
        assert r2.json()["order_number"] == 2
        assert _get_counter(rid) == 2

    def test_post_with_higher_order_number_jumps_counter(self, auth):
        """counter=2, requested=50 -> order #50, counter=50."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        _create_order(token, "TEST_h_1")
        _create_order(token, "TEST_h_2")
        assert _get_counter(rid) == 2

        r = _create_order(token, "TEST_h_jump", order_number=50)
        assert r.status_code == 200, r.text
        assert r.json()["order_number"] == 50, (
            f"expected jump to 50, got {r.json()['order_number']}"
        )
        assert _get_counter(rid) == 50

    def test_post_with_active_lower_order_number_is_rejected(self, auth):
        """An explicitly requested active number must never be silently remapped."""
        token = auth["token"]
        rid = auth["restaurant_id"]
        for i in range(10):
            _create_order(token, f"TEST_lo_{i}")
        assert _get_counter(rid) == 10

        r = _create_order(token, "TEST_lo_replay", order_number=5)
        assert r.status_code == 409, r.text
        assert _get_counter(rid) == 10

    def test_post_with_active_equal_order_number_is_rejected(self, auth):
        token = auth["token"]
        rid = auth["restaurant_id"]
        for i in range(5):
            _create_order(token, f"TEST_eq_{i}")
        assert _get_counter(rid) == 5

        r = _create_order(token, "TEST_eq_replay", order_number=5)
        assert r.status_code == 409, r.text
        assert _get_counter(rid) == 5


class TestConcurrency:
    def test_10_parallel_posts_all_unique(self, auth):
        token = auth["token"]
        rid = auth["restaurant_id"]

        async def _post_one(i):
            return await asyncio.to_thread(
                _create_order, token, f"TEST_par_{i}"
            )

        async def _runner():
            tasks = [_post_one(i) for i in range(10)]
            return await asyncio.gather(*tasks)

        responses = asyncio.run(_runner())
        for r in responses:
            assert r.status_code == 200, r.text
        numbers = [r.json()["order_number"] for r in responses]
        assert len(set(numbers)) == 10, (
            f"DUPLICATE BUG: parallel POSTs produced duplicates: {sorted(numbers)}"
        )
        assert sorted(numbers) == list(range(1, 11))
        assert _get_counter(rid) == 10

    def test_10_parallel_posts_same_explicit_number_allow_one_winner(self, auth):
        """Only one request may claim the same explicit active number."""
        token = auth["token"]
        rid = auth["restaurant_id"]

        async def _post_one(i):
            return await asyncio.to_thread(
                _create_order, token, f"TEST_par_eq_{i}", 100
            )

        async def _runner():
            tasks = [_post_one(i) for i in range(10)]
            return await asyncio.gather(*tasks)

        responses = asyncio.run(_runner())
        successes = [response for response in responses if response.status_code == 200]
        conflicts = [response for response in responses if response.status_code == 409]
        assert len(successes) == 1
        assert len(conflicts) == 9
        assert successes[0].json()["order_number"] == 100
        assert _get_counter(rid) == 100


class TestNextNumberEndpoint:
    def test_next_number_initial(self, auth):
        token = auth["token"]
        r = requests.get(
            f"{BASE_URL}/api/orders/next-number",
            headers=_h(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"next_number": 1}

    def test_next_number_after_creates(self, auth):
        token = auth["token"]
        for i in range(3):
            _create_order(token, f"TEST_nn_{i}")
        r = requests.get(
            f"{BASE_URL}/api/orders/next-number",
            headers=_h(token),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == {"next_number": 4}

    def test_next_number_unauthenticated(self, auth):
        r = requests.get(f"{BASE_URL}/api/orders/next-number", timeout=15)
        assert r.status_code in (401, 403), (
            f"expected auth error, got {r.status_code}"
        )


class TestUniqueIndex:
    def test_unique_index_exists(self, auth):
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        c = MongoClient(mongo_url)
        try:
            idx = c[db_name].orders.index_information()
        finally:
            c.close()
        # Find an index that is unique and covers (restaurant_id, order_number)
        match = None
        for name, info in idx.items():
            keys = info.get("key", [])
            if (
                info.get("unique")
                and len(keys) == 2
                and keys[0][0] == "restaurant_id"
                and keys[1][0] == "order_number"
            ):
                match = name
                break
        assert match is not None, (
            f"unique (restaurant_id, order_number) index not found. "
            f"Indexes: {list(idx.keys())}"
        )

    def test_direct_duplicate_insert_raises(self, auth):
        """Insert directly to bypass app logic. Must hit DuplicateKeyError."""
        from pymongo import MongoClient
        from pymongo.errors import DuplicateKeyError

        rid = auth["restaurant_id"]
        token = auth["token"]
        r = _create_order(token, "TEST_uniq_seed")
        assert r.status_code == 200
        order_number = r.json()["order_number"]

        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        c = MongoClient(mongo_url)
        try:
            d = c[db_name]
            duplicate_doc = {
                "id": "TEST_dup_uuid",
                "order_number": order_number,
                "description": "TEST_dup_direct",
                "restaurant_id": rid,
                "status": "pending",
                "created_at": "2026-01-01T00:00:00+00:00",
                "timer_started": False,
                "timer_start_time": None,
                "timer_paused": False,
                "timer_elapsed": 0,
                "kitchen_completed": False,
                "monitor_visible": False,
                "hidden_generale": False,
            }
            with pytest.raises(DuplicateKeyError):
                d.orders.insert_one(duplicate_doc)
        finally:
            c.close()


class TestRegressionDeleteAndDefault:
    def test_delete_does_not_lower_counter(self, auth):
        token = auth["token"]
        rid = auth["restaurant_id"]
        orders = [_create_order(token, f"TEST_del_{i}").json() for i in range(5)]
        assert _get_counter(rid) == 5
        _delete_order(token, orders[-1]["id"])
        assert _get_counter(rid) == 5

    def test_get_orders_default_pending(self, auth):
        token = auth["token"]
        _create_order(token, "TEST_gp_1")
        _create_order(token, "TEST_gp_2")
        r = requests.get(
            f"{BASE_URL}/api/orders", headers=_h(token), timeout=15
        )
        assert r.status_code == 200
        data = r.json()
        assert all(o["status"] == "pending" for o in data)
        assert len(data) >= 2
