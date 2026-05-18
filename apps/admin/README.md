# Admin Operations Console

Vite + React MVP console for operational academic calendar management.

## Scripts

- `npm run dev:admin` starts the app on port 3001 or the next available Vite port.
- `npm run build:admin` verifies the production bundle.

Set `VITE_API_BASE_URL` when the API runs outside `http://localhost:3000`.

## MVP Workflows

- University catalog list/create/archive.
- Faculty and department creation.
- PDF source creation and processing.
- Extracted event approve/reject review queue.
- Calendar draft creation, publish and rollback.
- Notification due processing, failed job retry and per-recipient delivery timeline.
- Audit timeline load and JSONL export.

The console expects a valid admin JWT pasted into the token field. Tokens are kept in React state only and are not persisted by the app.
