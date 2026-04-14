import requests

BASE_URL = "http://localhost:3000/api"
LOGIN_ENDPOINT = f"{BASE_URL}/auth/login"
TIMEOUT = 30

def test_admin_login_with_valid_and_invalid_credentials():
    headers = {
        "Content-Type": "application/json"
    }

    # Valid credentials (you may need to replace these with valid test credentials)
    valid_payload = {
        "email": "admin@example.com",
        "password": "correct_password"
    }

    # Invalid credentials (wrong password)
    invalid_payload = {
        "email": "admin@example.com",
        "password": "wrong_password"
    }

    # Invalid credentials (non-existent user)
    invalid_user_payload = {
        "email": "nonexistent@example.com",
        "password": "some_password"
    }

    # Test valid login
    try:
        valid_response = requests.post(LOGIN_ENDPOINT, json=valid_payload, headers=headers, timeout=TIMEOUT)
        assert valid_response.status_code == 200, f"Expected 200 for valid login, got {valid_response.status_code}"
        json_data = valid_response.json()
        assert "token" in json_data and isinstance(json_data["token"], str) and len(json_data["token"]) > 0, "Valid login should return a JWT token"
    except (requests.RequestException, AssertionError) as e:
        raise AssertionError(f"Valid credentials login test failed: {e}")

    # Test invalid password login
    try:
        invalid_response = requests.post(LOGIN_ENDPOINT, json=invalid_payload, headers=headers, timeout=TIMEOUT)
        assert invalid_response.status_code in (400, 401), f"Expected 400 or 401 for invalid password, got {invalid_response.status_code}"
        json_data = invalid_response.json()
        assert "error" in json_data or "message" in json_data, "Error response should contain 'error' or 'message'"
    except (requests.RequestException, AssertionError) as e:
        raise AssertionError(f"Invalid password login test failed: {e}")

    # Test invalid user login
    try:
        invalid_user_response = requests.post(LOGIN_ENDPOINT, json=invalid_user_payload, headers=headers, timeout=TIMEOUT)
        assert invalid_user_response.status_code in (400, 401), f"Expected 400 or 401 for invalid user, got {invalid_user_response.status_code}"
        json_data = invalid_user_response.json()
        assert "error" in json_data or "message" in json_data, "Error response should contain 'error' or 'message'"
    except (requests.RequestException, AssertionError) as e:
        raise AssertionError(f"Invalid user login test failed: {e}")

test_admin_login_with_valid_and_invalid_credentials()
