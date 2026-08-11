# DevOps And Deployment Plan

## 1. Development Environment

The current API requires MongoDB. Docker Compose also provides optional adapters and development tools:

- MongoDB for application data.
- Redis for optional cache/BullMQ/rate-limit adapter smoke tests; it is not required by notification delivery.
- MinIO for private object storage compatible with S3 clients.
- ClamAV for PDF antivirus scanning.

Run:

```bash
docker compose up -d
npm install
npm run validate
```

Frontend development apps:

```bash
npm run dev:admin
npm run dev:mobile
```

Dependency-only smoke test:

```bash
docker compose up -d mongodb redis
npm run smoke:infra
```

The smoke test verifies MongoDB ping/write/read, Redis ping and BullMQ enqueue against the configured `MONGODB_URI` and `REDIS_URL` values.

Production-style local packaging:

```powershell
function New-DeploymentSecret {
  $secretBytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($secretBytes)
    [Convert]::ToBase64String($secretBytes)
  } finally {
    $generator.Dispose()
  }
}
$env:JWT_ACCESS_SECRET = New-DeploymentSecret
$env:JWT_REFRESH_SECRET = New-DeploymentSecret
$env:CALENDAR_FEED_SECRET = New-DeploymentSecret
Remove-Item Function:\New-DeploymentSecret
npm.cmd run compose:prod:config
npm.cmd run compose:prod:build
docker compose -f docker-compose.prod.yml up
```

Windows fallback for Docker Compose Buildx/Bake path issues:

```powershell
npm.cmd run compose:prod:build:classic
```

The production compose file builds three application containers: API, admin static web and student mobile web. MongoDB is the required database; Redis remains an optional adapter only when an operator deliberately selects a Redis/BullMQ mode. Production startup rejects missing, short, whitespace-only, checked-in placeholder, or reused access-token/calendar-feed signing values. The included containers are for staging-like validation and self-hosted MVP deployments.

## 2. Production Recommendation

| Component | Production Option |
|---|---|
| Backend API | Containerized NestJS service behind reverse proxy/load balancer |
| Admin Panel | Containerized Next.js app or static/SSR hosting depending on auth strategy |
| MongoDB | Supported standalone or managed MongoDB deployment; a replica set is not required by the Phase 1–8 contract |
| Redis | Optional only for deliberately selected Redis/BullMQ adapters; not required for notification jobs or delivery-attempt fencing |
| Object Storage | S3, Azure Blob Storage or compatible private bucket |
| Workers | Separately scalable containers by worker type |
| Logs | Centralized structured logs with retention policy |
| Metrics | Prometheus/OpenTelemetry-compatible metrics |
| Errors | Sentry or OpenTelemetry error export |

## 3. Environment And Secrets

- No secrets in git.
- Use `.env.example` only for names and local defaults.
- Production secrets must come from a secret manager.
- Rotate JWT, FCM and object storage credentials on incident.
- Separate credentials per environment.
- API persistence is MongoDB-only; queue and rate-limit runtime modes remain explicit:
	- `QUEUE_MODE=memory|bullmq`
	- `RATE_LIMIT_STORE=memory|redis`
- `MONGODB_URI` is required for every API runtime.
- `REDIS_URL` is required only when an optional `bullmq` or `redis` adapter is deliberately selected; checked-in deployments may retain both `memory` modes.
- `BOOTSTRAP_SEED_ENABLED=true` enables startup seeding for the sample catalog and first admin account.
- `BOOTSTRAP_ADMIN_PASSWORD` must be supplied before first-admin seeding can create a user.

## 4. CI/CD Pipeline

Implemented pipeline: `.github/workflows/ci.yml`.

Current stages:

1. Install dependencies with lockfile.
2. Static typecheck.
3. Unit tests.
4. Admin Vite production build.
5. Student mobile web Vite production build.
6. MongoDB/Redis/BullMQ smoke test with CI service containers.
7. High-severity production dependency audit.

Recommended deployment stages still pending for production rollout:

1. Secret scan.
2. Container image build and scan.
3. Deploy to staging.
4. Run API and UI smoke tests.
5. Manual approval for production.
6. Blue/green or rolling production deploy.

## 5. Health Checks

| Service | Endpoint/Check |
|---|---|
| API | `/health/live`, `/health/ready` |
| PDF Worker | Worker heartbeat plus active job metric; Redis queue health only when that optional mode is configured |
| Notification Worker | Mongo-backed due-job health plus `sending`, expired-lease, and `ambiguous` delivery-attempt counts; provider acceptance remains separate evidence |
| Scheduler | Last successful schedule timestamp |
| MongoDB | Ping; replica health only when a replica topology is independently configured |
| Redis | Optional ping and queue latency when Redis-backed modes are configured |
| Object Storage | Bucket access check |

`/health/ready` always checks MongoDB. Redis is reported as `skipped` unless required by queue or rate-limit configuration; an unavailable required dependency returns `degraded`.

## 6. Backup And Retention

- MongoDB daily automated backups with point-in-time recovery if managed service supports it.
- Object storage versioning enabled for PDFs.
- Audit logs retained according to legal/business requirement, minimum 1 year recommended.
- Notification logs retained for operational debugging, then aggregated or archived.

## 7. Worker Scaling

- PDF workers scale by CPU and queue depth.
- OCR workers scale separately and use stricter resource limits.
- Notification workers scale by due job count and provider rate limits.
- Scheduler should run as a singleton or use distributed locks.

## 8. Graceful Shutdown

- API stops accepting new requests, finishes in-flight requests, and closes Mongo plus any explicitly configured optional adapter connections.
- Workers stop new cycles, drain the active cycle within their bound, and retain Mongo job/attempt fences across restart.
- Long PDF/OCR jobs must be idempotent and retryable.
