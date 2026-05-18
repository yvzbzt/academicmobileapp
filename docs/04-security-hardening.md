# Security Hardening Plan

This document follows OWASP ASVS, OWASP API Security Top 10 and OWASP Mobile guidance at a pragmatic MVP level.

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
| Auth Security | Refresh rotation tests, rate limit tests and password hashing verified |
| RBAC | Endpoint access matrix tests passing |
| Upload Security | MIME, magic byte, size, encrypted PDF and malware scan tests passing |
| Mobile Security | Tokens stored in secure storage, no token debug logs |
| Logging | Sensitive fields redacted in structured logs |
| Secrets | No secrets in git, all secrets injected through environment or secret manager |
