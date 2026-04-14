import requests

BASE_URL = "http://localhost:3000/api"
TIMEOUT = 30


def test_clients_management_and_search():
    headers = {"Content-Type": "application/json"}
    client_data = {"name": "Test Client", "phone": "+12345678901"}

    # Create a new client
    client_id = None
    try:
        response = requests.post(
            f"{BASE_URL}/clients",
            json=client_data,
            headers=headers,
            timeout=TIMEOUT
        )
        assert response.status_code == 201, f"Failed to create client: {response.text}"
        client = response.json()
        assert "id" in client, "Response missing client ID"
        client_id = client["id"]
        assert client["name"] == client_data["name"], "Client name mismatch"
        assert client["phone"] == client_data["phone"], "Client phone mismatch"

        # Search client by phone
        search_response = requests.get(
            f"{BASE_URL}/clients",
            params={"phone": client_data["phone"]},
            headers=headers,
            timeout=TIMEOUT
        )
        assert search_response.status_code == 200, f"Search by phone failed: {search_response.text}"
        clients = search_response.json()
        assert any(c["id"] == client_id for c in clients), "Created client not found by phone search"

        # Search client by name
        search_response = requests.get(
            f"{BASE_URL}/clients",
            params={"name": client_data["name"]},
            headers=headers,
            timeout=TIMEOUT
        )
        assert search_response.status_code == 200, f"Search by name failed: {search_response.text}"
        clients = search_response.json()
        assert any(c["id"] == client_id for c in clients), "Created client not found by name search"

        # View client visit and spending history
        history_response = requests.get(
            f"{BASE_URL}/clients/{client_id}/history",
            headers=headers,
            timeout=TIMEOUT
        )
        assert history_response.status_code == 200, f"Failed to get client history: {history_response.text}"
        history = history_response.json()
        # Expecting keys like 'visits' and 'spendings' or similar; check response structure
        assert isinstance(history, dict), "Client history response not a JSON object"
        assert "visits" in history, "Client history missing 'visits'"
        assert "spendings" in history, "Client history missing 'spendings'"

    finally:
        # Cleanup: Delete the created client if it was created
        if client_id:
            try:
                del_response = requests.delete(
                    f"{BASE_URL}/clients/{client_id}",
                    headers=headers,
                    timeout=TIMEOUT
                )
                assert del_response.status_code in (200, 204), f"Failed to delete client: {del_response.text}"
            except Exception as e:
                # Log or re-raise if needed; here we just pass
                pass


test_clients_management_and_search()