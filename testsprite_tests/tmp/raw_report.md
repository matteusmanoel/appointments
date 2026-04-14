
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** barber-harmony
- **Date:** 2026-04-13
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 test_admin_login_with_valid_and_invalid_credentials
- **Test Code:** [TC001_test_admin_login_with_valid_and_invalid_credentials.py](./TC001_test_admin_login_with_valid_and_invalid_credentials.py)
- **Test Error:** Traceback (most recent call last):
  File "<string>", line 33, in test_admin_login_with_valid_and_invalid_credentials
AssertionError: Expected 200 for valid login, got 401

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 57, in <module>
  File "<string>", line 37, in test_admin_login_with_valid_and_invalid_credentials
AssertionError: Valid credentials login test failed: Expected 200 for valid login, got 401

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/bd3afa34-9aa9-4d18-9477-a8e6ac0cd5a4
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 test_onboarding_initial_setup_flow
- **Test Code:** [TC002_test_onboarding_initial_setup_flow.py](./TC002_test_onboarding_initial_setup_flow.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 34, in <module>
  File "<string>", line 20, in test_onboarding_initial_setup_flow
AssertionError: Unexpected status code: 404

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/a3a6d54b-a1b9-4e9c-958b-82781191521e
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 test_establishment_settings_update
- **Test Code:** [TC003_test_establishment_settings_update.py](./TC003_test_establishment_settings_update.py)
- **Test Error:** Traceback (most recent call last):
  File "<string>", line 19, in get_auth_token
  File "/var/lang/lib/python3.12/site-packages/requests/models.py", line 1024, in raise_for_status
    raise HTTPError(http_error_msg, response=self)
requests.exceptions.HTTPError: 401 Client Error: Unauthorized for url: http://localhost:3000/api/auth/login

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 88, in <module>
  File "<string>", line 28, in test_establishment_settings_update
  File "<string>", line 25, in get_auth_token
RuntimeError: Failed to authenticate admin: 401 Client Error: Unauthorized for url: http://localhost:3000/api/auth/login

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/e4189d63-674c-44b2-a1a8-2a554e39f0d3
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 test_barbers_crud_and_schedule_management
- **Test Code:** [TC004_test_barbers_crud_and_schedule_management.py](./TC004_test_barbers_crud_and_schedule_management.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 81, in <module>
  File "<string>", line 35, in test_barbers_crud_and_schedule_management
AssertionError: Expected 201 on barber creation, got 401

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/36ffe45b-0da5-49d7-a30b-70f315197a23
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 test_services_crud_operations
- **Test Code:** [TC005_test_services_crud_operations.py](./TC005_test_services_crud_operations.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 86, in <module>
  File "<string>", line 29, in test_services_crud_operations
AssertionError: Service creation failed: {"error":"Invalid or expired token"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/f74f2cb2-98ed-4c6f-a28b-41ff296284b5
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 test_clients_management_and_search
- **Test Code:** [TC006_test_clients_management_and_search.py](./TC006_test_clients_management_and_search.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 77, in <module>
  File "<string>", line 20, in test_clients_management_and_search
AssertionError: Failed to create client: {"error":"Unauthorized"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/f79ccacf-08e4-4d11-b33e-807ffe63c75c
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 test_appointments_create_edit_cancel_with_conflict_rule
- **Test Code:** [TC007_test_appointments_create_edit_cancel_with_conflict_rule.py](./TC007_test_appointments_create_edit_cancel_with_conflict_rule.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 144, in <module>
  File "<string>", line 13, in test_appointments_create_edit_cancel_with_conflict_rule
AssertionError: Login failed: {"error":"Invalid email or password"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/05f1cc21-3783-42d5-ad16-cc8126d11de1
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 test_loyalty_rewards_and_redemptions_view
- **Test Code:** [TC008_test_loyalty_rewards_and_redemptions_view.py](./TC008_test_loyalty_rewards_and_redemptions_view.py)
- **Test Error:** Traceback (most recent call last):
  File "<string>", line 23, in test_loyalty_rewards_and_redemptions_view
  File "/var/lang/lib/python3.12/site-packages/requests/models.py", line 1024, in raise_for_status
    raise HTTPError(http_error_msg, response=self)
requests.exceptions.HTTPError: 401 Client Error: Unauthorized for url: http://localhost:3000/api/auth/login

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 69, in <module>
  File "<string>", line 25, in test_loyalty_rewards_and_redemptions_view
AssertionError: Failed to login: 401 Client Error: Unauthorized for url: http://localhost:3000/api/auth/login

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/a6e791b7-a11d-42fd-97b9-507659e85d91
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009 test_whatsapp_booking_bot_conversational_flow
- **Test Code:** [TC009_test_whatsapp_booking_bot_conversational_flow.py](./TC009_test_whatsapp_booking_bot_conversational_flow.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 151, in <module>
  File "<string>", line 26, in test_whatsapp_booking_bot_conversational_flow
  File "<string>", line 13, in get_auth_token
AssertionError: Login failed: {"error":"Invalid email or password"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/771898ff-1639-4aa4-8e96-4823c2cff478
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 test_admin_inbox_and_conversation_logs_access_and_filtering
- **Test Code:** [TC010_test_admin_inbox_and_conversation_logs_access_and_filtering.py](./TC010_test_admin_inbox_and_conversation_logs_access_and_filtering.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 85, in <module>
  File "<string>", line 18, in test_admin_inbox_and_conversation_logs_access_and_filtering
AssertionError: Login failed: {"error":"Invalid email or password"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/7040963c-ae7c-411b-a6f9-81ce3751778b/914e4434-671f-4ccf-b2fb-4137e7922162
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **0.00** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---