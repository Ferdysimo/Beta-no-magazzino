"""
CRITICAL Backend API Tests for Pastasciutta Roma - Pre-Production Testing
Focus: Hide from Generale (soft delete), Real delete from Cassa, Timer freeze, Monitor auto-off

CRITICAL BUG FIX VERIFICATION:
- Generale uses 'hide' (hidden_generale flag) instead of real delete
- Only Cassa can truly delete orders
- When hidden from Generale: timer freezes and turns blue on Cassa page, monitor_visible is auto-set to false
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    pytest.skip("live backend not configured", allow_module_level=True)

TEST_PASSWORD = os.environ.get("PASTA_TEST_PASSWORD", "")
if not TEST_PASSWORD:
    pytest.skip("PASTA_TEST_PASSWORD not set", allow_module_level=True)

# Test credentials for all 4 accounts
ACCOUNTS = [
    {"username": "Flaminio", "password": TEST_PASSWORD, "location": "Flaminio", "role": "restaurant"},
    {"username": "Grazie", "password": TEST_PASSWORD, "location": "Grazie", "role": "restaurant"},
    {"username": "Brazza", "password": TEST_PASSWORD, "location": "Largo di Brazzà", "role": "restaurant"},
    {"username": "Magazziniere", "password": TEST_PASSWORD, "location": "Magazzino", "role": "magazzino"},
]


class TestAllAccountsLogin:
    """Test all 4 accounts can login successfully"""

    @pytest.mark.parametrize("account", ACCOUNTS)
    def test_login_all_accounts(self, account):
        """Test login for each account"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": account["username"],
            "password": account["password"]
        })
        assert response.status_code == 200, f"Login failed for {account['username']}: {response.text}"
        
        data = response.json()
        assert "token" in data, f"Token not in response for {account['username']}"
        assert data["restaurant"]["username"] == account["username"]
        assert data["restaurant"]["location"] == account["location"]
        print(f"✓ Login success for {account['username']} - Location: {account['location']}")


class TestCriticalHideFromGenerale:
    """
    CRITICAL TEST: Hide from Generale (soft delete) vs Real delete from Cassa
    This is the main bug fix being tested - orders hidden from Generale must still exist in DB
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        """Login before each test"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.restaurant_id = login_response.json()["restaurant"]["id"]

    def test_hide_from_generale_order_still_exists(self):
        """
        CRITICAL: When hiding from Generale, order must STILL exist in database
        This verifies the bug fix - Generale uses soft hide, not real delete
        """
        # Step 1: Create an order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_hide_generale_critical"},
            headers=self.headers
        )
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        order_id = create_response.json()["id"]
        order_number = create_response.json()["order_number"]
        print(f"✓ Created order #{order_number}")
        
        # Step 2: Verify order exists
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_response.status_code == 200, "Order should exist"
        assert get_response.json()["hidden_generale"] == False, "Order should not be hidden initially"
        print(f"✓ Order exists with hidden_generale=False")
        
        # Step 3: Hide from Generale (this is what Generale page does now)
        hide_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/hide-generale",
            headers=self.headers
        )
        assert hide_response.status_code == 200, f"Hide failed: {hide_response.text}"
        print(f"✓ Hide from Generale API called successfully")
        
        # Step 4: CRITICAL - Order must STILL exist in database
        get_after_hide = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_after_hide.status_code == 200, "CRITICAL BUG: Order was deleted instead of hidden!"
        
        order_data = get_after_hide.json()
        assert order_data["hidden_generale"] == True, "hidden_generale flag should be True"
        print(f"✓ CRITICAL: Order still exists with hidden_generale=True")
        
        # Step 5: Verify order appears in orders list (for Cassa page)
        orders_response = requests.get(f"{BASE_URL}/api/orders", headers=self.headers)
        orders = orders_response.json()
        order_ids = [o["id"] for o in orders]
        assert order_id in order_ids, "CRITICAL: Hidden order should still appear in orders list for Cassa"
        print(f"✓ CRITICAL: Hidden order still appears in orders list")
        
        # Cleanup - real delete
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)

    def test_hide_from_generale_sets_monitor_visible_false(self):
        """
        When hiding from Generale, monitor_visible should be auto-set to false
        """
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_monitor_auto_off"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # First toggle monitor ON
        requests.post(f"{BASE_URL}/api/orders/{order_id}/monitor-toggle", headers=self.headers)
        
        # Verify monitor is ON
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_response.json()["monitor_visible"] == True, "Monitor should be ON"
        print(f"✓ Monitor toggled ON")
        
        # Hide from Generale
        hide_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/hide-generale",
            headers=self.headers
        )
        assert hide_response.status_code == 200
        
        # Verify monitor is now OFF
        get_after_hide = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_after_hide.json()["monitor_visible"] == False, "Monitor should be auto-OFF after hide"
        print(f"✓ Monitor auto-set to False when hidden from Generale")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)

    def test_hide_from_generale_freezes_timer(self):
        """
        When hiding from Generale, timer should freeze (hidden_generale_timer saves elapsed seconds)
        """
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_timer_freeze"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Start timer
        requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/start", headers=self.headers)
        
        # Wait a bit for timer to accumulate
        time.sleep(2)
        
        # Hide from Generale
        hide_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/hide-generale",
            headers=self.headers
        )
        assert hide_response.status_code == 200
        
        # Verify hidden_generale_timer is set
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        order_data = get_response.json()
        
        assert order_data["hidden_generale"] == True
        assert order_data["hidden_generale_timer"] >= 1, "Timer should have frozen with elapsed time"
        print(f"✓ Timer frozen at {order_data['hidden_generale_timer']} seconds")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)

    def test_real_delete_from_cassa_removes_order(self):
        """
        Real delete (from Cassa) should truly remove order from database
        """
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_real_delete"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        order_number = create_response.json()["order_number"]
        print(f"✓ Created order #{order_number}")
        
        # Real delete (what Cassa does)
        delete_response = requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        print(f"✓ Real delete called")
        
        # Verify order is GONE from database
        get_after_delete = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_after_delete.status_code == 404, "Order should be truly deleted"
        print(f"✓ Order truly deleted from database (404)")


class TestKitchenComplete:
    """Test kitchen complete functionality (hides from Bollitore but keeps on Cassa)"""

    @pytest.fixture(autouse=True)
    def setup(self):
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_kitchen_complete_hides_from_bollitore(self):
        """Kitchen complete sets kitchen_completed=True, hiding from Bollitore but keeping on Cassa"""
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_kitchen_complete"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Kitchen complete
        complete_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/kitchen-complete",
            headers=self.headers
        )
        assert complete_response.status_code == 200
        
        # Verify kitchen_completed is True
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        order_data = get_response.json()
        assert order_data["kitchen_completed"] == True
        assert order_data["status"] == "pending", "Status should still be pending"
        print(f"✓ Kitchen completed - order hidden from Bollitore but still pending")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)


class TestOrderNumberIncrement:
    """Test order number increments correctly starting from 1"""

    @pytest.fixture(autouse=True)
    def setup(self):
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_order_number_increments(self):
        """Test that order numbers increment correctly"""
        # Create first order
        create1 = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_increment_1"},
            headers=self.headers
        )
        order1_num = create1.json()["order_number"]
        order1_id = create1.json()["id"]
        
        # Create second order
        create2 = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_increment_2"},
            headers=self.headers
        )
        order2_num = create2.json()["order_number"]
        order2_id = create2.json()["id"]
        
        assert order2_num == order1_num + 1, f"Order numbers should increment: {order1_num} -> {order2_num}"
        print(f"✓ Order numbers increment correctly: {order1_num} -> {order2_num}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order1_id}", headers=self.headers)
        requests.delete(f"{BASE_URL}/api/orders/{order2_id}", headers=self.headers)


class TestDailyReport:
    """Test daily report endpoint shows both active and archived orders"""

    @pytest.fixture(autouse=True)
    def setup(self):
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_daily_report_endpoint(self):
        """Test /api/report/daily returns proper structure"""
        response = requests.get(f"{BASE_URL}/api/report/daily", headers=self.headers)
        assert response.status_code == 200, f"Report failed: {response.text}"
        
        data = response.json()
        assert "date" in data
        assert "total_orders" in data
        assert "completed" in data
        assert "deleted" in data
        assert "pending" in data
        assert "items" in data
        print(f"✓ Daily report: {data['total_orders']} total, {data['pending']} pending, {data['completed']} completed, {data['deleted']} deleted")


class TestBollitoreFilters:
    """Test Bollitore page filters - only shows pending orders without kitchen_completed and without trailing dash"""

    @pytest.fixture(autouse=True)
    def setup(self):
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_trailing_dash_filter(self):
        """Orders with trailing dash should be filtered out from Bollitore"""
        # Create order with trailing dash
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_trailing_dash -"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        order_data = create_response.json()
        
        # The filtering happens on frontend, but we verify the order is created correctly
        assert order_data["description"].endswith("-"), "Order should have trailing dash"
        print(f"✓ Order with trailing dash created - frontend will filter from Bollitore")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)


class TestTimerOperations:
    """Test timer start, pause, reset operations"""

    @pytest.fixture(autouse=True)
    def setup(self):
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_timer_full_cycle(self):
        """Test timer start, pause, reset cycle"""
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_timer_cycle"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Start timer
        start_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/start",
            headers=self.headers
        )
        assert start_response.status_code == 200
        
        # Verify started
        get1 = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get1.json()["timer_started"] == True
        assert get1.json()["timer_start_time"] is not None
        print(f"✓ Timer started")
        
        # Pause timer
        pause_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/pause?elapsed=45",
            headers=self.headers
        )
        assert pause_response.status_code == 200
        
        # Verify paused
        get2 = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get2.json()["timer_paused"] == True
        assert get2.json()["timer_elapsed"] == 45
        print(f"✓ Timer paused at 45 seconds")
        
        # Reset timer
        reset_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/reset",
            headers=self.headers
        )
        assert reset_response.status_code == 200
        
        # Verify reset
        get3 = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get3.json()["timer_started"] == False
        assert get3.json()["timer_elapsed"] == 0
        print(f"✓ Timer reset")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)


class TestMonitorToggle:
    """Test monitor visibility toggle"""

    @pytest.fixture(autouse=True)
    def setup(self):
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "Flaminio",
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_monitor_toggle(self):
        """Test toggling monitor visibility"""
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_monitor_toggle"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Initial state should be False
        get1 = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get1.json()["monitor_visible"] == False
        
        # Toggle ON
        toggle1 = requests.post(f"{BASE_URL}/api/orders/{order_id}/monitor-toggle",
            headers=self.headers
        )
        assert toggle1.status_code == 200
        
        get2 = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get2.json()["monitor_visible"] == True
        print(f"✓ Monitor toggled ON")
        
        # Toggle OFF
        toggle2 = requests.post(f"{BASE_URL}/api/orders/{order_id}/monitor-toggle",
            headers=self.headers
        )
        assert toggle2.status_code == 200
        
        get3 = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get3.json()["monitor_visible"] == False
        print(f"✓ Monitor toggled OFF")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
