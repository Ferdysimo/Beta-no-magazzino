"""
Backend tests for Carichi Magazzino (warehouse incoming goods).
Covers: POST/GET/PUT/DELETE /api/carichi, stock delta math, photo storage,
RBAC, concurrent increments, real_quantity integration.
"""
import asyncio
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    pytest.skip("live backend not configured", allow_module_level=True)

PASSWORD = os.environ.get("PASTA_TEST_PASSWORD", "")
if not PASSWORD:
    pytest.skip("PASTA_TEST_PASSWORD not set", allow_module_level=True)
# Tiny 1x1 transparent PNG
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen"
    "LSwAAAABJRU5ErkJggg=="
)


# -------------------- Fixtures --------------------

def _login(username: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login {username} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "Admin": _login("Admin"),
        "Magazziniere": _login("Magazziniere"),
        "Flaminio": _login("Flaminio"),
    }


@pytest.fixture(scope="module")
def test_products(tokens):
    """Create 2 dedicated test products with TEST_ prefix and known suppliers."""
    supplier = "TEST_Supplier_Carico"
    created = []
    for name in ("TEST_Carico_Prod_A", "TEST_Carico_Prod_B"):
        r = requests.post(
            f"{BASE_URL}/api/products",
            headers=_h(tokens["Admin"]),
            json={
                "name": name,
                "unit": "kg",
                "supplier": supplier,
                "quantity": 0,
                "image_data": "",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        created.append(r.json())
    yield {"supplier": supplier, "products": created}
    # Teardown
    for p in created:
        requests.delete(
            f"{BASE_URL}/api/products/{p['id']}",
            headers=_h(tokens["Admin"]),
            timeout=10,
        )


def _get_product_qty(token: str, pid: str) -> int:
    r = requests.get(
        f"{BASE_URL}/api/warehouse/products",
        headers=_h(token),
        timeout=15,
    )
    assert r.status_code == 200
    for p in r.json():
        if p["id"] == pid:
            return int(p["quantity"])
    raise AssertionError(f"Product {pid} not found")


# -------------------- POST /api/carichi validation --------------------

class TestCaricoCreateValidation:
    def test_post_requires_magazzino_role(self, tokens, test_products):
        p = test_products["products"][0]
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Flaminio"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-TEST-1",
                "photo_data": TINY_PNG,
                "items": [{
                    "product_id": p["id"], "product_name": p["name"],
                    "unit": "kg", "quantity_added": 5,
                }],
            },
            timeout=15,
        )
        assert r.status_code == 403

    def test_post_rejects_empty_photo(self, tokens, test_products):
        p = test_products["products"][0]
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-TEST-2",
                "photo_data": "",
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 5}],
            },
            timeout=15,
        )
        assert r.status_code == 400

    def test_post_rejects_empty_items(self, tokens, test_products):
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-TEST-3",
                "photo_data": TINY_PNG,
                "items": [],
            },
            timeout=15,
        )
        assert r.status_code == 400

    def test_post_rejects_all_zero_qty(self, tokens, test_products):
        p = test_products["products"][0]
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-TEST-4",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 0}],
            },
            timeout=15,
        )
        assert r.status_code == 400

    def test_post_rejects_missing_supplier(self, tokens, test_products):
        p = test_products["products"][0]
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": "",
                "ddt_number_fornitore": "DDT-TEST-5",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 3}],
            },
            timeout=15,
        )
        assert r.status_code == 400


# -------------------- POST success + stock increment --------------------

class TestCaricoCreateSuccess:
    def test_create_increments_stock_and_returns_photo_url(self, tokens, test_products):
        p = test_products["products"][0]
        before = _get_product_qty(tokens["Magazziniere"], p["id"])
        body = {
            "supplier_name": test_products["supplier"],
            "ddt_number_fornitore": "DDT-TEST-CREATE",
            "photo_data": TINY_PNG,
            "items": [{"product_id": p["id"], "product_name": p["name"],
                       "unit": "kg", "quantity_added": 25}],
        }
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json=body, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] and data["supplier_name"] == test_products["supplier"]
        assert data["ddt_number_fornitore"] == "DDT-TEST-CREATE"
        assert data["photo_url"].startswith("/api/uploads/")
        assert "_id" not in data

        after = _get_product_qty(tokens["Magazziniere"], p["id"])
        assert after == before + 25, f"Expected {before+25}, got {after}"

        # cleanup
        requests.delete(
            f"{BASE_URL}/api/carichi/{data['id']}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )


# -------------------- GET list/filter/single --------------------

class TestCaricoGet:
    def test_list_requires_role(self, tokens):
        r = requests.get(f"{BASE_URL}/api/carichi", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 403

    def test_list_and_filter_by_supplier(self, tokens, test_products):
        p = test_products["products"][0]
        carichi_ids = []
        # create 2 carichi for this supplier
        for i in range(2):
            r = requests.post(
                f"{BASE_URL}/api/carichi",
                headers=_h(tokens["Magazziniere"]),
                json={
                    "supplier_name": test_products["supplier"],
                    "ddt_number_fornitore": f"DDT-LIST-{i}",
                    "photo_data": TINY_PNG,
                    "items": [{"product_id": p["id"], "product_name": p["name"],
                               "unit": "kg", "quantity_added": 1}],
                }, timeout=15,
            )
            assert r.status_code == 200
            carichi_ids.append(r.json()["id"])

        # list all
        r = requests.get(f"{BASE_URL}/api/carichi", headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 200
        rows = r.json()
        ids = [x["id"] for x in rows]
        assert carichi_ids[0] in ids and carichi_ids[1] in ids
        # desc by date: our 2nd created should appear before the 1st
        idx0 = ids.index(carichi_ids[0])
        idx1 = ids.index(carichi_ids[1])
        assert idx1 < idx0, "Expected desc sort by created_at"
        assert all(r.get("photo_url", "").startswith("/api/uploads/") for r in rows if r["id"] in carichi_ids)

        # filter by supplier
        r = requests.get(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            params={"supplier": test_products["supplier"]},
        )
        assert r.status_code == 200
        filtered = r.json()
        assert all(c["supplier_name"] == test_products["supplier"] for c in filtered)
        assert set(carichi_ids).issubset({c["id"] for c in filtered})

        # get single
        r = requests.get(
            f"{BASE_URL}/api/carichi/{carichi_ids[0]}",
            headers=_h(tokens["Magazziniere"]),
        )
        assert r.status_code == 200
        one = r.json()
        assert one["id"] == carichi_ids[0]
        assert one["photo_url"].startswith("/api/uploads/")

        # 404
        r = requests.get(
            f"{BASE_URL}/api/carichi/{uuid.uuid4()}",
            headers=_h(tokens["Magazziniere"]),
        )
        assert r.status_code == 404

        # cleanup
        for cid in carichi_ids:
            requests.delete(
                f"{BASE_URL}/api/carichi/{cid}",
                headers=_h(tokens["Magazziniere"]), timeout=10,
            )


# -------------------- PUT delta math --------------------

class TestCaricoUpdate:
    def test_edit_qty_applies_delta_not_full_readd(self, tokens, test_products):
        """Create carico +100; edit to +50; final stock should be initial+50."""
        p = test_products["products"][0]
        initial = _get_product_qty(tokens["Magazziniere"], p["id"])

        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-DELTA-1",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 100}],
            }, timeout=15,
        )
        assert r.status_code == 200
        cid = r.json()["id"]
        after_create = _get_product_qty(tokens["Magazziniere"], p["id"])
        assert after_create == initial + 100

        # edit to 50
        r = requests.put(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]),
            json={
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 50}],
            }, timeout=15,
        )
        assert r.status_code == 200, r.text
        after_edit = _get_product_qty(tokens["Magazziniere"], p["id"])
        assert after_edit == initial + 50, f"Expected {initial+50}, got {after_edit}"

        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )
        final = _get_product_qty(tokens["Magazziniere"], p["id"])
        assert final == initial

    def test_edit_remove_item_rolls_back(self, tokens, test_products):
        p1, p2 = test_products["products"][0], test_products["products"][1]
        init1 = _get_product_qty(tokens["Magazziniere"], p1["id"])
        init2 = _get_product_qty(tokens["Magazziniere"], p2["id"])

        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-REMOVE",
                "photo_data": TINY_PNG,
                "items": [
                    {"product_id": p1["id"], "product_name": p1["name"],
                     "unit": "kg", "quantity_added": 10},
                    {"product_id": p2["id"], "product_name": p2["name"],
                     "unit": "kg", "quantity_added": 20},
                ],
            }, timeout=15,
        )
        assert r.status_code == 200
        cid = r.json()["id"]
        assert _get_product_qty(tokens["Magazziniere"], p1["id"]) == init1 + 10
        assert _get_product_qty(tokens["Magazziniere"], p2["id"]) == init2 + 20

        # remove p2
        r = requests.put(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]),
            json={
                "items": [
                    {"product_id": p1["id"], "product_name": p1["name"],
                     "unit": "kg", "quantity_added": 10},
                ],
            }, timeout=15,
        )
        assert r.status_code == 200
        assert _get_product_qty(tokens["Magazziniere"], p1["id"]) == init1 + 10
        assert _get_product_qty(tokens["Magazziniere"], p2["id"]) == init2

        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )
        assert _get_product_qty(tokens["Magazziniere"], p1["id"]) == init1

    def test_edit_add_new_item_increments(self, tokens, test_products):
        p1, p2 = test_products["products"][0], test_products["products"][1]
        init1 = _get_product_qty(tokens["Magazziniere"], p1["id"])
        init2 = _get_product_qty(tokens["Magazziniere"], p2["id"])

        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-ADD",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p1["id"], "product_name": p1["name"],
                           "unit": "kg", "quantity_added": 5}],
            }, timeout=15,
        )
        cid = r.json()["id"]
        r = requests.put(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]),
            json={
                "items": [
                    {"product_id": p1["id"], "product_name": p1["name"],
                     "unit": "kg", "quantity_added": 5},
                    {"product_id": p2["id"], "product_name": p2["name"],
                     "unit": "kg", "quantity_added": 7},
                ],
            }, timeout=15,
        )
        assert r.status_code == 200
        assert _get_product_qty(tokens["Magazziniere"], p1["id"]) == init1 + 5
        assert _get_product_qty(tokens["Magazziniere"], p2["id"]) == init2 + 7

        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )

    def test_edit_photo_replaces_file(self, tokens, test_products):
        p = test_products["products"][0]
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-PHOTO",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 1}],
            }, timeout=15,
        )
        cid = r.json()["id"]
        old_url = r.json()["photo_url"]

        r = requests.put(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]),
            json={"photo_data": TINY_PNG},
            timeout=15,
        )
        assert r.status_code == 200
        new_url = r.json()["photo_url"]
        assert new_url.startswith("/api/uploads/")
        assert new_url != old_url

        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )

    def test_edit_ddt_only_no_stock_change(self, tokens, test_products):
        p = test_products["products"][0]
        init = _get_product_qty(tokens["Magazziniere"], p["id"])
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-OLD",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 4}],
            }, timeout=15,
        )
        cid = r.json()["id"]
        assert _get_product_qty(tokens["Magazziniere"], p["id"]) == init + 4

        r = requests.put(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]),
            json={"ddt_number_fornitore": "DDT-NEW"}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["ddt_number_fornitore"] == "DDT-NEW"
        assert _get_product_qty(tokens["Magazziniere"], p["id"]) == init + 4

        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )


# -------------------- DELETE rollback --------------------

class TestCaricoDelete:
    def test_delete_rolls_back_all_stock(self, tokens, test_products):
        p1, p2 = test_products["products"][0], test_products["products"][1]
        init1 = _get_product_qty(tokens["Magazziniere"], p1["id"])
        init2 = _get_product_qty(tokens["Magazziniere"], p2["id"])

        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-DEL",
                "photo_data": TINY_PNG,
                "items": [
                    {"product_id": p1["id"], "product_name": p1["name"],
                     "unit": "kg", "quantity_added": 33},
                    {"product_id": p2["id"], "product_name": p2["name"],
                     "unit": "kg", "quantity_added": 44},
                ],
            }, timeout=15,
        )
        cid = r.json()["id"]
        assert _get_product_qty(tokens["Magazziniere"], p1["id"]) == init1 + 33
        assert _get_product_qty(tokens["Magazziniere"], p2["id"]) == init2 + 44

        r = requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )
        assert r.status_code == 200
        assert _get_product_qty(tokens["Magazziniere"], p1["id"]) == init1
        assert _get_product_qty(tokens["Magazziniere"], p2["id"]) == init2

        # second delete -> 404
        r = requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )
        assert r.status_code == 404

    def test_delete_requires_role(self, tokens, test_products):
        p = test_products["products"][0]
        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-RBAC-DEL",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 1}],
            }, timeout=15,
        )
        cid = r.json()["id"]
        r = requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Flaminio"]), timeout=10,
        )
        assert r.status_code == 403
        # cleanup
        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )


# -------------------- Concurrency --------------------

class TestCaricoConcurrency:
    def test_concurrent_posts_sum_correctly(self, tokens, test_products):
        import concurrent.futures
        p = test_products["products"][0]
        init = _get_product_qty(tokens["Magazziniere"], p["id"])

        def make(i):
            return requests.post(
                f"{BASE_URL}/api/carichi",
                headers=_h(tokens["Magazziniere"]),
                json={
                    "supplier_name": test_products["supplier"],
                    "ddt_number_fornitore": f"DDT-CONC-{i}",
                    "photo_data": TINY_PNG,
                    "items": [{"product_id": p["id"], "product_name": p["name"],
                               "unit": "kg", "quantity_added": 1}],
                }, timeout=30,
            )

        ids = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            futs = [ex.submit(make, i) for i in range(5)]
            for f in futs:
                r = f.result()
                assert r.status_code == 200
                ids.append(r.json()["id"])

        final = _get_product_qty(tokens["Magazziniere"], p["id"])
        assert final == init + 5, f"Expected {init+5}, got {final}"

        for cid in ids:
            requests.delete(
                f"{BASE_URL}/api/carichi/{cid}",
                headers=_h(tokens["Magazziniere"]), timeout=10,
            )
        assert _get_product_qty(tokens["Magazziniere"], p["id"]) == init


# -------------------- real_quantity integration --------------------

class TestCaricoRealQuantity:
    def test_real_quantity_reflects_carico_increase(self, tokens, test_products):
        p = test_products["products"][0]
        # Get real_quantity baseline
        r = requests.get(
            f"{BASE_URL}/api/warehouse/products",
            headers=_h(tokens["Flaminio"]), timeout=15,
        )
        assert r.status_code == 200
        before = next(x for x in r.json() if x["id"] == p["id"])
        before_real = int(before.get("real_quantity", before["quantity"]))

        r = requests.post(
            f"{BASE_URL}/api/carichi",
            headers=_h(tokens["Magazziniere"]),
            json={
                "supplier_name": test_products["supplier"],
                "ddt_number_fornitore": "DDT-REAL",
                "photo_data": TINY_PNG,
                "items": [{"product_id": p["id"], "product_name": p["name"],
                           "unit": "kg", "quantity_added": 60}],
            }, timeout=15,
        )
        cid = r.json()["id"]

        r = requests.get(
            f"{BASE_URL}/api/warehouse/products",
            headers=_h(tokens["Flaminio"]), timeout=15,
        )
        after = next(x for x in r.json() if x["id"] == p["id"])
        after_real = int(after.get("real_quantity", after["quantity"]))
        assert after_real == before_real + 60

        requests.delete(
            f"{BASE_URL}/api/carichi/{cid}",
            headers=_h(tokens["Magazziniere"]), timeout=10,
        )
