# Firebase Deploy Runbook

This repo is closest to a Firebase Hosting + Cloud Run deployment:

- `apps/admin`: static Vite admin console, deployed to Firebase Hosting.
- `apps/mobile`: static Vite student web app, deployed to Firebase Hosting.
- `apps/api`: NestJS container, deployed to Cloud Run.
- Database and durable notification delivery: MongoDB is required in every environment and owns notification jobs plus per-device delivery-attempt fences. Redis/BullMQ and a Mongo replica set are not required by the Phase 1–8 release contract. The existing optional queue/rate-limit adapters may be selected separately, but the checked-in deployment uses their process-local modes.

As of Phase 1 R1C1, Firestore database persistence is not supported by the API: no Firestore database service, repository adapter, runtime selector, index configuration, or deployment step remains. Firebase Authentication and Firebase Admin SDK token verification, Firebase Cloud Messaging, Firebase Hosting, Google Sign-In/OAuth, and their existing configuration remain supported. The R1C1 source cleanup did not run a migration, deploy an application, or access production data; `MONGODB_URI` remains the sole API database configuration.

## 1. Install CLIs

```powershell
npm install
npm install -g firebase-tools
gcloud init
firebase login
```

If PowerShell blocks `gcloud.ps1`, run this shell once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Create Hosting Sites

Replace the placeholders with your real Firebase project and site IDs.

```powershell
firebase use --add YOUR_FIREBASE_PROJECT_ID
firebase hosting:sites:create YOUR_ADMIN_SITE_ID
firebase hosting:sites:create YOUR_MOBILE_SITE_ID
firebase target:apply hosting admin YOUR_ADMIN_SITE_ID
firebase target:apply hosting mobile YOUR_MOBILE_SITE_ID
```

Those `target:apply` commands create `.firebaserc` locally. Commit it only after the project/site IDs are final.

## 3. Deploy API To Cloud Run

The API runtime uses MongoDB exclusively. Configure `MONGODB_URI` for MongoDB Atlas or another supported standalone or replicated Mongo deployment. The checked-in notification worker and its ambiguity fence do not require Redis, BullMQ, or replica-set transactions.

```powershell
gcloud config set project YOUR_FIREBASE_PROJECT_ID
gcloud artifacts repositories create academic-calendar `
  --repository-format=docker `
  --location=europe-west1 `
  --description="Academic calendar containers"

gcloud builds submit `
  --config deploy/cloudbuild.api.yaml `
  --substitutions _IMAGE=europe-west1-docker.pkg.dev/YOUR_FIREBASE_PROJECT_ID/academic-calendar/academic-calendar-api

```

Before deployment, create the referenced Mongo URI and JWT/recovery secrets in Secret Manager. Put only non-secret configuration in an untracked file outside the repository, for example `C:\secure\academic-calendar-api.nonsensitive.yaml`:

```yaml
NODE_ENV: "production"
QUEUE_MODE: "memory"
RATE_LIMIT_STORE: "memory"
BOOTSTRAP_SEED_ENABLED: "false"
AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN: "false"
CORS_ORIGIN: "https://YOUR_ADMIN_SITE_ID.web.app,https://YOUR_MOBILE_SITE_ID.web.app"
```

Then deploy with secret references rather than shell-visible secret values. The Secret Manager resource names below are placeholders, not secret material:

```powershell
gcloud run deploy academic-calendar-api `
  --image europe-west1-docker.pkg.dev/YOUR_FIREBASE_PROJECT_ID/academic-calendar/academic-calendar-api `
  --region europe-west1 `
  --allow-unauthenticated `
  --env-vars-file "C:\secure\academic-calendar-api.nonsensitive.yaml" `
  --set-secrets "MONGODB_URI=mongodb-uri:latest,JWT_ACCESS_SECRET=jwt-access-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest,PASSWORD_RECOVERY_TOKEN_PEPPER=password-recovery-pepper:latest"
```

Do not pass a credential-bearing Mongo URI, real JWT secrets, the recovery pepper, SMTP credentials, or bootstrap credentials through `--set-env-vars`/`--update-env-vars`; command lines and shell history are not secret stores. Using the YAML file also avoids misparsing the comma-separated two-origin `CORS_ORIGIN` value.

After deploy, copy the Cloud Run service URL. Verify:

```powershell
Invoke-RestMethod https://YOUR_CLOUD_RUN_URL/health/ready
```

## 4. Deploy Web Apps To Firebase Hosting

Build both Vite apps with the production API URL baked in.

```powershell
$env:VITE_API_BASE_URL="https://YOUR_CLOUD_RUN_URL"
firebase deploy --only hosting:admin,hosting:mobile
```

## 5. Production Values To Add Before Real Users

- `MONGODB_URI`
- `QUEUE_MODE=memory`
- `RATE_LIMIT_STORE=memory`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- `SMTP_PORT`
- `SMTP_SECURE`
- `MAIL_FROM`
- `EMAIL_VERIFICATION_URL=https://YOUR_CLOUD_RUN_URL/auth/verify-email`
- `AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN=false`
- `PASSWORD_RECOVERY_TOKEN_PEPPER` with an independent random value of at least 32 characters
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `CORS_ORIGIN` with the final Hosting/custom domains

Push delivery already uses Firebase Admin SDK through `FIREBASE_SERVICE_ACCOUNT_JSON`; Hosting itself does not configure push notifications.

## 6. Email Authentication And Password Recovery

Student registration creates an inactive user and emails a four-digit verification code. The native client submits that code to `POST /auth/verify-email`; Login remains blocked until verification succeeds.

For a real email-auth demo, configure Cloud Run with SMTP credentials and keep preview tokens disabled:

```powershell
gcloud run services update academic-calendar-api `
  --region europe-west1 `
  --update-env-vars SMTP_HOST=smtp.example.com,SMTP_PORT=587,SMTP_SECURE=false,MAIL_FROM=noreply@example.invalid,EMAIL_VERIFICATION_URL=https://YOUR_CLOUD_RUN_URL/auth/verify-email,AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN=false `
  --update-secrets "SMTP_USER=smtp-user:latest,SMTP_PASS=smtp-pass:latest"
```

For local development without SMTP, the API emits a non-sensitive warning without logging the email address or verification code. Whenever `NODE_ENV !== "production"`, the API includes the verification preview token. Production email operations fail closed when SMTP is unavailable; deploys must keep `AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN` absent or `false` and assert that preview fields are absent in the production smoke.

Password recovery uses the same SMTP transport but has an independent digest-secret gate. Production startup/request handling requires `PASSWORD_RECOVERY_TOKEN_PEPPER`, or the `JWT_ACCESS_SECRET` fallback, to contain at least 32 characters; use a dedicated random pepper in real deployments. Store it in Secret Manager or the deployment platform's secret facility rather than in source, shell history, or a checked-in environment file.

The public `POST /auth/password-recovery/request` production status/body fields are intentionally identical for known, unknown, and cooldown cases. Do not add Cloud Run/API Gateway rules, mail-delivery diagnostics, or client-visible logs that reintroduce a response-field account-existence signal. Each path performs comparable token/hash/lookup/repository work and observes a 350 ms production response floor; eligible SMTP delivery is scheduled outside the public response, bounded to 12 seconds, and uses bounded transport timeouts. This is the committed application-level timing contract, not a claim of internet-wide statistical indistinguishability. Both password-recovery routes use the strict 10-requests-per-60-seconds rate class; configure `TRUSTED_PROXY_CIDRS` for the exact proxy topology before relying on forwarded client addresses.

`previewRecoveryCode` is strictly non-production and depends only on `NODE_ENV !== "production"`; there is no production override. A production smoke must assert that the field is absent. Never place a recovery code, password, email address, refresh token, or request body in deployment logs. A successful confirmation response means the atomic password replacement and credential-generation advance completed. That commit logically invalidates every older access, refresh, and recovery credential; physical refresh/recovery-record cleanup remains best effort. Post-deploy verification should use isolated synthetic accounts and assert that every pre-reset refresh session is rejected without printing token values.

Password confirmation commits its security boundary in one standalone-Mongo user-document compare-and-set: owner, accepted recovery token, and expected generation gate the password replacement, one generation advance, accepted-attempt completion, and password-bound idempotency record. Older access, refresh, and recovery material is invalid immediately at that generation advance; later physical cleanup is best effort and cannot make it valid again. No transaction, replica set, Redis, BullMQ, or reconciliation worker is required for that guarantee.

## 7. Recent Authentication And Destructive Requests

The native client requests a fresh proof for exactly one purpose—`delete_personal_data` or `delete_account`—immediately before the matching destructive request. The API persists only a digest of the proof's random identifier and atomically consumes the matching owner/generation/purpose record in `RecentAuthGuard`. A consumed proof is never restored when later deletion work fails, so a retry requires fresh reauthentication. Do not capture the proof header, identifier, password, Google credential, email, or deletion body in Cloud Run request/application logs.
