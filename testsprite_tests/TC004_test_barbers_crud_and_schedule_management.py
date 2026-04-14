import requests

BASE_URL = "http://localhost:3000/api"
TIMEOUT = 30

# Placeholder token for authenticated requests
AUTH_TOKEN = "Bearer valid-authentication-token-placeholder"

headers = {
    "Content-Type": "application/json",
    "Authorization": AUTH_TOKEN
}

def test_barbers_crud_and_schedule_management():
    barber_id = None

    # 1. Validate required fields on barber creation (should fail)
    invalid_payload = {
        # Missing required fields (e.g., name, working hours)
    }
    resp = requests.post(f"{BASE_URL}/barbers", json=invalid_payload, headers=headers, timeout=TIMEOUT)
    assert resp.status_code in (400, 401, 422), f"Expected 400/401/422 for missing required fields or auth failure, got {resp.status_code}"
    assert "name" in resp.text or "working hours" in resp.text.lower() or "required" in resp.text.lower() or resp.status_code == 401

    # 2. Create a new barber with valid data
    valid_payload = {
        "name": "Test Barber",
        "workingHours": [
            {"day": "Monday", "start": "09:00", "end": "17:00"},
            {"day": "Tuesday", "start": "10:00", "end": "16:00"}
        ],
        "active": True
    }
    resp = requests.post(f"{BASE_URL}/barbers", json=valid_payload, headers=headers, timeout=TIMEOUT)
    assert resp.status_code == 201, f"Expected 201 on barber creation, got {resp.status_code}"
    data = resp.json()
    barber_id = data.get("id")
    assert barber_id is not None, "Barber ID not returned on creation"
    assert data.get("name") == valid_payload["name"]
    assert data.get("active") is True
    assert isinstance(data.get("workingHours"), list) and len(data["workingHours"]) == 2

    try:
        # 3. Update barber details (change name, working hours, and deactivate)
        update_payload = {
            "name": "Updated Barber",
            "workingHours": [
                {"day": "Wednesday", "start": "08:00", "end": "14:00"},
                {"day": "Thursday", "start": "12:00", "end": "18:00"}
            ],
            "active": False
        }
        resp = requests.put(f"{BASE_URL}/barbers/{barber_id}", json=update_payload, headers=headers, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200 on barber update, got {resp.status_code}"
        updated = resp.json()
        assert updated.get("name") == update_payload["name"]
        assert updated.get("active") is False
        assert isinstance(updated.get("workingHours"), list) and len(updated["workingHours"]) == 2

        # 4. Retrieve barber and validate updated fields
        resp = requests.get(f"{BASE_URL}/barbers/{barber_id}", headers=headers, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200 retrieving barber, got {resp.status_code}"
        retrieved = resp.json()
        assert retrieved.get("name") == update_payload["name"]
        assert retrieved.get("active") is False

        # 5. Deactivate barber explicitly if not already
        if retrieved.get("active") is True:
            deactivate_payload = {"active": False}
            resp = requests.patch(f"{BASE_URL}/barbers/{barber_id}", json=deactivate_payload, headers=headers, timeout=TIMEOUT)
            assert resp.status_code == 200, f"Expected 200 deactivating barber, got {resp.status_code}"
            deactivated = resp.json()
            assert deactivated.get("active") is False

    finally:
        # Cleanup: delete the barber
        if barber_id is not None:
            resp = requests.delete(f"{BASE_URL}/barbers/{barber_id}", headers=headers, timeout=TIMEOUT)
            assert resp.status_code in (200, 204, 202), f"Expected 2xx deleting barber, got {resp.status_code}"

test_barbers_crud_and_schedule_management()
