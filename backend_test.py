#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class PastasciuttaAPITester:
    def __init__(self, base_url="https://pasta-orders-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.restaurant_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.created_order_ids = []

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}" if not endpoint.startswith('/') else f"{self.base_url}{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=10)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=test_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=10)

            print(f"   Status: {response.status_code}")
            
            if response.status_code == expected_status:
                self.tests_passed += 1
                print(f"✅ PASSED - Expected {expected_status}, got {response.status_code}")
                try:
                    return True, response.json() if response.content else {}
                except:
                    return True, {}
            else:
                print(f"❌ FAILED - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except requests.exceptions.RequestException as e:
            print(f"❌ FAILED - Network Error: {str(e)}")
            return False, {}
        except Exception as e:
            print(f"❌ FAILED - Error: {str(e)}")
            return False, {}

    def test_api_root(self):
        """Test API root endpoint"""
        success, response = self.run_test(
            "API Root",
            "GET", 
            "",
            200
        )
        return success

    def test_seed_data(self):
        """Seed initial restaurants"""
        success, response = self.run_test(
            "Seed Data",
            "POST",
            "seed",
            200
        )
        if success:
            print("   Seeded restaurants successfully")
        return success

    def test_login(self, username="brazza", password="brazza123"):
        """Test login and get token"""
        success, response = self.run_test(
            f"Login ({username})",
            "POST",
            "auth/login",
            200,
            data={"username": username, "password": password}
        )
        
        if success and 'token' in response:
            self.token = response['token']
            restaurant = response.get('restaurant', {})
            self.restaurant_id = restaurant.get('id')
            print(f"   Logged in as: {restaurant.get('location', 'Unknown')}")
            print(f"   Restaurant ID: {self.restaurant_id}")
            return True
        return False

    def test_get_current_user(self):
        """Test getting current user info"""
        if not self.token:
            print("❌ No token - skipping user info test")
            return False
            
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        
        if success:
            print(f"   User location: {response.get('location', 'Unknown')}")
        return success

    def test_create_order(self, description="CARBONARA TA 15"):
        """Test creating an order"""
        if not self.token:
            print("❌ No token - skipping order creation test")
            return False
            
        success, response = self.run_test(
            f"Create Order ({description})",
            "POST",
            "orders",
            200,
            data={"description": description}
        )
        
        if success:
            order_id = response.get('id')
            order_number = response.get('order_number')
            if order_id:
                self.created_order_ids.append(order_id)
            print(f"   Created order #{order_number} - ID: {order_id}")
            return order_id
        return None

    def test_get_orders(self):
        """Test getting orders list"""
        if not self.token:
            print("❌ No token - skipping get orders test")
            return False
            
        success, response = self.run_test(
            "Get Orders",
            "GET",
            "orders",
            200
        )
        
        if success:
            orders = response if isinstance(response, list) else []
            print(f"   Found {len(orders)} orders")
            return orders
        return []

    def test_get_single_order(self, order_id):
        """Test getting a single order"""
        if not self.token or not order_id:
            print("❌ No token or order ID - skipping single order test")
            return False
            
        success, response = self.run_test(
            f"Get Single Order ({order_id[:8]}...)",
            "GET",
            f"orders/{order_id}",
            200
        )
        return success

    def test_update_order(self, order_id, new_description="AMATRICIANA TA 18"):
        """Test updating an order"""
        if not self.token or not order_id:
            print("❌ No token or order ID - skipping update test")
            return False
            
        success, response = self.run_test(
            f"Update Order ({order_id[:8]}...)",
            "PATCH",
            f"orders/{order_id}",
            200,
            data={"description": new_description}
        )
        
        if success:
            print(f"   Updated description to: {response.get('description')}")
        return success

    def test_timer_operations(self, order_id):
        """Test timer start, pause, reset operations"""
        if not self.token or not order_id:
            print("❌ No token or order ID - skipping timer tests")
            return False
            
        # Start timer
        success1, _ = self.run_test(
            f"Start Timer ({order_id[:8]}...)",
            "POST",
            f"orders/{order_id}/timer/start",
            200
        )
        
        # Pause timer (with elapsed time)
        success2, _ = self.run_test(
            f"Pause Timer ({order_id[:8]}...)",
            "POST",
            f"orders/{order_id}/timer/pause?elapsed=90",
            200
        )
        
        # Reset timer
        success3, _ = self.run_test(
            f"Reset Timer ({order_id[:8]}...)",
            "POST",
            f"orders/{order_id}/timer/reset",
            200
        )
        
        return success1 and success2 and success3

    def test_complete_order(self, order_id):
        """Test completing an order"""
        if not self.token or not order_id:
            print("❌ No token or order ID - skipping complete test")
            return False
            
        success, response = self.run_test(
            f"Complete Order ({order_id[:8]}...)",
            "POST",
            f"orders/{order_id}/complete",
            200
        )
        return success

    def test_delete_order(self, order_id):
        """Test deleting an order"""
        if not self.token or not order_id:
            print("❌ No token or order ID - skipping delete test")
            return False
            
        success, response = self.run_test(
            f"Delete Order ({order_id[:8]}...)",
            "DELETE",
            f"orders/{order_id}",
            200
        )
        return success

    def test_invalid_login(self):
        """Test login with invalid credentials"""
        success, response = self.run_test(
            "Invalid Login Test",
            "POST",
            "auth/login",
            401,  # Should return 401 for invalid credentials
            data={"username": "invalid", "password": "wrong"}
        )
        return success

def main():
    print("🍝 Pastasciutta Roma API Testing Started")
    print("=" * 50)
    
    # Initialize tester
    tester = PastasciuttaAPITester()
    
    # Test sequence
    print("\n📋 BASIC API TESTS")
    tester.test_api_root()
    tester.test_seed_data()
    
    print("\n🔐 AUTHENTICATION TESTS")
    tester.test_invalid_login()  # Test invalid login first
    
    if not tester.test_login():
        print("❌ Login failed - stopping tests")
        print(f"\n📊 Final Results: {tester.tests_passed}/{tester.tests_run} tests passed")
        return 1
    
    tester.test_get_current_user()
    
    print("\n📝 ORDER MANAGEMENT TESTS")
    
    # Create multiple test orders
    order_ids = []
    for desc in ["CARBONARA TA 15", "AMATRICIANA TA 18", "GRICIA TA 12"]:
        order_id = tester.test_create_order(desc)
        if order_id:
            order_ids.append(order_id)
    
    # Test getting orders
    orders = tester.test_get_orders()
    
    if order_ids:
        # Test operations on first order
        first_order_id = order_ids[0]
        
        print("\n🔧 ORDER OPERATIONS TESTS")
        tester.test_get_single_order(first_order_id)
        tester.test_update_order(first_order_id)
        tester.test_timer_operations(first_order_id)
        
        # Test complete and delete on different orders
        if len(order_ids) > 1:
            tester.test_complete_order(order_ids[1])
        
        if len(order_ids) > 2:
            tester.test_delete_order(order_ids[2])
    
    # Print final results
    print("\n" + "=" * 50)
    print(f"📊 Final Results: {tester.tests_passed}/{tester.tests_run} tests passed")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        failed = tester.tests_run - tester.tests_passed
        print(f"⚠️  {failed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())