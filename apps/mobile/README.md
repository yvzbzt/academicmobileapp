# Student Mobile Web MVP

Responsive student-facing MVP for university academic calendar notifications.

## Scripts

- `npm run dev:mobile` starts the Vite app on port 3002.
- `npm run build:mobile` verifies the production bundle.

Production VPS build:

```bash
VITE_API_BASE_URL=https://academic-api.anssoft.com.tr \
VITE_ADMIN_DASHBOARD_URL=https://academic-api.anssoft.com.tr/admin/ \
npm run build:mobile -- --base=/app/
```

Google login uses Firebase Authentication. Add `academic-api.anssoft.com.tr` to Firebase Authentication authorized domains before using the VPS-hosted login page.

## MVP Scope

- Student login and registration.
- University selection with server-side profile update.
- Published academic calendar and upcoming event views.
- Notification preference updates and web device registration.
