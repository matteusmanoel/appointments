import requests

BASE_URL = "http://localhost:3000"
API_BASE = f"{BASE_URL}/api"
TIMEOUT = 30

# Assuming authentication is required, define admin credentials here
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "adminpassword"

def get_auth_token():
    url = f"{API_BASE}/auth/login"
    payload = {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }
    try:
        resp = requests.post(url, json=payload, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        token = data.get("token") or data.get("accessToken")
        assert token, "Authentication token not found in login response"
        return token
    except Exception as e:
        raise RuntimeError(f"Failed to authenticate admin: {e}")

def test_establishment_settings_update():
    token = get_auth_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # 1. Retrieve current establishment info (GET)
    get_url = f"{API_BASE}/barbershops"
    try:
        response_get = requests.get(get_url, headers=headers, timeout=TIMEOUT)
        response_get.raise_for_status()
        barbershops = response_get.json()
        # Assuming single establishment, get first if list
        if isinstance(barbershops, list):
            establishment = barbershops[0] if barbershops else None
        else:
            establishment = barbershops
        assert establishment is not None, "No establishment data available"
        est_id = establishment.get("id")
        assert est_id, "Establishment ID not found"
    except Exception as e:
        raise AssertionError(f"Failed to get establishment data: {e}")

    # 2. Prepare updated data for name, phone, email, address
    updated_data = {
        "name": establishment.get("name", "Test Establishment") + " Updated",
        "phone": establishment.get("phone", "1234567890")[:-1] + "1",  # change last digit
        "email": "updated_" + (establishment.get("email", "test@example.com")),
        "address": establishment.get("address", "123 Test St") + " Suite 100"
    }

    put_url = f"{API_BASE}/barbershops/{est_id}"

    try:
        # 3. Update establishment info (PUT)
        response_put = requests.put(put_url, headers=headers, json=updated_data, timeout=TIMEOUT)
        response_put.raise_for_status()
        updated_establishment = response_put.json()
        # 4. Assert returned fields reflect the updated data
        assert updated_establishment.get("name") == updated_data["name"], "Name was not updated correctly"
        assert updated_establishment.get("phone") == updated_data["phone"], "Phone was not updated correctly"
        assert updated_establishment.get("email") == updated_data["email"], "Email was not updated correctly"
        assert updated_establishment.get("address") == updated_data["address"], "Address was not updated correctly"
    except Exception as e:
        raise AssertionError(f"Failed to update establishment data: {e}")

    try:
        # 5. Retrieve again and verify changes persisted (GET)
        response_get_after = requests.get(f"{API_BASE}/barbershops/{est_id}", headers=headers, timeout=TIMEOUT)
        response_get_after.raise_for_status()
        est_after = response_get_after.json()
        assert est_after.get("name") == updated_data["name"], "Name not persisted after update"
        assert est_after.get("phone") == updated_data["phone"], "Phone not persisted after update"
        assert est_after.get("email") == updated_data["email"], "Email not persisted after update"
        assert est_after.get("address") == updated_data["address"], "Address not persisted after update"
    except Exception as e:
        raise AssertionError(f"Failed to verify updated establishment data: {e}")

    # Optional: cleanup - restore original data if needed (not requested here)

test_establishment_settings_update()