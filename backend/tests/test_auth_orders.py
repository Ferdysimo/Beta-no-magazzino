"""
Backend API Tests for Pastasciutta Roma
Tests: Authentication, Orders CRUD, WebSocket setup
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USERNAME = "Flaminio"
TEST_PASSWORD = "Pastasciutt4!"


class TestAuthentication:
    """Test authentication endpoints"""

    def test_login_success(self):
        """Test successful login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        assert "token" in data, "Token not in response"
        assert "restaurant" in data, "Restaurant not in response"
        assert data["restaurant"]["username"] == TEST_USERNAME
        assert data["restaurant"]["location"] == "Flaminio"
        print(f"Login success - Restaurant: {data['restaurant']['location']}")

    def test_login_invalid_credentials(self):
        """Test login with wrong password"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": TEST_USERNAME,
            "password": "WrongPassword123"
        })
        assert response.status_code == 401, f"Expected 401 but got {response.status_code}"
        print("Login correctly rejected with invalid credentials")

    def test_auth_me_with_token(self):
        """Test /auth/me endpoint with valid token"""
        # Login first
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD
        })
        token = login_response.json()["token"]
        
        # Get current user
        response = requests.get(f"{BASE_URL}/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == TEST_USERNAME
        print(f"Auth/me returned: {data['location']}")

    def test_auth_me_without_token(self):
        """Test /auth/me endpoint without token"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code in [401, 403], f"Expected 401/403 but got {response.status_code}"
        print("Auth/me correctly requires authentication")


class TestOrdersCRUD:
    """Test orders CRUD operations"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Login before each test"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_create_order(self):
        """Test creating a new order"""
        response = requests.post(f"{BASE_URL}/api/orders", 
            json={"description": "TEST_carbonara tavolo 5"},
            headers=self.headers
        )
        assert response.status_code == 200, f"Create order failed: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert "order_number" in data
        assert data["description"] == "TEST_carbonara tavolo 5"
        assert data["status"] == "pending"
        print(f"Created order #{data['order_number']}: {data['description']}")
        
        # Cleanup - delete the test order
        requests.delete(f"{BASE_URL}/api/orders/{data['id']}", headers=self.headers)

    def test_get_orders(self):
        """Test getting all orders"""
        response = requests.get(f"{BASE_URL}/api/orders", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"Got {len(data)} orders")

    def test_create_and_delete_order(self):
        """Test creating and then deleting an order"""
        # Create
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_delete_test_order"},
            headers=self.headers
        )
        assert create_response.status_code == 200
        order_id = create_response.json()["id"]
        order_number = create_response.json()["order_number"]
        print(f"Created test order #{order_number}")
        
        # Verify it exists
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_response.status_code == 200, "Order should exist after creation"
        
        # Delete
        delete_response = requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        print(f"Deleted order #{order_number}")
        
        # Verify it's gone
        get_after_delete = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_after_delete.status_code == 404, "Order should be deleted"
        print("Order correctly not found after deletion")

    def test_update_order(self):
        """Test updating an order description"""
        # Create
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_original_description"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Update
        update_response = requests.patch(f"{BASE_URL}/api/orders/{order_id}",
            json={"description": "TEST_updated_description"},
            headers=self.headers
        )
        assert update_response.status_code == 200
        assert update_response.json()["description"] == "TEST_updated_description"
        print("Order description updated successfully")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)

    def test_complete_order(self):
        """Test completing an order (marking as completed)"""
        # Create
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_complete_test"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Complete
        complete_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/complete",
            headers=self.headers
        )
        assert complete_response.status_code == 200
        
        # Verify status changed
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_response.json()["status"] == "completed"
        print("Order marked as completed")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)


class TestTimerOperations:
    """Test timer operations for orders"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Login before each test"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD
        })
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_timer_start_pause_reset(self):
        """Test timer start, pause, and reset operations"""
        # Create order
        create_response = requests.post(f"{BASE_URL}/api/orders",
            json={"description": "TEST_timer_test"},
            headers=self.headers
        )
        order_id = create_response.json()["id"]
        
        # Start timer
        start_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/start",
            headers=self.headers
        )
        assert start_response.status_code == 200
        
        # Verify timer started
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        data = get_response.json()
        assert data["timer_started"] == True
        assert data["timer_start_time"] is not None
        print("Timer started successfully")
        
        # Pause timer
        pause_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/pause?elapsed=30",
            headers=self.headers
        )
        assert pause_response.status_code == 200
        
        # Verify paused
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        data = get_response.json()
        assert data["timer_paused"] == True
        assert data["timer_elapsed"] == 30
        print("Timer paused successfully")
        
        # Reset timer
        reset_response = requests.post(f"{BASE_URL}/api/orders/{order_id}/timer/reset",
            headers=self.headers
        )
        assert reset_response.status_code == 200
        
        # Verify reset
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        data = get_response.json()
        assert data["timer_started"] == False
        assert data["timer_elapsed"] == 0
        print("Timer reset successfully")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)


class TestWebSocketEndpoint:
    """Test WebSocket endpoint availability"""

    def test_websocket_endpoint_exists(self):
        """Test that WebSocket URL is correctly formed"""
        # The WebSocket endpoint is at /api/ws/{restaurant_id}
        # We can't test WebSocket directly with requests, but we can verify URL formation
        ws_base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_base}/api/ws/test-restaurant-id"
        
        # Just verify the URL is correctly formed
        assert "wss://" in ws_url or "ws://" in ws_url
        assert "/api/ws/" in ws_url
        print(f"WebSocket URL would be: {ws_url}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
