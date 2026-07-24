# Firebase Deploy Runbook

This repo is closest to a Firebase Hosting + Cloud Run deployment:

- `apps/admin`: static Vite admin console, deployed to Firebase Hosting.
- `apps/mobile`: static Vite student web app, deployed to Firebase Hosting.
- `apps/api`: NestJS container, deployed to Cloud Run.
- Database/queue: use managed MongoDB and Redis for a real environment. Use memory modes only for a temporary demo because data disappears on restart.

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

For a durable MVP, set `REPOSITORY_MODE=mongo` with MongoDB Atlas and set Redis if using BullMQ/rate limiting. For an immediate smoke demo, set memory modes.

```powershell
gcloud config set project YOUR_FIREBASE_PROJECT_ID
gcloud artifacts repositories create academic-calendar `
  --repository-format=docker `
  --location=europe-west1 `
  --description="Academic calendar containers"

gcloud builds submit `
  --config deploy/cloudbuild.api.yaml `
  --substitutions _IMAGE=europe-west1-docker.pkg.dev/YOUR_FIREBASE_PROJECT_ID/academic-calendar/academic-calendar-api

gcloud run deploy academic-calendar-api `
  --image europe-west1-docker.pkg.dev/YOUR_FIREBASE_PROJECT_ID/academic-calendar/academic-calendar-api `
  --region europe-west1 `
  --allow-unauthenticated `
  --set-env-vars NODE_ENV=production,REPOSITORY_MODE=memory,QUEUE_MODE=memory,RATE_LIMIT_STORE=memory,BOOTSTRAP_SEED_ENABLED=true,BOOTSTRAP_ADMIN_EMAIL=admin@example.com,BOOTSTRAP_ADMIN_PASSWORD=change-this-demo-password,JWT_ACCESS_SECRET=change-this-access-secret-with-32-plus-chars,JWT_REFRESH_SECRET=change-this-refresh-secret-with-32-plus-chars,CORS_ORIGIN=https://YOUR_ADMIN_SITE_ID.web.app,https://YOUR_MOBILE_SITE_ID.web.app
```

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

- `REPOSITORY_MODE=mongo`
- `MONGODB_URI`
- `QUEUE_MODE=bullmq`
- `RATE_LIMIT_STORE=redis`
- `REDIS_URL`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- `SMTP_PORT`
- `SMTP_SECURE`
- `MAIL_FROM`
- `EMAIL_VERIFICATION_URL=https://YOUR_CLOUD_RUN_URL/auth/verify-email`
- `AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN=false`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `CORS_ORIGIN` with the final Hosting/custom domains

Push delivery already uses Firebase Admin SDK through `FIREBASE_SERVICE_ACCOUNT_JSON`; Hosting itself does not configure push notifications.

## 6. Email Authentication

Student registration creates an inactive user and sends an email verification link. Login is blocked until the user opens that link.

For a real email-auth demo, configure Cloud Run with SMTP credentials and keep preview tokens disabled:

```powershell
gcloud run services update academic-calendar-api `
  --region europe-west1 `
  --update-env-vars SMTP_HOST=smtp.example.com,SMTP_PORT=587,SMTP_USER=YOUR_SMTP_USER,SMTP_PASS=YOUR_SMTP_PASSWORD,SMTP_SECURE=false,MAIL_FROM=noreply@example.com,EMAIL_VERIFICATION_URL=https://YOUR_CLOUD_RUN_URL/auth/verify-email,AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN=false
```

For local development without SMTP, the API logs the verification link. Set `AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN=true` only for throwaway demos where showing the token in the UI is acceptable.
