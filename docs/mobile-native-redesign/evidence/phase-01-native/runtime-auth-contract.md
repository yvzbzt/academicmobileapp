# Sanitized Runtime Authentication Contract Evidence

Date: 2026-07-29 (+03:00)\
Runtime: local in-memory development API at `http://127.0.0.1:3000`
Data policy: isolated synthetic records only; no address, password, verification/recovery code, access token, refresh token, or other secret was printed or retained in this document.

One uninterrupted API process was used for the full sequence. The runner registered and verified a synthetic account, created two refresh sessions under distinct device identifiers, requested password recovery for that known account and a separate unknown synthetic address, reset the known account password, and then retried both previously issued refresh sessions.

| Observation | Result |
|---|---|
| Registration | HTTP 201 |
| Verification | HTTP 201 |
| Client A Login | HTTP 201 |
| Client B Login | HTTP 201 |
| Known-account recovery request | HTTP 201 |
| Unknown-account recovery request | HTTP 201 |
| Known/unknown public `status`, `message`, `expiresInSeconds`, and `resendAfterSeconds` fields | Identical: `True` |
| Development preview shape, known fixture | Six digits: `True` |
| Development preview shape, unknown decoy fixture | Six digits: `True` |
| Password reset | HTTP 201 |
| Client A pre-reset refresh session after reset | HTTP 401, `AUTH_SESSION_INVALID` |
| Client B pre-reset refresh session after reset | HTTP 401, `AUTH_SESSION_INVALID` |
| API restart between Login and rejection | No |
| Secrets printed | `False` |

Result: **PASS within the tested contract boundary.** The production-shaped public status/body fields did not directly reveal account existence, and successful password reset revoked every pre-existing refresh session exercised in the same runtime. Request latency was neither measured nor equalized, so timing-based inference remains an open risk. This is backend/session-contract evidence; it does not imply that two Android emulators were used.
