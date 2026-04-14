import requests
from datetime import datetime, timedelta
import time

BASE_URL = "http://localhost:3000/api"
TIMEOUT = 30
HEADERS = {"Content-Type": "application/json"}

def test_appointments_create_edit_cancel_with_conflict_rule():
    # Authenticate to get token
    login_payload = {"email": "admin@example.com", "password": "adminpassword"}
    r_login = requests.post(f"{BASE_URL}/auth/login", json=login_payload, headers=HEADERS, timeout=TIMEOUT)
    assert r_login.status_code == 200, f"Login failed: {r_login.text}"
    token = r_login.json().get("token")
    assert token, "No token found in login response"

    auth_headers = HEADERS.copy()
    auth_headers["Authorization"] = f"Bearer {token}"

    def create_barber(name="Test Barber"):
        payload = {"name": name, "workingHours": [{"day": "Monday", "start": "09:00", "end": "17:00"}]}
        r = requests.post(f"{BASE_URL}/barbers", json=payload, headers=auth_headers, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()["id"]

    def delete_barber(barber_id):
        requests.delete(f"{BASE_URL}/barbers/{barber_id}", headers=auth_headers, timeout=TIMEOUT)

    def create_service(name="Test Service", duration=30, price=25.0):
        payload = {"name": name, "duration": duration, "price": price}
        r = requests.post(f"{BASE_URL}/services", json=payload, headers=auth_headers, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()["id"]

    def delete_service(service_id):
        requests.delete(f"{BASE_URL}/services/{service_id}", headers=auth_headers, timeout=TIMEOUT)

    def create_client(name="Test Client", phone="+1234567890"):
        payload = {"name": name, "phone": phone}
        r = requests.post(f"{BASE_URL}/clients", json=payload, headers=auth_headers, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()["id"]

    def delete_client(client_id):
        requests.delete(f"{BASE_URL}/clients/{client_id}", headers=auth_headers, timeout=TIMEOUT)

    def create_appointment(barber_id, service_id, client_id, start_time):
        payload = {
            "barberId": barber_id,
            "serviceId": service_id,
            "clientId": client_id,
            "startTime": start_time.isoformat(),
        }
        r = requests.post(f"{BASE_URL}/appointments", json=payload, headers=auth_headers, timeout=TIMEOUT)
        return r

    def get_appointment(appointment_id):
        r = requests.get(f"{BASE_URL}/appointments/{appointment_id}", headers=auth_headers, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()

    def update_appointment(appointment_id, update_payload):
        r = requests.put(f"{BASE_URL}/appointments/{appointment_id}", json=update_payload, headers=auth_headers, timeout=TIMEOUT)
        return r

    def cancel_appointment(appointment_id):
        payload = {"status": "cancelled"}
        r = requests.put(f"{BASE_URL}/appointments/{appointment_id}", json=payload, headers=auth_headers, timeout=TIMEOUT)
        return r

    def delete_appointment(appointment_id):
        requests.delete(f"{BASE_URL}/appointments/{appointment_id}", headers=auth_headers, timeout=TIMEOUT)

    barber_id = None
    service_id = None
    client_id = None
    appointment1_id = None
    appointment2_id = None

    try:
        barber_id = create_barber()
        service_id = create_service()
        client_id = create_client()

        now = datetime.utcnow()
        slot1 = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        slot2 = slot1 + timedelta(minutes=30)  # 30 minutes after slot1

        r1 = create_appointment(barber_id, service_id, client_id, slot1)
        assert r1.status_code == 201, f"Create appointment1 failed: {r1.text}"
        appointment1_id = r1.json()["id"]

        r2 = create_appointment(barber_id, service_id, client_id, slot1)
        assert r2.status_code in (400, 409), "Expected scheduling conflict error when booking same slot for barber"
        assert "conflict" in r2.text.lower() or "already booked" in r2.text.lower()

        r3 = create_appointment(barber_id, service_id, client_id, slot2)
        assert r3.status_code == 201, f"Create appointment2 failed: {r3.text}"
        appointment2_id = r3.json()["id"]

        new_slot = slot2 + timedelta(minutes=30)
        update_payload = {"startTime": new_slot.isoformat()}
        r4 = update_appointment(appointment1_id, update_payload)
        assert r4.status_code == 200, f"Update appointment1 failed: {r4.text}"
        updated_appointment = get_appointment(appointment1_id)
        assert updated_appointment["startTime"].startswith(new_slot.isoformat()[:16]), "Appointment startTime not updated properly"

        r5 = update_appointment(appointment2_id, {"startTime": new_slot.isoformat()})
        assert r5.status_code in (400, 409), "Expected conflict error when editing appointment to occupied slot"
        assert "conflict" in r5.text.lower() or "already booked" in r5.text.lower()

        r6 = cancel_appointment(appointment1_id)
        assert r6.status_code == 200, f"Cancel appointment1 failed: {r6.text}"
        cancelled_appointment = get_appointment(appointment1_id)
        assert cancelled_appointment.get("status") == "cancelled", "Appointment status not updated to cancelled"

    finally:
        if appointment1_id:
            try:
                delete_appointment(appointment1_id)
            except Exception:
                pass
        if appointment2_id:
            try:
                delete_appointment(appointment2_id)
            except Exception:
                pass
        if client_id:
            try:
                delete_client(client_id)
            except Exception:
                pass
        if service_id:
            try:
                delete_service(service_id)
            except Exception:
                pass
        if barber_id:
            try:
                delete_barber(barber_id)
            except Exception:
                pass

test_appointments_create_edit_cancel_with_conflict_rule()