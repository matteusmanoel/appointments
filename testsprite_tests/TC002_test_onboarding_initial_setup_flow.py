import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_onboarding_initial_setup_flow():
    url = f"{BASE_URL}/onboarding"
    headers = {
        "Content-Type": "application/json"
    }
    payload = {
        "name": "Barber Harmony",
        "phone": "+1234567890",
        "email": "contact@barberharmony.com",
        "address": "123 Barber St, Hair City"
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 200 or response.status_code == 201, f"Unexpected status code: {response.status_code}"
        json_response = response.json()
        # Check for confirmation and indication of access to admin dashboard
        assert "confirmation" in json_response or "message" in json_response or "dashboardAccess" in json_response, "No confirmation or dashboard access info found in response"
        # Optional: check response content if known message keys exist
        if "confirmation" in json_response:
            assert json_response["confirmation"] == "Setup successful"
        if "dashboardAccess" in json_response:
            assert json_response["dashboardAccess"] is True
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    except ValueError:
        assert False, "Response body is not valid JSON"

test_onboarding_initial_setup_flow()
