# Phase 1 Native Android Evidence

Status date: 29 July 2026\
Scope: Phase 1 final closure only
Baseline commit: `cbd0067b03c3cf7286270df25164a556c55b55b9`

This directory is the text evidence index for the single authorized Android closure environment and current-source debug build. It does not treat Expo Web, Expo export, a pre-existing APK, or a source-derived layout formula as native visual evidence.

Current disposition: hydration, verification recovery/resend/error separation, verification-success→later-Login-failure, password recovery, password visibility, reset/old-new Login/session revocation, two-account persistence/isolation, academic hierarchy replacement, logout-staleness, 360-dp, 320-dp, and the complete six-surface 200%-font set pass. Home navigation labels wrap/truncate at 2.0. TalkBack is exactly unavailable on the selected image; that blocker is documented without claiming screen-reader acceptance. Final automation and resource cleanup pass; checkpoint SHA is reported externally because the commit cannot contain its own hash.

## Evidence files

- [`android-environment.md`](./android-environment.md) — official Studio/SDK/image/AVD, configured versus effective resources, launch command, and deviations.
- [`artifact-manifest.md`](./artifact-manifest.md) — debug build, expected package/version, install/capture artifact slots, and hash policy.
- [`capture-hashes.md`](./capture-hashes.md) — historical PNG filenames, sizes, timestamps, hashes, and the exact 11-file safe retained subset; 45 transient/sensitive PNGs and 144 XML dumps were deleted.
- [`startup-logcat.md`](./startup-logcat.md) — exact redacted fatal/native-module/React-JS startup filter and result.
- [`talkback-blocker.md`](./talkback-blocker.md) — exact package/service checks proving TalkBack is unavailable on the retained minimal image.
- [`native-qa-results.md`](./native-qa-results.md) — required authentication, persistence, hierarchy, logout, responsive, font-scale, and TalkBack matrix.

- [`runtime-auth-contract.md`](./runtime-auth-contract.md) — sanitized same-runtime known/unknown recovery parity and two-session revocation results.

## Evidence policy

- Only synthetic identities and redacted content may appear in screenshots, recordings, UI dumps, or logcat extracts.
- Do not commit APK/AAB files, Android Studio/SDK/AVD files, secrets, tokens, email addresses, recovery/verification codes, passwords, or personal exam content.
- If binary capture policy excludes a screenshot/recording from Git, record its historical absolute local path, byte size, SHA-256 hash, build/package metadata, state fixture, redaction status, and retention disposition in the evidence set.
- Configured AVD values and runtime-reported values are separate evidence. Runtime overrides must remain visible.
- Every closure row is resolved as PASS or BLOCKED. A blank path or source assertion is not a native result.

Phase 2 remains prohibited until the Phase 1 success matrix is final.
