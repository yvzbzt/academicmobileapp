# Academic Calendar

Academic Calendar is a full-stack platform that turns official university calendars and announcements into a personalized student experience. It provides reviewed academic dates, trusted announcements, reminders, and optional Google Calendar synchronization through web, mobile, and administrative applications.

## Applications

| Application | Technology | Purpose |
| --- | --- | --- |
| API | NestJS, MongoDB; optional Redis and BullMQ adapters | Authentication, catalog data, calendar publication, announcement ingestion, notifications, and audit records |
| Admin | React, Vite | Source management, document review, calendar publishing, delivery monitoring, and audit export |
| Student web | React, Vite | Browser-based access to calendars, announcements, and account settings |
| Student mobile | React Native, Expo | Native experience targeting Android and iOS, with reminders, profile scoping, and calendar synchronization |

## Key Features

- Email and Google authentication with verification, session controls, and account recovery.
- University, faculty, department, and year-based personalization.
- Review and publication workflow for official academic calendar sources.
- Trusted announcement feed with source attribution, saving, and direct destinations.
- Agenda, week, and month calendar views with personal exam creation.
- Notification preferences, quiet hours, and device registration.
- Owner-scoped Google Calendar synchronization that does not modify unrelated personal events.
- Role-based administration, audit trails, delivery tracking, and retry workflows.

## Repository Structure

```text
apps/
  admin/          Administrative web application
  api/            NestJS API and background services
  mobile/         Student web application
  mobile-native/  React Native and Expo application
packages/
  shared/         Shared API contracts and domain types
docs/              Architecture, security, testing, and deployment guides
deploy/            Deployment assets
tests/             Cross-application unit and end-to-end tests
```

## Requirements

- Node.js 22 and npm
- Docker with Docker Compose for MongoDB- and Redis-backed local services
- Android Studio and a supported JDK for local Android builds
- macOS with Xcode for local iOS builds

## Local Development

Install the root and native-app dependencies:

```bash
npm install
npm --prefix apps/mobile-native install
cp .env.example .env
```

Start the local infrastructure and verify it:

```bash
docker compose up -d mongodb redis
npm run smoke:infra
```

Run the services you need in separate terminals:

```bash
npm run start:api
npm run dev:admin
npm run dev:mobile
npm run dev:mobile:native
```

Native platform shortcuts:

```bash
npm run android:mobile:native
npm run ios:mobile:native
```

Default local endpoints:

- API: `http://localhost:3000`
- Admin: `http://localhost:3001`
- Student web: `http://localhost:3002`

Vite may select the next available port when a default port is already in use.

## Configuration

Copy the relevant example environment file before development:

- Root services: [`.env.example`](./.env.example)
- Native app: [`apps/mobile-native/.env.example`](./apps/mobile-native/.env.example)

The native app resolves its API URL from `EXPO_PUBLIC_API_URL`, the Expo development host, or its platform fallback. Google login, Google Calendar, Firebase Cloud Messaging, email delivery, and production authentication require their corresponding provider credentials. Never commit local environment files, signing keys, service-account files, or production secrets.

## Validation

Run the main repository checks:

```bash
npm run validate
```

`validate` performs the root TypeScript check, Vitest suite, and production builds for both web applications. Validate the native app separately:

```bash
npm run typecheck:mobile:native
npm run test:mobile:native
```

Infrastructure-dependent checks are available with:

```bash
npm run smoke:infra
```

## Deployment

Production-style containers are defined in [`docker-compose.prod.yml`](./docker-compose.prod.yml). Configure strong secrets and deployment-specific provider credentials before building or starting the stack:

```bash
npm run compose:prod:config
npm run compose:prod:build
docker compose -f docker-compose.prod.yml up
```

See the [deployment guide](./docs/08-devops-deployment.md) and [Firebase deployment guide](./docs/15-firebase-deploy.md) for environment, secret, and provider configuration.

## Documentation

The [documentation index](./docs/README.md) links to the architecture, API contracts, data model, security controls, test strategy, deployment procedures, and mobile design system. Native-app implementation details are documented in [`apps/mobile-native/README.md`](./apps/mobile-native/README.md).
