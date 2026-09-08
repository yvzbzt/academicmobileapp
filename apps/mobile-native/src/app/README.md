# Application composition

`App.tsx` is the stable Expo entry point. `ApplicationEntry.tsx` selects the existing
development previews or `MainApplication`; it contains no application business logic.

## Responsibilities

| Location | Responsibility |
| --- | --- |
| `MainApplication.tsx` | Connect hooks, actions and existing screen components; mount the navigator/providers. |
| `useApplicationState.ts` | Own the application instance's React state, service instances and shared refs. |
| `usePersonalCalendarRuntime.ts` | Keep one personal-calendar runtime and reminder coordinator per application instance. |
| `useApplicationDerivedState.ts`, `useHomeContentData.ts` | Derive screen data and preserve existing memoization. |
| `useApplicationEffects.ts` | Register hydration, lifecycle, subscriptions and deferred-loading effects. |
| `application-actions.ts` | Type the callbacks used between domains, including generic API calls. |
| `createApplicationActions.ts` | Wire the domain callbacks; no business rules or side effects during construction. |
| `actions/api-actions.ts`, `actions/session-actions.ts`, `actions/bootstrap-actions.ts` | Requests, refresh, account ownership, session persistence and initialization. |
| Other `actions/*` | Authentication/recovery, account cleanup, academic selection, content, notifications, navigation and calendar integrations. |
| `screens/*` | Supply typed props and callbacks to existing auth, content and profile screen components. |
| `app-types.ts`, `app-config.ts`, `app-auth-providers.ts` | Shared types, application configuration and authentication-provider configuration. |
| `app-storage.ts`, `app-errors.ts`, `app-content.ts`, `app-routes.ts`, `calendar-presentations.ts` | Existing storage helpers, error handling and presentation/route transformations. |

## Lifecycle rules

- Call application hooks unconditionally, in their current order. The home-data memo
  remains after the lifecycle effects, matching the original component.
- Actions and screen factories are ordinary functions, not React component types.
  They retain the current render's state snapshot; do not replace it with a global
  mutable context or a generic "latest state" ref.
- Account-generation guards, storage/Google SDK queues, refresh promises and native
  mutation refs must remain shared. Do not create a second copy inside a domain factory.
- Cross-domain forwarding callbacks are intentional. The actions are mutually dependent,
  but factories and personal-calendar constructors do not call these callbacks during
  construction. Callbacks become usable after all factories have been initialized.
- Keep async operation ordering, cancellation checks and effect dependencies intact
  unless a separate behavior change is explicitly intended and tested.
- New screen components belong in their feature folders. These adapters should only
  connect them; do not reintroduce a second copy of screen UI here.

## Verification

From the repository root:

```sh
npm run typecheck
npm run typecheck:mobile:native
npm --prefix apps/mobile-native run test:native -- --runInBand
npm test -- --maxWorkers=2
```

`tests/app/ApiActions.test.ts` exercises the extracted API factory, including concurrent
refresh and stale-owner suppression. `tests/app/ApplicationEntry.test.tsx` mounts the
real entry/composition with mocked native SDK and HTTP boundaries. Release checks must
follow the real entry import chain to the Google configuration; searching only `App.tsx`
for configuration literals is no longer sufficient.

## Refactor verification record — 2026-09-08

The original working-copy `App.tsx` contained 11,536 lines, including the user's
uncommitted changes. Its entry is now 2 lines; the composition component is 507 lines.
The largest new module is the explicit action wiring (804 lines), not a relocated
business-logic monolith. No dependency, API contract, app version or deployment changed.

| Check | Result |
| --- | --- |
| Native Jest | 42 files, 443 tests passed; baseline was 40 files / 432 tests. |
| Root and native TypeScript | Both passed. |
| Android production JS/Hermes export | Passed with installed dependencies, offline; not an APK/AAB or device test. |
| Google release preflight | Actual local release configuration passed; all 12 verifier regression tests passed. |
| Structural comparison | 137 retained inner function bodies unchanged; all 185 primitive hook calls preserve order and arguments/effect bodies; 970 dependency bindings checked. |
| Full repository Vitest | 2,710 passed, 4 assertion failures, 33 skipped/unrun; additionally 12 suite setup/collection failures. Not a green full regression. |

The four assertion failures match the pre-refactor baseline: a stale literal-email
autocomplete expectation, the existing raw color in `native-calendar/expo-calendar-adapter.ts`,
the old SecureStore backup-option expectation, and a route-list expectation missing
`AppleCalendarSettings`. They were not hidden or changed to make this refactor pass.
The other 12 suite failures come from unavailable local MongoDB/missing isolated-test URI
(including archived copies) and three archived Node-test scripts collected by Vitest.
Those backend/environment/archive issues were left outside this mobile refactor.

Intentional cleanup removed the unreachable legacy authenticated-screen fallback, its
unused announcement renderer, 213 unreferenced legacy styles, and an unused placeholder
color. Status bars now use existing palette tokens with exactly the same color values.
The original working-copy snapshot and detailed checks are retained locally under
`.tmp/app-modularization/`; unrelated user edits were not reverted.
