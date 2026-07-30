"""
Backend tests for Magazzino phase 2 — Richieste Merce / DDT flow.
Covers: warehouse products with real_quantity, create richiesta, list endpoints,
access control per role, evade (stock decrement), conferma, delete, and
PATCH product quantity.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    pytest.skip("live backend not configured", allow_module_level=True)

PASSWORD = os.environ.get("PASTA_TEST_PASSWORD", "")
if not PASSWORD:
    pytest.skip("PASTA_TEST_PASSWORD not set", allow_module_level=True)
USERS = ["Admin", "Flaminio", "Grazie", "Brazza", "Magazziniere"]


def _login(username: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def tokens():
    return {u: _login(u) for u in USERS}


@pytest.fixture(scope="module", autouse=True)
def test_product(tokens):
    response = requests.post(
        f"{BASE_URL}/api/products",
        headers={"Authorization": f"Bearer {tokens['Admin']}"},
        json={
            "name": "TEST_Richieste_Prodotto",
            "unit": "pz",
            "supplier": "TEST_Richieste_Fornitore",
            "quantity": 100,
            "image_data": "",
        },
    )
    assert response.status_code == 200, response.text
    product_id = response.json()["id"]
    yield response.json()
    requests.delete(
        f"{BASE_URL}/api/products/{product_id}",
        headers={"Authorization": f"Bearer {tokens['Admin']}"},
    )


def _h(token: str, admin_rest_id: str = None):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if admin_rest_id:
        h["X-Admin-Restaurant-Id"] = admin_rest_id
    return h


@pytest.fixture(scope="module")
def restaurants(tokens):
    r = requests.get(f"{BASE_URL}/api/admin/restaurants", headers=_h(tokens["Admin"]))
    assert r.status_code == 200
    rows = r.json()
    # Map location -> id
    m = {}
    for it in rows:
        m[it.get("location", "")] = it.get("id")
        m[it.get("name", "")] = it.get("id")
    return m


# ---------- Warehouse products ----------

class TestWarehouseProducts:
    def test_get_warehouse_products_has_quantity_and_real_quantity(self, tokens):
        r = requests.get(f"{BASE_URL}/api/warehouse/products", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 200
        products = r.json()
        assert isinstance(products, list)
        assert len(products) >= 1
        for p in products:
            assert "id" in p and "name" in p and "unit" in p
            assert "quantity" in p and isinstance(p["quantity"], int)
            assert "real_quantity" in p and isinstance(p["real_quantity"], int)
            assert p["real_quantity"] <= p["quantity"]

    def test_patch_product_quantity_forbidden_for_locale(self, tokens):
        r = requests.get(f"{BASE_URL}/api/warehouse/products", headers=_h(tokens["Flaminio"]))
        pid = r.json()[0]["id"]
        resp = requests.patch(f"{BASE_URL}/api/products/{pid}/quantity",
                              json={"quantity": 999}, headers=_h(tokens["Flaminio"]))
        assert resp.status_code == 403

    def test_patch_product_quantity_forbidden_for_magazziniere_and_ok_for_admin(self, tokens):
        r = requests.get(f"{BASE_URL}/api/warehouse/products", headers=_h(tokens["Magazziniere"]))
        pid = r.json()[0]["id"]
        original = r.json()[0]["quantity"]
        new_qty = original + 5
        forbidden = requests.patch(
            f"{BASE_URL}/api/products/{pid}/quantity",
            json={"quantity": new_qty},
            headers=_h(tokens["Magazziniere"]),
        )
        assert forbidden.status_code == 403
        resp = requests.patch(f"{BASE_URL}/api/products/{pid}/quantity",
                              json={"quantity": new_qty}, headers=_h(tokens["Admin"]))
        assert resp.status_code == 200
        assert resp.json()["quantity"] == new_qty
        # revert
        requests.patch(f"{BASE_URL}/api/products/{pid}/quantity",
                       json={"quantity": original}, headers=_h(tokens["Admin"]))


# ---------- Richieste endpoints ----------

class TestRichiesteCRUD:
    created_ids = []

    def _get_products(self, tok):
        return requests.get(f"{BASE_URL}/api/warehouse/products", headers=_h(tok)).json()

    def test_magazziniere_cannot_create(self, tokens):
        products = self._get_products(tokens["Magazziniere"])
        p = products[0]
        payload = {"items": [{"product_id": p["id"], "product_name": p["name"],
                              "unit": p["unit"], "supplier": p.get("supplier", ""), "quantity": 1}]}
        r = requests.post(f"{BASE_URL}/api/richieste", json=payload, headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 403

    def test_create_richiesta_flaminio(self, tokens):
        products = self._get_products(tokens["Flaminio"])
        p = products[0]
        payload = {"items": [{"product_id": p["id"], "product_name": p["name"],
                              "unit": p["unit"], "supplier": p.get("supplier", ""), "quantity": 2}]}
        r = requests.post(f"{BASE_URL}/api/richieste", json=payload, headers=_h(tokens["Flaminio"]))
        assert r.status_code == 200, r.text
        doc = r.json()
        assert "id" in doc and "ddt_number" in doc and isinstance(doc["ddt_number"], int)
        assert doc["status"] == "pending"
        assert doc["destinatario"]["address"].startswith("Piazzale Flaminio")
        assert doc["mittente"]["name"] == "Pastasciutta Srl"
        TestRichiesteCRUD.created_ids.append(("flaminio", doc["id"], doc["ddt_number"], p["id"]))

    def test_ddt_autoincrement(self, tokens):
        products = self._get_products(tokens["Grazie"])
        p = products[0]
        payload = {"items": [{"product_id": p["id"], "product_name": p["name"],
                              "unit": p["unit"], "supplier": p.get("supplier", ""), "quantity": 3}]}
        r = requests.post(f"{BASE_URL}/api/richieste", json=payload, headers=_h(tokens["Grazie"]))
        assert r.status_code == 200
        prev_ddt = TestRichiesteCRUD.created_ids[-1][2]
        assert r.json()["ddt_number"] == prev_ddt + 1, f"Expected DDT {prev_ddt+1}, got {r.json()['ddt_number']}"
        assert r.json()["destinatario"]["address"].startswith("Via delle Grazie")
        TestRichiesteCRUD.created_ids.append(("grazie", r.json()["id"], r.json()["ddt_number"], p["id"]))

    def test_create_empty_items_400(self, tokens):
        r = requests.post(f"{BASE_URL}/api/richieste", json={"items": []}, headers=_h(tokens["Flaminio"]))
        assert r.status_code == 400

    def test_list_own_richieste_only(self, tokens):
        r = requests.get(f"{BASE_URL}/api/richieste", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 200
        docs = r.json()
        own_loc = "Flaminio"
        for d in docs:
            assert d.get("restaurant_location") == own_loc, f"Unexpected: {d.get('restaurant_location')}"

    def test_pending_all_magazziniere(self, tokens):
        r = requests.get(f"{BASE_URL}/api/richieste/pending-all", headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 200
        ids = {d["id"] for d in r.json()}
        for _, rid, _, _ in TestRichiesteCRUD.created_ids:
            assert rid in ids

    def test_pending_all_locale_forbidden(self, tokens):
        r = requests.get(f"{BASE_URL}/api/richieste/pending-all", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 403

    def test_history_all_locale_forbidden(self, tokens):
        r = requests.get(f"{BASE_URL}/api/richieste/history-all", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 403

    def test_history_all_magazziniere_ok(self, tokens):
        r = requests.get(f"{BASE_URL}/api/richieste/history-all", headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_single_richiesta_scoped(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        # Flaminio can see
        r = requests.get(f"{BASE_URL}/api/richieste/{flam_id}", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 200
        assert r.json()["mittente"]["name"] == "Pastasciutta Srl"
        # Grazie cannot see Flaminio's
        r2 = requests.get(f"{BASE_URL}/api/richieste/{flam_id}", headers=_h(tokens["Grazie"]))
        assert r2.status_code == 403
        # Magazziniere can see any
        r3 = requests.get(f"{BASE_URL}/api/richieste/{flam_id}", headers=_h(tokens["Magazziniere"]))
        assert r3.status_code == 200

    def test_real_quantity_reflects_pending_sum(self, tokens):
        """With two pending requests from Flaminio(2) and Grazie(3) on same first product (if same),
           real_quantity = quantity - sum pending."""
        # Only valid if both tests used the same first product id
        fl_pid = TestRichiesteCRUD.created_ids[0][3]
        gr_pid = TestRichiesteCRUD.created_ids[1][3]
        products = requests.get(f"{BASE_URL}/api/warehouse/products",
                                headers=_h(tokens["Flaminio"])).json()
        pmap = {p["id"]: p for p in products}
        if fl_pid == gr_pid:
            p = pmap[fl_pid]
            assert p["quantity"] - p["real_quantity"] >= 5, \
                f"Expected pending >=5, got {p['quantity']} - {p['real_quantity']}"
        else:
            p1 = pmap[fl_pid]
            p2 = pmap[gr_pid]
            assert p1["quantity"] - p1["real_quantity"] >= 2
            assert p2["quantity"] - p2["real_quantity"] >= 3

    def test_evade_forbidden_for_locale(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        r = requests.patch(f"{BASE_URL}/api/richieste/{flam_id}/evade", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 403

    def test_evade_decrements_stock(self, tokens):
        flam_id, qty_requested, pid = (TestRichiesteCRUD.created_ids[0][1], 2,
                                       TestRichiesteCRUD.created_ids[0][3])
        # Stock before
        before = [p for p in requests.get(f"{BASE_URL}/api/warehouse/products",
                  headers=_h(tokens["Magazziniere"])).json() if p["id"] == pid][0]["quantity"]
        r = requests.patch(f"{BASE_URL}/api/richieste/{flam_id}/evade",
                           headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 200
        assert r.json()["status"] == "evasa"
        # Stock after
        after = [p for p in requests.get(f"{BASE_URL}/api/warehouse/products",
                 headers=_h(tokens["Magazziniere"])).json() if p["id"] == pid][0]["quantity"]
        assert after == before - qty_requested, f"Stock before={before}, after={after}, req={qty_requested}"

    def test_evade_twice_400(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        r = requests.patch(f"{BASE_URL}/api/richieste/{flam_id}/evade",
                           headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 400

    def test_conferma_magazziniere_forbidden(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        r = requests.patch(f"{BASE_URL}/api/richieste/{flam_id}/conferma",
                           json={"checker_name": "Test Magazzino"},
                           headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 403

    def test_conferma_wrong_locale_forbidden(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        r = requests.patch(f"{BASE_URL}/api/richieste/{flam_id}/conferma",
                           json={"checker_name": "Test Grazie"},
                           headers=_h(tokens["Grazie"]))
        assert r.status_code == 403

    def test_conferma_requires_checker_name(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        r = requests.patch(
            f"{BASE_URL}/api/richieste/{flam_id}/conferma",
            json={"checker_name": " "},
            headers=_h(tokens["Flaminio"]),
        )
        assert r.status_code == 400

    def test_conferma_ok(self, tokens):
        flam_id = TestRichiesteCRUD.created_ids[0][1]
        r = requests.patch(f"{BASE_URL}/api/richieste/{flam_id}/conferma",
                           json={"checker_name": "Mario Test"},
                           headers=_h(tokens["Flaminio"]))
        assert r.status_code == 200
        assert r.json()["status"] == "confermata"
        assert r.json()["transport_checked_by"] == "Mario Test"

    def test_conferma_must_be_evasa_first(self, tokens):
        # Second richiesta (Grazie) is still pending; conferma should fail
        gr_id = TestRichiesteCRUD.created_ids[1][1]
        r = requests.patch(f"{BASE_URL}/api/richieste/{gr_id}/conferma",
                           json={"checker_name": "Test Grazie"},
                           headers=_h(tokens["Grazie"]))
        assert r.status_code == 400

    def test_delete_magazziniere_forbidden(self, tokens):
        gr_id = TestRichiesteCRUD.created_ids[1][1]
        r = requests.delete(f"{BASE_URL}/api/richieste/{gr_id}", headers=_h(tokens["Magazziniere"]))
        assert r.status_code == 403

    def test_delete_wrong_locale_forbidden(self, tokens):
        gr_id = TestRichiesteCRUD.created_ids[1][1]
        r = requests.delete(f"{BASE_URL}/api/richieste/{gr_id}", headers=_h(tokens["Flaminio"]))
        assert r.status_code == 403

    def test_delete_own_pending_ok(self, tokens):
        gr_id = TestRichiesteCRUD.created_ids[1][1]
        r = requests.delete(f"{BASE_URL}/api/richieste/{gr_id}", headers=_h(tokens["Grazie"]))
        assert r.status_code == 200
        # Verify gone
        r2 = requests.get(f"{BASE_URL}/api/richieste/{gr_id}", headers=_h(tokens["Magazziniere"]))
        assert r2.status_code == 404


class TestAdminImpersonation:
    def test_admin_can_create_richiesta_as_locale(self, tokens, restaurants):
        rest_id = restaurants.get("Flaminio")
        assert rest_id, f"Flaminio restaurant id not found in {list(restaurants.keys())}"
        products = requests.get(f"{BASE_URL}/api/warehouse/products",
                                headers=_h(tokens["Admin"], rest_id)).json()
        p = products[0]
        payload = {"items": [{"product_id": p["id"], "product_name": p["name"],
                              "unit": p["unit"], "supplier": p.get("supplier", ""), "quantity": 1}]}
        r = requests.post(f"{BASE_URL}/api/richieste", json=payload,
                          headers=_h(tokens["Admin"], rest_id))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"
        assert r.json()["destinatario"]["address"].startswith("Piazzale Flaminio")
        # Cleanup
        rid = r.json()["id"]
        requests.delete(f"{BASE_URL}/api/richieste/{rid}",
                        headers=_h(tokens["Admin"], rest_id))
