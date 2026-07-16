import base64
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from conftest import run_isolated


if os.environ.get("PASTA_RUN_ISOLATED_INTEGRATION") != "1":
    pytest.skip(
        "Set PASTA_RUN_ISOLATED_INTEGRATION=1 with an isolated DB_NAME",
        allow_module_level=True,
    )

TEST_PASSWORD = os.environ.get("PASTA_TEST_PASSWORD", "")
if not TEST_PASSWORD:
    pytest.skip("PASTA_TEST_PASSWORD not set", allow_module_level=True)

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import server
from app import bootstrap
from app.core.config import UPLOADS_DIR
from app.core.security import pwd_context


PNG_1X1 = "data:image/png;base64," + base64.b64encode(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII="
    )
).decode()


def test_phase3_domains_in_isolated_database():
    run_isolated(_exercise_phase3_domains())


async def _exercise_phase3_domains():
    db_name = os.environ["DB_NAME"]
    assert db_name.startswith("pastasciutta_refactor_test_")
    created_files = set()

    await server.client.drop_database(db_name)
    try:
        now = datetime.now(timezone.utc).isoformat()
        await server.db.restaurants.insert_many([
            {
                "id": str(uuid.uuid4()),
                "name": name,
                "username": username,
                "password": pwd_context.hash(TEST_PASSWORD),
                "location": location,
                "role": role,
                "token_version": 2 if username == "Simone" else 1,
                "boiler_count": 1,
                "created_at": now,
                "order_counter": 0,
            }
            for username, name, location, role in (
                ("Admin", "Amministratore", "Amministrazione", "admin"),
                ("Flaminio", "Pastasciutta Roma", "Flaminio", "restaurant"),
                ("Magazziniere", "Magazziniere", "Magazzino", "magazzino"),
                ("Federico", "Supervisore", "Supervisione", "supervisor"),
            )
        ])
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            timeout=30,
        ) as client:
            assert (await client.post("/api/seed")).status_code in (404, 405)
            await bootstrap.initialize_application()

            async def login(username, password):
                response = await client.post(
                    "/api/auth/login",
                    json={"username": username, "password": password},
                )
                assert response.status_code == 200, response.text
                return {"Authorization": f"Bearer {response.json()['token']}"}

            admin_headers = await login("Admin", TEST_PASSWORD)
            flaminio_headers = await login("Flaminio", TEST_PASSWORD)
            warehouse_headers = await login("Magazziniere", TEST_PASSWORD)
            federico_headers = await login("Federico", TEST_PASSWORD)

            wrong_password = await client.post(
                "/api/auth/login",
                json={"username": "Federico", "password": "definitely-wrong-password"},
            )
            assert wrong_password.status_code == 401

            for headers in (admin_headers, flaminio_headers, warehouse_headers, federico_headers):
                me = await client.get("/api/auth/me", headers=headers)
                assert me.status_code == 200

            diagnostics = await client.get("/api/admin/diagnostics", headers=admin_headers)
            assert diagnostics.status_code == 200
            forbidden_diagnostics = await client.get(
                "/api/admin/diagnostics", headers=flaminio_headers
            )
            assert forbidden_diagnostics.status_code == 403

            order = await client.post(
                "/api/orders",
                headers=flaminio_headers,
                json={"description": "CARB gate fase 3"},
            )
            assert order.status_code == 200, order.text
            order_id = order.json()["id"]
            assert (await client.post(
                f"/api/orders/{order_id}/timer/start", headers=flaminio_headers
            )).status_code == 200
            assert (await client.post(
                f"/api/orders/{order_id}/kitchen-complete", headers=flaminio_headers
            )).status_code == 200
            assert (await client.post(
                f"/api/orders/{order_id}/hide-generale", headers=flaminio_headers
            )).status_code == 200
            daily_report = await client.get("/api/report/daily", headers=flaminio_headers)
            assert daily_report.status_code == 200
            assert daily_report.json()["total_orders"] == 1
            assert any(
                row["description"] == "CARB gate fase 3"
                for row in daily_report.json()["items"]
            )

            cash_saved = await client.put(
                "/api/cash/daily",
                headers=flaminio_headers,
                json={"mattina": "100", "altro": "10"},
            )
            assert cash_saved.status_code == 200, cash_saved.text
            audit = await client.get("/api/admin/audit-log", headers=admin_headers)
            assert audit.status_code == 200
            assert any(
                row.get("restaurant_id") == order.json()["restaurant_id"]
                for row in audit.json()["items"]
            )

            product_payload = {
                "name": "Prodotto fase 3",
                "unit": "pz",
                "supplier": "Test supplier",
                "quantity": 10,
                "image_data": "",
            }
            forbidden_product = await client.post(
                "/api/products",
                headers=warehouse_headers,
                json=product_payload,
            )
            assert forbidden_product.status_code == 403
            product = await client.post(
                "/api/products",
                headers=admin_headers,
                json=product_payload,
            )
            assert product.status_code == 200, product.text
            product_id = product.json()["id"]

            request = await client.post(
                "/api/richieste",
                headers=flaminio_headers,
                json={
                    "items": [{
                        "product_id": product_id,
                        "product_name": "Prodotto fase 3",
                        "unit": "pz",
                        "supplier": "Test supplier",
                        "quantity": 3,
                    }],
                    "extra_note": "gate fase 3",
                },
            )
            assert request.status_code == 200, request.text
            request_id = request.json()["id"]

            evaded = await client.patch(
                f"/api/richieste/{request_id}/evade", headers=warehouse_headers
            )
            assert evaded.status_code == 200, evaded.text
            assert evaded.json()["status"] == "evasa"
            confirmed = await client.patch(
                f"/api/richieste/{request_id}/conferma", headers=flaminio_headers
            )
            assert confirmed.status_code == 200
            assert confirmed.json()["status"] == "confermata"

            product_doc = await server.db.products.find_one({"id": product_id})
            assert product_doc["quantity"] == 7
            assert await server.db.stock_movements.count_documents({
                "product_id": product_id,
                "cause": "evasione",
                "delta": -3,
            }) == 1

            invoice = await client.post(
                "/api/invoices",
                headers=flaminio_headers,
                json={
                    "supplier": "Test supplier",
                    "image_data": PNG_1X1,
                    "importo": 12.5,
                    "ddt_number": "P3-1",
                },
            )
            assert invoice.status_code == 200, invoice.text
            invoice_id = invoice.json()["id"]
            invoice_doc = await server.db.invoices.find_one({"id": invoice_id})
            created_files.add(invoice_doc["image_file"])
            fetched_invoice = await client.get(
                f"/api/invoices/{invoice_id}", headers=flaminio_headers
            )
            assert fetched_invoice.status_code == 200
            assert fetched_invoice.json()["ddt_number"] == "P3-1"

            versamento = await client.post(
                "/api/versamenti",
                headers=flaminio_headers,
                json={"description": "Gate fase 3", "image_data": PNG_1X1},
            )
            assert versamento.status_code == 200, versamento.text
            versamento_id = versamento.json()["id"]
            versamento_doc = await server.db.versamenti.find_one({"id": versamento_id})
            created_files.add(versamento_doc["image_file"])

            chiusura = await client.post(
                "/api/chiusure",
                headers=flaminio_headers,
                json={"description": "Gate fase 3", "image_data": PNG_1X1},
            )
            assert chiusura.status_code == 200, chiusura.text
            chiusura_id = chiusura.json()["id"]
            chiusura_doc = await server.db.chiusure.find_one({"id": chiusura_id})
            created_files.add(chiusura_doc["image_file"])

            beverages = await client.get("/api/beverages", headers=flaminio_headers)
            assert beverages.status_code == 200
            assert len(beverages.json()) == 9

            assert (await client.delete(
                f"/api/invoices/{invoice_id}", headers=admin_headers
            )).status_code == 200
            assert (await client.delete(
                f"/api/versamenti/{versamento_id}", headers=admin_headers
            )).status_code == 200
            assert (await client.delete(
                f"/api/chiusure/{chiusura_id}", headers=admin_headers
            )).status_code == 200

            index_info = await server.db.orders.index_information()
            assert "uniq_restaurant_order_number" in index_info
            assert index_info["uniq_restaurant_order_number"]["unique"] is True
    finally:
        await server.client.drop_database(db_name)
        for filename in created_files:
            path = UPLOADS_DIR / filename
            if path.exists():
                path.unlink()
