import requests

BASE_URL = "http://localhost:3000/api"
TIMEOUT = 30
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer valid_admin_token_here"
}

def test_services_crud_operations():
    session = requests.Session()
    session.headers.update(HEADERS)

    service_id = None

    try:
        # Step 1: Create a new service
        create_payload = {
            "name": "Test Service",
            "duration": 30,  # minutes
            "price": 25.00,
            "category": "Haircut"
        }
        create_resp = session.post(
            f"{BASE_URL}/services",
            json=create_payload,
            timeout=TIMEOUT
        )
        assert create_resp.status_code == 201, f"Service creation failed: {create_resp.text}"

        created_service = create_resp.json()
        assert "id" in created_service, "Created service response missing 'id'"
        assert created_service["name"] == create_payload["name"]
        assert created_service["duration"] == create_payload["duration"]
        assert float(created_service["price"]) == create_payload["price"]
        service_id = created_service["id"]

        # Step 2: Update the service price and duration
        update_payload = {
            "price": 30.00,
            "duration": 45
        }
        update_resp = session.put(
            f"{BASE_URL}/services/{service_id}",
            json=update_payload,
            timeout=TIMEOUT
        )
        assert update_resp.status_code == 200, f"Service update failed: {update_resp.text}"

        updated_service = update_resp.json()
        assert "price" in updated_service and float(updated_service["price"]) == update_payload["price"], \
            "Service price update mismatch"
        assert "duration" in updated_service and updated_service["duration"] == update_payload["duration"], \
            "Service duration update mismatch"

        # Step 3: List services and verify the updated service is present with correct details
        list_resp = session.get(
            f"{BASE_URL}/services",
            timeout=TIMEOUT
        )
        assert list_resp.status_code == 200, f"Listing services failed: {list_resp.text}"

        services = list_resp.json()
        assert isinstance(services, list), "Services listing response is not a list"

        matched_services = [s for s in services if s.get("id") == service_id]
        assert len(matched_services) == 1, "Updated service not found in services listing"

        service_in_list = matched_services[0]
        assert service_in_list["name"] == create_payload["name"], "Service name mismatch in listing"
        assert float(service_in_list["price"]) == update_payload["price"], "Service price mismatch in listing"
        assert service_in_list["duration"] == update_payload["duration"], "Service duration mismatch in listing"

    finally:
        # Clean up: delete the created service if it exists
        if service_id:
            try:
                del_resp = session.delete(
                    f"{BASE_URL}/services/{service_id}",
                    timeout=TIMEOUT
                )
                assert del_resp.status_code in (200, 204), f"Deleting service failed: {del_resp.text}"
            except Exception:
                pass

test_services_crud_operations()
