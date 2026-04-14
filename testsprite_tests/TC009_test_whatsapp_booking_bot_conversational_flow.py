import requests
import uuid
import time

BASE_URL = "http://localhost:3000/api"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30


def get_auth_token(email: str, password: str) -> str:
    login_payload = {"email": email, "password": password}
    resp = requests.post(f"{BASE_URL}/auth/login", json=login_payload, headers=HEADERS, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("accessToken")
    assert token, "Token not found in login response"
    return token


def test_whatsapp_booking_bot_conversational_flow():
    # Obtain admin auth token
    # Replace with valid admin credentials for the test environment
    admin_email = "admin@example.com"
    admin_password = "adminpassword"

    token = get_auth_token(admin_email, admin_password)
    auth_headers = {**HEADERS, "Authorization": f"Bearer {token}"}

    # Step 1: Simulate incoming WhatsApp message from a new phone number (auto-create client)
    phone_number = f"+1555{str(uuid.uuid4().int)[:8]}"  # Unique phone number
    message_id_1 = str(uuid.uuid4())
    incoming_message_1 = {
        "messageId": message_id_1,
        "from": phone_number,
        "text": "Hello, I want to book a haircut",
        "timestamp": int(time.time())
    }

    # Send incoming message to WhatsApp webhook endpoint
    resp_msg_1 = requests.post(
        f"{BASE_URL}/integrations/whatsapp/incoming",
        json=incoming_message_1,
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_msg_1.status_code in (200, 201), f"Failed to send incoming message: {resp_msg_1.text}"

    # Step 2: Confirm client was auto-created by querying clients by phone
    resp_clients = requests.get(
        f"{BASE_URL}/clients",
        params={"phone": phone_number},
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_clients.status_code == 200, f"Failed to get clients: {resp_clients.text}"
    clients = resp_clients.json()
    assert isinstance(clients, list) and len(clients) == 1, "Auto-created client not found"
    client_id = clients[0]["id"]

    # Step 3: Query available services proposed by the bot
    resp_services = requests.get(
        f"{BASE_URL}/services",
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_services.status_code == 200, f"Failed to get services: {resp_services.text}"
    services = resp_services.json()
    assert isinstance(services, list) and len(services) > 0, "No services found"
    service = services[0]
    service_id = service["id"]

    # Step 4: Query available slots for chosen service/barber via WhatsApp API (simulate bot proposing slots)
    resp_slots = requests.get(
        f"{BASE_URL}/integrations/whatsapp/slots",
        params={"serviceId": service_id},
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_slots.status_code == 200, f"Failed to get slots: {resp_slots.text}"
    slots = resp_slots.json()
    assert isinstance(slots, list) and len(slots) > 0, "No available slots found"
    slot = slots[0]
    slot_start = slot.get("start") or slot.get("start_time")
    assert slot_start is not None, "Slot start time missing"

    # Step 5: Send confirmation message from user with chosen slot and service
    message_id_2 = str(uuid.uuid4())
    confirm_message = {
        "messageId": message_id_2,
        "from": phone_number,
        "text": f"I confirm booking for service {service['name']} at {slot_start}",
        "timestamp": int(time.time())
    }
    resp_msg_2 = requests.post(
        f"{BASE_URL}/integrations/whatsapp/incoming",
        json=confirm_message,
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_msg_2.status_code in (200, 201), f"Failed to send confirmation message: {resp_msg_2.text}"

    # Step 6: Validate appointment creation by querying appointments for this client and slot
    resp_appointments = requests.get(
        f"{BASE_URL}/appointments",
        params={"clientId": client_id},
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_appointments.status_code == 200, f"Failed to get appointments: {resp_appointments.text}"
    appointments = resp_appointments.json()
    appointment = None
    for appt in appointments:
        if appt.get("serviceId") == service_id and appt.get("start") == slot_start:
            appointment = appt
            break
    assert appointment is not None, "Appointment not created with specified service and slot"
    appointment_id = appointment["id"]

    # Step 7: Verify conversation logs include all interactions and booking actions
    resp_conversations = requests.get(
        f"{BASE_URL}/integrations/whatsapp/conversations",
        params={"phone": phone_number},
        headers=auth_headers,
        timeout=TIMEOUT
    )
    assert resp_conversations.status_code == 200, f"Failed to get conversations: {resp_conversations.text}"
    conversations = resp_conversations.json()
    assert isinstance(conversations, list) and len(conversations) > 0, "No conversation logs found"
    messages_texts = [entry.get("text", "").lower() for entry in conversations]
    assert any("hello" in t for t in messages_texts), "Initial greeting message missing in logs"
    assert any("confirm" in t for t in messages_texts), "Confirmation message missing in logs"
    assert any("appointment" in str(entry.get("actions", "")) for entry in conversations), "Booking action missing in logs"

    # Cleanup: delete created appointment and client to keep test environment clean
    try:
        del_appt = requests.delete(
            f"{BASE_URL}/appointments/{appointment_id}",
            headers=auth_headers,
            timeout=TIMEOUT
        )
        assert del_appt.status_code in (200, 204), f"Failed to delete appointment: {del_appt.text}"
    finally:
        del_client = requests.delete(
            f"{BASE_URL}/clients/{client_id}",
            headers=auth_headers,
            timeout=TIMEOUT
        )
        assert del_client.status_code in (200, 204), f"Failed to delete client: {del_client.text}"


test_whatsapp_booking_bot_conversational_flow()
