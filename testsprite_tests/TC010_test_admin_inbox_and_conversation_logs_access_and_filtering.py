import requests
from datetime import datetime, timedelta

BASE_URL = "http://localhost:3000"
API_BASE = f"{BASE_URL}/api"
TIMEOUT = 30

# Assumed admin credentials for login since authentication is required for admin access
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin_password"

def test_admin_inbox_and_conversation_logs_access_and_filtering():
    session = requests.Session()
    try:
        # 1. Admin login to get JWT token
        login_payload = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        login_resp = session.post(f"{API_BASE}/auth/login", json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token received after login"

        headers = {"Authorization": f"Bearer {token}"}

        # 2. Access internal inbox - list conversations
        inbox_resp = session.get(f"{API_BASE}/integrations/whatsapp/inbox", headers=headers, timeout=TIMEOUT)
        assert inbox_resp.status_code == 200, f"Failed to get inbox: {inbox_resp.text}"
        inbox_data = inbox_resp.json()
        assert isinstance(inbox_data, list), "Inbox response should be a list of conversations"
        assert len(inbox_data) > 0, "Inbox should contain at least one conversation"

        # Extract a conversation with phone and timestamp to test conversation thread access and filtering
        conversation = inbox_data[0]
        phone = conversation.get("phone")
        convo_id = conversation.get("id")
        timestamp_field = conversation.get("updatedAt") or conversation.get("timestamp")
        assert phone, "Conversation phone number missing"
        assert convo_id, "Conversation id missing"
        assert timestamp_field, "Conversation timestamp missing"

        # 3. Open a conversation thread by conversation id
        convo_resp = session.get(f"{API_BASE}/integrations/whatsapp/inbox/{convo_id}", headers=headers, timeout=TIMEOUT)
        assert convo_resp.status_code == 200, f"Failed to get conversation thread: {convo_resp.text}"
        convo_data = convo_resp.json()
        # Validate conversation entries contain messages with timestamps and actions
        messages = convo_data.get("messages") or convo_data.get("entries")
        assert isinstance(messages, list), "Conversation messages should be a list"
        assert any("timestamp" in m for m in messages), "Conversation entries must include timestamps"
        # Actions like client created or appointment created logged?
        assert any(("action" in m or "type" in m) for m in messages), "Conversation entries should include action metadata"

        # 4. Filter/search conversation logs by phone
        filter_phone_resp = session.get(f"{API_BASE}/integrations/whatsapp/inbox", params={"phone": phone}, headers=headers, timeout=TIMEOUT)
        assert filter_phone_resp.status_code == 200, f"Failed to filter inbox by phone: {filter_phone_resp.text}"
        filtered_by_phone = filter_phone_resp.json()
        assert all(phone in c.get("phone", "") for c in filtered_by_phone), "Filtering by phone should return matching conversations"

        # 5. Filter/search conversation logs by date range
        # Use timestamp of existing conversation to build date filter
        # Assuming API supports params like startDate and endDate in ISO8601 format
        dt = None
        try:
            dt = datetime.fromisoformat(timestamp_field.rstrip("Z"))
        except Exception:
            # Try to parse alternatives or fallback to now
            dt = datetime.utcnow()
        start_date = (dt - timedelta(days=1)).isoformat()
        end_date = (dt + timedelta(days=1)).isoformat()
        filter_date_resp = session.get(f"{API_BASE}/integrations/whatsapp/inbox", params={"startDate": start_date, "endDate": end_date}, headers=headers, timeout=TIMEOUT)
        assert filter_date_resp.status_code == 200, f"Failed to filter inbox by date: {filter_date_resp.text}"
        filtered_by_date = filter_date_resp.json()
        # Check filtered conversations have timestamps within range
        for c in filtered_by_date:
            c_time_str = c.get("updatedAt") or c.get("timestamp")
            assert c_time_str, "Filtered conversation missing timestamp"
            c_time = None
            try:
                c_time = datetime.fromisoformat(c_time_str.rstrip("Z"))
            except Exception:
                continue
            assert (dt - timedelta(days=1)) <= c_time <= (dt + timedelta(days=1)), "Filtered conversation outside date range"

    finally:
        session.close()

test_admin_inbox_and_conversation_logs_access_and_filtering()