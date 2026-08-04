# Security Hardening Plan

This document follows OWASP ASVS, OWASP API Security Top 10 and OWASP Mobile guidance at a pragmatic MVP level.

> **Current Phase 1–8 security status — 4 August 2026.** MongoDB is the only API runtime database. Credential generations are enforced across access, refresh, and recovery material. Password reset commits the password hash, generation advance, accepted-attempt completion, and password-bound idempotency in one standalone-Mongo compare-and-set; stale records are invalid at that commit. Recovery requests use comparable work, a 350 ms production response floor, bounded asynchronous SMTP delivery, and identical public fields for known, unknown, and cooldown cases. Destructive endpoints require single-use, purpose-specific recent-authentication proofs that are atomically consumed before controller execution; a consumed proof is not restored when the later deletion action fails. The explicitly labelled Task A1 text below is retained only as historical design evidence.

## 1. Authentication Findings

### Weak Password Or Brute Force

| Field | Value |
|---|---|
| Risk Level | High |
| Affected Module | Auth |
| Exploit Scenario | Attacker automates login attempts against common student emails. |
| Technical Impact | Account takeover and notification preference manipulation. |
| Solution | Strong password policy, login throttling, suspicious session logging. |
| Code-Level Control | DTO validation, rate limit guard, password hash with Argon2 or bcrypt. |
| Test Scenario | Repeated failed login attempts return 429 after configured threshold. |
| Priority | P0 |

### Refresh Token Reuse

| Field | Value |
|---|---|
| Risk Level | High |
| Affected Module | Auth, refresh_tokens |
| Exploit Scenario | Stolen refresh token is reused after rotation. |
| Technical Impact | Persistent unauthorized session. |
| Solution | Store token hash, rotate on every refresh, revoke token family on reuse. |
| Code-Level Control | Unique token family id and revokedAt checks in refresh flow. |
| Test Scenario | Old refresh token fails after one successful refresh. |
| Priority | P0 |

### Controlled Authentication API Contract

The public authentication error-code source is `apps/api/src/modules/auth/auth.constants.ts`. The HTTP status and human-readable `message` remain present as compatibility fields; clients must branch on `errorCode` and must not display an unrecognized server payload directly.

Controlled `401` authentication failures use this JSON shape:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "errorCode": "AUTH_INVALID_CREDENTIALS",
  "message": "Invalid credentials."
}
```

Controlled rate-limit failures use the same base shape with status `429`, `error` set to `Too Many Requests`, and `errorCode` set to `AUTH_RATE_LIMITED`.

| Error code | HTTP status | Endpoint/condition |
|---|---:|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | `POST /auth/login` when the account does not exist or the password is wrong. Both cases intentionally return the same contract. |
| `AUTH_EMAIL_NOT_VERIFIED` | 401 | `POST /auth/login` when valid credentials belong to an unverified account. |
| `AUTH_VERIFICATION_CODE_INVALID` | 401 | `POST /auth/verify-email` when the four-digit code, email, ownership or consumption state is invalid. |
| `AUTH_VERIFICATION_CODE_EXPIRED` | 401 | `POST /auth/verify-email` when the code exists but its expiration time has passed. |
| `AUTH_VERIFICATION_REQUEST_INVALID` | 401 | `POST /auth/resend-verification-code` when no resumable unverified account exists for the supplied email. This unauthenticated recovery outcome is not a session-expired error. |
| `AUTH_SESSION_INVALID` | 401 | `POST /auth/refresh-token` when the refresh token is unknown, revoked/reused, or no longer belongs to an existing user. Reuse details are not exposed. |
| `AUTH_SESSION_EXPIRED` | 401 | `POST /auth/refresh-token` when the refresh token has expired. |
| `AUTH_ACCOUNT_DISABLED` | 401 | `POST /auth/login`, `POST /auth/google`, or `POST /auth/refresh-token` when the resolved account is disabled or locked. |
| `AUTH_RATE_LIMITED` | 429 | A catalogued `/auth/*` endpoint exceeds its request budget, or verification resend is attempted before its cooldown ends. |
| `AUTH_VERIFICATION_TOKEN_INVALID` | 401 service result | Invalid email-verification link token. The current `GET /auth/verify-email` browser route converts this to generic `400` HTML and does not expose the JSON code. |
| `AUTH_VERIFICATION_TOKEN_EXPIRED` | 401 service result | Expired email-verification link token. The current `GET /auth/verify-email` browser route converts this to generic `400` HTML and does not expose the JSON code. |

Not every validation or provider error has an `errorCode`. Clients must use safe endpoint-specific fallback copy for unknown codes and for standard Nest validation responses.

The endpoint catalog applies a strict rate policy of 10 requests per 60 seconds per client/route key to `POST /auth/register`, both `GET` and `POST /auth/verify-email`, `POST /auth/login`, `POST /auth/google`, `POST /auth/resend-verification-code`, both password-recovery routes, and `POST /auth/refresh-token`. `POST /auth/logout` uses the standard authenticated policy of 120 requests per 60 seconds.

`POST /auth/resend-verification-code` accepts an email address and returns the same result contract as registration. A newly issued verification code expires after 10 minutes, and another resend becomes available after 60 seconds. Successful registration and resend responses include those ISO-8601 timing fields:

```json
{
  "status": "verification_required",
  "email": "student@example.com",
  "verificationExpiresAt": "2026-07-29T10:20:00.000Z",
  "resendAvailableAt": "2026-07-29T10:11:00.000Z"
}
```

The response may also contain `previewVerificationToken` in non-production or explicitly enabled throwaway environments. It must not be enabled in production.

When resend is still cooling down, the `429` response preserves the original top-level timestamp and also provides structured details:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "errorCode": "AUTH_RATE_LIMITED",
  "message": "Please wait before requesting another verification code.",
  "resendAvailableAt": "2026-07-29T10:11:00.000Z",
  "details": {
    "resendAvailableAt": "2026-07-29T10:11:00.000Z"
  }
}
```

Registration passwords are strings with a minimum length of 10 JavaScript UTF-16 code units; the input string is not trimmed. `passwordConfirmation` is required and must match. The shared backend value is exported as `AUTH_PASSWORD_MIN_LENGTH`. No additional password-complexity rule is currently enforced by the API.

### Historical Credential-Generation Persistence Substrate (Phase 1 Task A1)

> **Historical checkpoint, superseded:** this subsection records the additive Task A1 substrate before generation enforcement, reset compare-and-set completion, recovery timing work, and recent authentication were implemented. It is not current release behavior.

The auth persistence contract contains a non-negative integer `credentialGeneration` on user, refresh-token, and password-recovery records. Repository reads interpret a missing legacy value as `0`; new users initialize the field to `0`. When the service creates a refresh-token or password-recovery record, it stamps the current user's generation onto that record.

Task A1 makes every existing-user writer generation-safe without advancing the value:

- Mongo retains partial `$set`/`$unset` updates and strips `credentialGeneration` from the general user-update input before writing. No user path replaces the whole Mongo document with a stale domain object.
- The in-memory test adapter takes the current map entry and writes its replacement synchronously, with no internal await between read and write. This prevents a delayed user object from restoring an older generation while the adapter remains runtime-unreachable pending R1C2.

The protected writer set includes verification, Google identity, administrative changes, profile changes, password changes, academic selection, app-data clearing, admin deletion, and account deletion/anonymization. There is no production migration, new index, or new environment setting for this additive field; legacy data remains usable as generation `0`.

R1C1 removed the API's Firestore database service and repository adapters. Historical A1 evidence for that retired adapter remains in the dated Phase 1 records, but Mongo is now the only production implementation of this persistence contract. Firebase Authentication, Google identity verification, FCM, and Hosting remain separate supported services.

At this historical checkpoint the substrate was not yet a revocation boundary: Task A1 did not increment `credentialGeneration`, reject a refresh/recovery record on a mismatch, change password-reset ordering, or alter access-token validation. Those limitations were later closed by the current controls summarized above; they are not open release defects.

### Password-Recovery API And Storage Contract

Password recovery is a two-step public contract. Both routes use the strict endpoint-catalog rate policy: at most 10 requests per 60 seconds for each client/route key. A limit breach returns HTTP `429` with `AUTH_RATE_LIMITED`; production proxy trust/client-IP configuration remains a deployment gate.

#### `POST /auth/password-recovery/request`

The request body contains one syntactically valid `email` field. In production, every valid known or unknown address—including a known account still inside its resend cooldown and an eligible account whose mail delivery fails—receives HTTP `201` with the same stable JSON fields and values:

```json
{
  "status": "recovery_requested",
  "message": "If an eligible account exists, recovery instructions will be sent.",
  "expiresInSeconds": 600,
  "resendAfterSeconds": 60
}
```

This status/body contract must not disclose whether an account exists, whether it is eligible, whether a cooldown record exists, or whether SMTP delivery succeeded. Current known, unknown, and cooldown paths perform comparable token/hash/lookup/repository work, use a 350 ms production response floor, and do not await SMTP in the public request. Delivery runs asynchronously with a 12-second bound and bounded SMTP connection, greeting, and socket timeouts. This closes the previously documented application-level timing gap without claiming an internet-wide statistical indistinguishability proof. A malformed email can still receive the standard DTO-validation `400`; that is input validation, not an account-existence result.

In non-production only, the response also contains a random six-digit `previewRecoveryCode` for isolated development/test flows. Known and unknown responses therefore have the same non-production shape but different random preview values. A preview is confirmable only when a known eligible account outside cooldown caused its digest record to be persisted; unknown/cooldown previews are deliberate unusable decoys. `previewRecoveryCode` is guarded solely by `NODE_ENV !== "production"`; no flag can enable it in production. It must never be logged, copied into documentation evidence, analytics, screenshots with real identities, or a production response.

For an eligible known account outside cooldown, the service:

1. invalidates every older still-active recovery record for that user;
2. creates a cryptographically random six-digit code with a ten-minute lifetime and a sixty-second resend cooldown;
3. persists only an email-domain-separated HMAC-SHA-256 digest plus user ID and timestamps; and
4. attempts delivery without changing the generic public result when delivery fails.

The HMAC input domain is `password-recovery:<normalized-email>:<code>`. Production fails closed unless `PASSWORD_RECOVERY_TOKEN_PEPPER`, or the `JWT_ACCESS_SECRET` fallback, supplies at least 32 characters. A dedicated recovery pepper is preferred so recovery-digest rotation is independent of access-token signing.

#### `POST /auth/password-recovery/confirm`

The request contains `email`, the six-digit `code`, `newPassword`, and `passwordConfirmation`. Do not place any of those values in logs or examples. Success returns HTTP `201`:

```json
{
  "status": "password_reset"
}
```

| Error code | HTTP status | Safe condition |
|---|---:|---|
| `AUTH_PASSWORD_RECOVERY_CODE_INVALID` | 401 | Code format, digest lookup, ownership, prior consumption/invalidation, or final account update is invalid. The response does not distinguish those cases. |
| `AUTH_PASSWORD_RECOVERY_CODE_EXPIRED` | 401 | A matching record owned by the supplied account exists, is unconsumed and non-invalidated, but its ten-minute lifetime has ended. |
| `AUTH_PASSWORD_CONFIRMATION_MISMATCH` | 400 | `newPassword` and `passwordConfirmation` differ. |
| `AUTH_PASSWORD_INVALID` | 400 | The new password is shorter than the shared minimum of ten JavaScript UTF-16 code units. The input string is not trimmed. |
| `AUTH_RATE_LIMITED` | 429 | The strict per-client/route request budget is exceeded. |

Password reset is committed by one Mongo user-document compare-and-set constrained by owner, accepted recovery token, and expected credential generation. That security write replaces the password hash, increments the generation once, and records the password-bound completion operation while consuming/superseding the accepted attempt. Concurrent records cannot both commit; an identical response-loss retry is deterministic, while a different proposed password is not reported as success. Older access, refresh, and recovery material is logically invalid as soon as the generation advances. Best-effort physical cleanup after that point is not part of the security boundary and cannot restore stale credentials.

Security tests cover identical known/unknown/cooldown public fields, comparable request work and the response floor, six-digit CSPRNG shape without raw-code persistence, production preview suppression/fail-closed secret configuration, bounded asynchronous SMTP, cooldown and strict rate limits, older-active-material invalidation, invalid/expired/single-use confirmation, password parity/mismatch, compare-and-set concurrency/idempotency, old/new password behavior, generation-based all-session invalidation, and absence of recovery secrets or personal values in logs/results.

### Recent Authentication For Destructive Operations

`POST /auth/recent-authentication` accepts one explicit purpose, `delete_personal_data` or `delete_account`, and verifies the current account's supported password or Google credential. The signed short-lived proof is bound to the owner, current credential generation, purpose, and a cryptographically random `jti`. MongoDB stores only a digest of that `jti` with the binding fields and created, expiry, and consumption timestamps; expired records have a TTL index.

`RecentAuthGuard` atomically consumes the matching unconsumed record before either destructive controller action runs. A proof therefore cannot be reused, crossed between deletion purposes, moved between owners or generations, or accepted by two racing requests. Because consumption precedes controller execution, a later destructive-action failure leaves the proof consumed and the user must reauthenticate before retrying. Proof tokens, `jti` values, credentials, emails, and deletion payloads must never enter logs.

## 2. Authorization Findings

### IDOR On User-Owned Resources

| Field | Value |
|---|---|
| Risk Level | High |
| Affected Module | Users, Device Tokens, Preferences |
| Exploit Scenario | Student calls another user's preference or token endpoint. |
| Technical Impact | Privacy breach and push notification abuse. |
| Solution | Server-side ownership checks for every object-level operation. |
| Code-Level Control | CurrentUser decorator plus repository queries scoped by userId. |
| Test Scenario | User A cannot delete User B device token. |
| Priority | P0 |

### Cross-University Admin Access

| Field | Value |
|---|---|
| Risk Level | High |
| Affected Module | Admin, Universities, Calendars |
| Exploit Scenario | University admin edits another university's calendar. |
| Technical Impact | Calendar manipulation and reputational damage. |
| Solution | University scope guard for all university_admin actions. |
| Code-Level Control | Guard checks actor.universityIds against resource.universityId. |
| Test Scenario | University admin receives 403 for foreign university resources. |
| Priority | P0 |

## 3. PDF Upload Findings

### Parser Exploit Or Malicious PDF

| Field | Value |
|---|---|
| Risk Level | Critical |
| Affected Module | PDF Processing |
| Exploit Scenario | Attacker uploads malformed PDF that exploits parser library. |
| Technical Impact | Worker compromise or denial of service. |
| Solution | MIME and magic byte checks, antivirus scan, sandboxed worker, page/size limits. |
| Code-Level Control | Upload validation pipe and isolated worker container with read-only filesystem. |
| Test Scenario | Malformed, encrypted and oversized PDFs are rejected without worker crash. |
| Priority | P0 |

### Duplicate Or Stale PDF Processing

| Field | Value |
|---|---|
| Risk Level | Medium |
| Affected Module | PDF Sources |
| Exploit Scenario | Same PDF is repeatedly uploaded to exhaust queue resources. |
| Technical Impact | Queue saturation and duplicate extracted events. |
| Solution | SHA-256 hash uniqueness and scoped duplicate detection. |
| Code-Level Control | Unique index on fileHash and universityId where applicable. |
| Test Scenario | Same file upload produces duplicate status and no new parse job. |
| Priority | P1 |

## 4. API And Data Hardening Checklist

- Enforce HTTPS in production.
- Use Helmet/security headers.
- Strict CORS allowlist for admin and mobile API clients.
- DTO validation with whitelist and forbidNonWhitelisted.
- Body size limits per route class.
- Pagination maximum limits.
- Standard error response without stack traces in production.
- Sanitize MongoDB query objects and reject operator injection.
- Never log passwords, access tokens, refresh tokens, reset tokens or FCM tokens.
- Use least-privilege MongoDB user and private network access.
- Use Redis AUTH/TLS where available and no public exposure.
- Validate queue payloads before processing.
- Use private object storage buckets and signed URLs.

## 5. Pre-Production Security Gate

| Gate | Required Evidence |
|---|---|
| Auth Security | Refresh rotation/reuse, generic password-recovery response, digest-only/expiry/single-use recovery, all-session reset revocation, rate-limit, and password-hashing tests verified |
| RBAC | Endpoint access matrix tests passing |
| Upload Security | MIME, magic byte, size, encrypted PDF and malware scan tests passing |
| Mobile Security | Tokens stored in secure storage, no token debug logs |
| Logging | Sensitive fields redacted in structured logs |
| Secrets | No secrets in git, all secrets injected through environment or secret manager |
