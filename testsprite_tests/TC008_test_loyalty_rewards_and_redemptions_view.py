import requests

BASE_URL = "http://localhost:3000/api"
TIMEOUT = 30


def test_loyalty_rewards_and_redemptions_view():
    """
    Confirm that the loyalty section allows viewing the list of rewards and past redemptions in a read-only manner via the loyalty API.
    """
    login_url = f"{BASE_URL}/auth/login"
    credentials = {
        "email": "admin@example.com",
        "password": "adminpassword"
    }
    headers = {
        "Accept": "application/json",
    }

    # Authenticate first to get token
    try:
        resp_login = requests.post(login_url, json=credentials, headers=headers, timeout=TIMEOUT)
        resp_login.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Failed to login: {e}"
    login_data = resp_login.json()
    assert "token" in login_data, "Login response missing 'token'"
    token = login_data["token"]

    auth_headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}"
    }

    rewards_url = f"{BASE_URL}/loyalty/rewards"
    redemptions_url = f"{BASE_URL}/loyalty/redemptions"

    # Get rewards list
    try:
        resp_rewards = requests.get(rewards_url, headers=auth_headers, timeout=TIMEOUT)
        resp_rewards.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Failed to GET rewards list: {e}"
    rewards_data = resp_rewards.json()
    assert isinstance(rewards_data, list), "Rewards response is not a list"
    for reward in rewards_data:
        assert isinstance(reward, dict), "Each reward should be an object"
        # Basic keys check (assuming id and name exist)
        assert "id" in reward, "Reward missing 'id'"
        assert "name" in reward, "Reward missing 'name'"

    # Get past redemptions list
    try:
        resp_redemptions = requests.get(redemptions_url, headers=auth_headers, timeout=TIMEOUT)
        resp_redemptions.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Failed to GET redemptions list: {e}"
    redemptions_data = resp_redemptions.json()
    assert isinstance(redemptions_data, list), "Redemptions response is not a list"
    for redemption in redemptions_data:
        assert isinstance(redemption, dict), "Each redemption should be an object"
        # Basic keys check (assuming id, rewardId, clientId, date exist)
        assert "id" in redemption, "Redemption missing 'id'"
        assert "rewardId" in redemption, "Redemption missing 'rewardId'"
        assert "clientId" in redemption, "Redemption missing 'clientId'"
        assert "date" in redemption, "Redemption missing 'date'"


test_loyalty_rewards_and_redemptions_view()