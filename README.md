# Universite Akademik Takvim Bildirim Uygulamasi

Turkiye'deki universitelerin akademik takvimlerini PDF kaynaklardan isleyen, admin onayi sonrasinda yayinlayan ve ogrencilere bildirim planlayan MVP platformu.

## MVP Kapsami

- NestJS API: auth, RBAC, katalog, takvim, PDF processing, audit, notification scheduling ve delivery tracking.
- MongoDB adapterleri: auth, katalog, takvim, PDF, notification ve audit koleksiyonlari.
- Redis/BullMQ: queue adapteri ve Redis rate-limit store.
- Admin web: katalog CRUD, PDF isleme/review, calendar publish/rollback, audit export, notification retry/delivery timeline.
- Student mobile web: login/register, universite secimi, akademik takvim, upcoming events, notification preferences ve web device registration.
- Student mobile native (React Native + Expo): register/login, university selection, calendar timeline, all-calendar vs selected-field alarms.

## Student Registration Rules (Current Stage)

- Registration accepts student email domains only (default suffixes: `.edu.tr`, `.edu`).
- Email verification is mandatory before first login.
- Registration requires academic selection fields:
	- universityId
	- facultyId
	- departmentId
- Student timeline endpoints (`/calendar/my`, `/calendar/upcoming`) are filtered by selected university/faculty/department scope.

For local development without SMTP credentials, verification links are logged by the API and a preview verification token is returned in non-production mode.
- Docker Compose: local dependency stack ve production-style API/admin/mobile deployment compose.
- CI: typecheck, tests, frontend builds, MongoDB/Redis/BullMQ smoke ve dependency audit.

## Hizli Baslangic

```bash
npm install
cp .env.example .env
npm run validate
```

Local dependency stack:

```bash
docker compose up -d mongodb redis
npm run smoke:infra
```

Development servers:

```bash
npm run start:api
npm run dev:admin
npm run dev:mobile
```

React Native development:

```bash
npm run dev:mobile:native
```

Native platform shortcuts:

```bash
npm run android:mobile:native
npm run ios:mobile:native
```

Default local URLs:

- API: `http://localhost:3000`
- Admin: `http://localhost:3001` or next available Vite port
- Student mobile web: `http://localhost:3002` or next available Vite port

## Production-Style Compose

Set strong secrets before running:

```bash
$env:JWT_ACCESS_SECRET="change-this-access-secret-32-plus-chars"
$env:JWT_REFRESH_SECRET="change-this-refresh-secret-32-plus-chars"
npm run compose:prod:config
npm run compose:prod:build
docker compose -f docker-compose.prod.yml up
```

On Windows, if Docker Compose reports a Buildx/Bake gRPC header error from a non-ASCII workspace path, use `npm run compose:prod:build:classic` for the build step.

Exposed services:

- API: `http://localhost:3000`
- Admin: `http://localhost:8080`
- Student mobile web: `http://localhost:8081`

## Validation

```bash
npm run validate
npm run smoke:infra
```

`npm run validate` runs TypeScript typecheck, Vitest tests, admin production build and mobile production build.

## Documentation

- [docs/01-product-analysis.md](docs/01-product-analysis.md)
- [docs/02-architecture.md](docs/02-architecture.md)
- [docs/03-mvp-backlog.md](docs/03-mvp-backlog.md)
- [docs/04-security-hardening.md](docs/04-security-hardening.md)
- [docs/05-test-strategy.md](docs/05-test-strategy.md)
- [docs/06-data-model.md](docs/06-data-model.md)
- [docs/07-cache-queue.md](docs/07-cache-queue.md)
- [docs/08-devops-deployment.md](docs/08-devops-deployment.md)
- [docs/09-section-approvals.md](docs/09-section-approvals.md)
- [docs/10-ui-ux-product-readiness-report.md](docs/10-ui-ux-product-readiness-report.md)
- [docs/11-ui-ux-implementation-roadmap.md](docs/11-ui-ux-implementation-roadmap.md)
- [docs/12-ui-ux-optimization-scenarios.md](docs/12-ui-ux-optimization-scenarios.md)
- [docs/13-pdf-ingestion-and-alarm-model.md](docs/13-pdf-ingestion-and-alarm-model.md)
- [docs/14-announcement-scaling.md](docs/14-announcement-scaling.md)
