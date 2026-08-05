# Phase 10 Android native evidence

## Environment and safety boundary

- Device: Android emulator using AVD `AcademicPhase1Low`.
- Platform: Android 7.0 / API 24 / x86_64.
- Fixture source: the dual-gated Phase 10 preview with synthetic local records only.
- No production account, backend, Google account/calendar, notification provider, or user data was accessed.
- The final Android debug assembly passed in 1m11s with 268 tasks (7 executed, 261 up-to-date). The APK is 56,804,991 bytes with SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD`.
- The rebuilt debug APK was reinstalled, then all 44 evidence pairs were recaptured against the final current-source Metro session. The unchanged APK hash is expected because debug JavaScript is served by Metro.
- This evidence validates Android rendering, reachable controls, exported semantics, controlled native confirmations, and ordinary Back behavior. It does not validate authenticated storage or live provider behavior.

## Profiles reviewed

| Profile | Effective layout | Coverage |
|---|---|---|
| Phone light | 720 x 1280 px, density 320, 360 dp, font scale 1.0 | Profile summary and incomplete state; academic editor; notification states and settings path; Google connection states and actions; account/danger controls; confirmations and retained errors; ordinary Back |
| Phone dark | 720 x 1280 px, density 320, 360 dp, font scale 1.0 | Profile summary and Google partial-state contrast |
| Compact large text | 720 x 1280 px, density 360, exactly 320 dp, font scale 2.0 | Wrapped content, scrolling, and reachable academic, notification, Google, data, and account actions |
| Simulated tablet | `wm size 1280x1920`, density 240, approximately 853 dp, font scale 1.0 | Profile summary and Google partial state within the readable-width layout |

Every captured PNG is physically 720 x 1280 because that is the emulator framebuffer. The tablet UIAutomator hierarchies retain the 1280 x 1920 logical `wm` coordinates used for the tablet layout review.

## Scenario inventory

Each linked screenshot has a basename-matched UIAutomator XML export.

| Profile / flow | Evidence |
|---|---|
| Phone light - profile | Summary [PNG](screenshots/phone-light-profile-summary.png) / [XML](hierarchies/phone-light-profile-summary.xml); incomplete [PNG](screenshots/phone-light-profile-incomplete.png) / [XML](hierarchies/phone-light-profile-incomplete.xml) |
| Phone light - academic editor | Editor [PNG](screenshots/phone-light-academic-editor.png) / [XML](hierarchies/phone-light-academic-editor.xml); actions [PNG](screenshots/phone-light-academic-editor-actions.png) / [XML](hierarchies/phone-light-academic-editor-actions.xml) |
| Phone light - notifications | Active [PNG](screenshots/phone-light-notifications-active.png) / [XML](hierarchies/phone-light-notifications-active.xml); active actions [PNG](screenshots/phone-light-notifications-active-actions.png) / [XML](hierarchies/phone-light-notifications-active-actions.xml); denied [PNG](screenshots/phone-light-notifications-denied.png) / [XML](hierarchies/phone-light-notifications-denied.xml); settings required [PNG](screenshots/phone-light-notifications-settings-required.png) / [XML](hierarchies/phone-light-notifications-settings-required.xml); registering [PNG](screenshots/phone-light-notifications-registering.png) / [XML](hierarchies/phone-light-notifications-registering.xml); controlled error [PNG](screenshots/phone-light-notifications-error.png) / [XML](hierarchies/phone-light-notifications-error.xml); separate Open Settings control [PNG](screenshots/phone-light-notifications-open-settings.png) / [XML](hierarchies/phone-light-notifications-open-settings.xml); settings actions [PNG](screenshots/phone-light-notifications-settings-actions.png) / [XML](hierarchies/phone-light-notifications-settings-actions.xml); switch target [PNG](screenshots/phone-light-notifications-switch-target.png) / [XML](hierarchies/phone-light-notifications-switch-target.xml) |
| Phone light - Google Calendar | Disconnected [PNG](screenshots/phone-light-google-disconnected.png) / [XML](hierarchies/phone-light-google-disconnected.xml); connected [PNG](screenshots/phone-light-google-connected.png) / [XML](hierarchies/phone-light-google-connected.xml); connected actions [PNG](screenshots/phone-light-google-connected-actions.png) / [XML](hierarchies/phone-light-google-connected-actions.xml); partial [PNG](screenshots/phone-light-google-partial.png) / [XML](hierarchies/phone-light-google-partial.xml); expired [PNG](screenshots/phone-light-google-expired.png) / [XML](hierarchies/phone-light-google-expired.xml); expired actions [PNG](screenshots/phone-light-google-expired-actions.png) / [XML](hierarchies/phone-light-google-expired-actions.xml) |
| Phone light - account and danger area | Account management [PNG](screenshots/phone-light-account-management.png) / [XML](hierarchies/phone-light-account-management.xml); expanded danger area [PNG](screenshots/phone-light-danger-expanded.png) / [XML](hierarchies/phone-light-danger-expanded.xml) |
| Phone light - data deletion | Confirmation [PNG](screenshots/phone-light-data-confirm.png) / [XML](hierarchies/phone-light-data-confirm.xml); actions [PNG](screenshots/phone-light-data-confirm-actions.png) / [XML](hierarchies/phone-light-data-confirm-actions.xml); retained controlled confirmation error [PNG](screenshots/phone-light-data-confirm-error.png) / [XML](hierarchies/phone-light-data-confirm-error.xml); semantic route error [PNG](screenshots/phone-light-data-error.png) / [XML](hierarchies/phone-light-data-error.xml) |
| Phone light - account deletion | Confirmation [PNG](screenshots/phone-light-account-confirm.png) / [XML](hierarchies/phone-light-account-confirm.xml); actions [PNG](screenshots/phone-light-account-confirm-actions.png) / [XML](hierarchies/phone-light-account-confirm-actions.xml); retained controlled confirmation error [PNG](screenshots/phone-light-account-confirm-error.png) / [XML](hierarchies/phone-light-account-confirm-error.xml); semantic route error [PNG](screenshots/phone-light-account-error.png) / [XML](hierarchies/phone-light-account-error.xml) |
| Phone light - Android Back | Notifications before Back [PNG](screenshots/phone-light-back-before-notifications.png) / [XML](hierarchies/phone-light-back-before-notifications.xml); Profile after Back [PNG](screenshots/phone-light-back-after-profile.png) / [XML](hierarchies/phone-light-back-after-profile.xml) |
| Phone dark | Profile summary [PNG](screenshots/phone-dark-profile-summary.png) / [XML](hierarchies/phone-dark-profile-summary.xml); Google partial [PNG](screenshots/phone-dark-google-partial.png) / [XML](hierarchies/phone-dark-google-partial.xml) |
| Compact 320 dp / 200% | Profile summary [PNG](screenshots/compact-320dp-200pct-profile-summary.png) / [XML](hierarchies/compact-320dp-200pct-profile-summary.xml); academic actions [PNG](screenshots/compact-320dp-200pct-academic-actions.png) / [XML](hierarchies/compact-320dp-200pct-academic-actions.xml); notification middle [PNG](screenshots/compact-320dp-200pct-notifications-mid.png) / [XML](hierarchies/compact-320dp-200pct-notifications-mid.xml); separate Open Settings control [PNG](screenshots/compact-320dp-200pct-notifications-open-settings.png) / [XML](hierarchies/compact-320dp-200pct-notifications-open-settings.xml); notification actions [PNG](screenshots/compact-320dp-200pct-notifications-actions.png) / [XML](hierarchies/compact-320dp-200pct-notifications-actions.xml); expired Google reconnect [PNG](screenshots/compact-320dp-200pct-google-expired-reconnect.png) / [XML](hierarchies/compact-320dp-200pct-google-expired-reconnect.xml); expired Google actions [PNG](screenshots/compact-320dp-200pct-google-expired-actions.png) / [XML](hierarchies/compact-320dp-200pct-google-expired-actions.xml); data-confirm actions [PNG](screenshots/compact-320dp-200pct-data-confirm-actions.png) / [XML](hierarchies/compact-320dp-200pct-data-confirm-actions.xml); account-confirm actions [PNG](screenshots/compact-320dp-200pct-account-confirm-actions.png) / [XML](hierarchies/compact-320dp-200pct-account-confirm-actions.xml) |
| Simulated tablet | Profile summary [PNG](screenshots/tablet-light-profile-summary.png) / [XML](hierarchies/tablet-light-profile-summary.xml); Google partial [PNG](screenshots/tablet-light-google-partial.png) / [XML](hierarchies/tablet-light-google-partial.xml) |

## Measured native checks

- At density 320, the phone Back control is `[32,64][128,160]`, or 48 x 48 dp.
- The final separate phone Open Settings control is `[36,695][684,799]`, or 648 x 104 px and 52 dp high.
- The notification switch's accessible outer node is `[554,730][650,826]`, or 48 x 48 dp. It exports checked and interactive semantics; the smaller visual switch is a disabled child.
- At exactly 320 dp and font scale 2.0, academic Cancel `[41,739][680,856]` and Save `[41,883][680,1100]`, notification Open Settings `[41,774][680,991]`, data-confirm Cancel `[36,775][684,892]` and confirm `[36,919][684,1136]`, and the matching account-confirm controls all have nonzero reachable bounds.
- In the compact Google profile, Reconnect is `[41,842][680,1059]`; the lower-actions capture shows Switch account `[41,233][680,450]` and Revoke `[41,883][680,1100]` fully reachable.
- In the simulated tablet profile, the principal row is x=130 through x=1150. At density 240, its 1020 px width is 680 dp and remains inside the 720 dp readable-width cap.

The notification truth row now reports the stored preference (`Açık`) independently from save state, and the OS-settings path is a warning banner followed by a separate native button. The synthetic managed-event removal confirmation completed and closed without any provider access. Static UIAutomator XML does not expose Android accessibility-focus state, so the post-removal heading focus remains supported by the focused renderer test rather than a runtime focus claim.

## Navigation and runtime checks

The ordinary Android system Back smoke began on Notifications and returned to Profile in the same app process (`PID 11098`). The paired before/after artifacts above record that warm-stack transition; they are not a cold-link or predictive-Back claim.

[`raw/android-runtime.log`](raw/android-runtime.log) contains 772 retained app-process lines and is 78,370 bytes, with SHA-256 `DCB99C0BEA48EFA6C4406EE542E6BB43CF0CB39F1B2B59B748E7E610589EC675`. [`raw/android-runtime-errors.txt`](raw/android-runtime-errors.txt) records `NO_MATCHES` for the final fatal/AndroidRuntime/React Native `TypeError`, `ReferenceError`, invariant, unhandled, and unable-to-load scan.

## Artifact integrity and restoration

There are 44 original-resolution PNG screenshots and 44 basename-matched UIAutomator XML exports, all captured from the final current-source Metro run. [`raw/integrity-index.csv`](raw/integrity-index.csv) contains 88 artifact rows with byte counts and SHA-256 hashes; its SHA-256 is `D2ACCBE7346A947B53B920497FEED120B8C6CD1EBA63E7657DDAF880D8147E8B`.

[`raw/device-state-final.txt`](raw/device-state-final.txt) confirms the restored 720 x 1280 / density 320 / font scale 1.0 profile and disabled accessibility services before shutdown. [`raw/runtime-cleanup.txt`](raw/runtime-cleanup.txt) records removal of the reverse mapping, shutdown of the test app/emulator and verified repository-local Metro process tree, removal of named temporary files, and clear local ports 8081 and 27017.

## Limitations

- TalkBack was disabled (`accessibility_enabled=0`, no enabled accessibility services), so the XML exports are semantic inspection evidence, not a TalkBack traversal.
- API 24 cannot demonstrate Android 13 notification-permission behavior or predictive Back.
- Windows cannot provide an iOS build or simulator result, VoiceOver/Dynamic Type traversal, or native Liquid Glass evidence.
- No live Google Calendar, FCM, APNs, production account, or production backend was exercised.
- The synthetic preview has no retained-disconnected-ledger or externally-busy Google fixture, no `dirty=true` plus `saveState=error` notification fixture, and no Account success-feedback fixture. Those final states remain covered by focused renderer contracts; fresh disconnected Google, controlled notification error, semantic Account error, and all associated actions are present in this native matrix.
- The synthetic preview does not prove authenticated relaunch, account switching, SecureStore persistence, or live provider mutation/lifecycle behavior; those boundaries remain covered by automated contracts and require later environment-specific evidence.
