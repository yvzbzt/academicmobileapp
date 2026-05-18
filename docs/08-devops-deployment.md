# DevOps And Deployment Plan

## 1. Development Environment

The local environment uses Docker Compose for platform dependencies:

- MongoDB for application data.
- Redis for cache and BullMQ queues.
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
$env:JWT_ACCESS_SECRET="change-this-access-secret-32-plus-chars"
$env:JWT_REFRESH_SECRET="change-this-refresh-secret-32-plus-chars"
npm run compose:prod:config
npm run compose:prod:build
docker compose -f docker-compose.prod.yml up
```

Windows fallback for Docker Compose Buildx/Bake path issues:

```powershell
npm run compose:prod:build:classic
```

The production compose file builds three application containers: API, admin static web and student mobile web. MongoDB and Redis remain managed service candidates for production; the included containers are for staging-like validation and self-hosted MVP deployments.

## 2. Production Recommendation

| Component | Production Option |
|---|---|
| Backend API | Containerized NestJS service behind reverse proxy/load balancer |
| Admin Panel | Containerized Next.js app or static/SSR hosting depending on auth strategy |
| MongoDB | Managed MongoDB Atlas or hardened replica set |
| Redis | Managed Redis with TLS/auth and private network |
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
- Infrastructure runtime modes are explicit:
	- `REPOSITORY_MODE=memory|mongo`
	- `QUEUE_MODE=memory|bullmq`
	- `RATE_LIMIT_STORE=memory|redis`
- `MONGODB_URI` is required when `REPOSITORY_MODE=mongo`.
- `REDIS_URL` is required when `QUEUE_MODE=bullmq` or `RATE_LIMIT_STORE=redis`.
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
| PDF Worker | Redis heartbeat plus active job metric |
| Notification Worker | Redis heartbeat plus provider connectivity check |
| Scheduler | Last successful schedule timestamp |
| MongoDB | Ping and replica health |
| Redis | Ping and queue latency |
| Object Storage | Bucket access check |

`/health/ready` is mode-aware. In in-memory development mode it returns MongoDB and Redis as `skipped`; in Mongo/Redis-backed modes it pings the configured dependencies and returns `degraded` if any required dependency is down.

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

- API stops accepting new requests, finishes in-flight requests, closes DB/Redis connections.
- Workers pause queue consumption, finish active jobs if within timeout, then close connections.
- Long PDF/OCR jobs must be idempotent and retryable.
