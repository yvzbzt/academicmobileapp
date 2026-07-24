# Admin Operations Console

Vite + React MVP console for operational academic calendar management.

## Scripts

- `npm run dev:admin` starts the app on port 3001 or the next available Vite port.
- `npm run build:admin` verifies the production bundle.
- `npm run build:admin -- --base=/admin/` creates the VPS bundle served below the academic API host.

Set `VITE_API_BASE_URL` when the API runs outside `http://localhost:3000`.

The VPS deployment is available at `https://academic-api.anssoft.com.tr/admin/`.

## MVP Workflows

- University catalog list/create/archive.
- Faculty and department creation.
- PDF source creation and processing.
- Extracted event approve/reject review queue.
- Calendar draft creation, publish and rollback.
- Notification due processing, failed job retry and per-recipient delivery timeline.
- Audit timeline load and JSONL export.

The console accepts the signed-in admin handoff from the student web app and keeps the session in browser session storage.
