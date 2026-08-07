# Universite Akademik Takvim Bildirim Uygulamasi

Turkiye'deki universitelerin akademik takvimlerini PDF kaynaklardan isleyen, admin onayi sonrasinda yayinlayan ve ogrencilere bildirim planlayan MVP platformu.

## MVP Kapsami

- NestJS API: auth, RBAC, katalog, takvim, PDF processing, audit, notification scheduling ve delivery tracking.
- MongoDB adapterleri: auth, katalog, takvim, PDF, notification ve audit koleksiyonlari.
- Redis/BullMQ: queue adapteri ve Redis rate-limit store.
- Admin web: katalog CRUD, PDF isleme/review, calendar publish/rollback, audit export, notification retry/delivery timeline.
- Student mobile web: login/register, universite secimi, akademik takvim, upcoming events, notification preferences ve web device registration.
- Student mobile native (React Native + Expo): register/login, university selection, calendar timeline, all-calendar vs selected-field alarms.

## Student Registration Rules

- Registration accepts any valid email address.
- Registration passwords must contain at least 10 characters, and password confirmation must match.
- Email verification is mandatory before first login.
- Students select their university, faculty and department after verification so the timeline can be scoped correctly.
- Turkey university/faculty/department options are seeded from YOK Atlas on API startup unless `BOOTSTRAP_CATALOG_SEED_ENABLED=false`.
- Student timeline endpoints (`/calendar/my`, `/calendar/upcoming`) are filtered by selected university/faculty/department scope.

For local development without SMTP credentials, the API emits only a non-sensitive configuration warning; it never logs the email address or verification/deletion code. A preview verification token is returned in non-production mode (or when explicitly enabled) and must remain disabled in production. The controlled authentication error and resend-timing contract is documented in [docs/04-security-hardening.md](docs/04-security-hardening.md#controlled-authentication-api-contract).
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

On Windows, if Docker Compose reports a Buildx/Bake gRPC header error from a non-ASCII workspace path, use `npm.cmd run compose:prod:build:classic` for the build step.

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

Use the [documentation index](docs/README.md) for architecture, API contracts,
data model, security, deployment, mobile-native redesign, validation evidence,
known issues, and historical reports.
