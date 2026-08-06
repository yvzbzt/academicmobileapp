# Phase 12 final evidence index

Evidence date: 6 August 2026

Starting and accepted Phase 11 source: `f50a45bddcd7d476c4f1797bede77da65fc4c6fc`

Scope: final provenance, regression, security/configuration repair, Android
artifact, release-feed performance, and current-source native-evidence
reconciliation. All fixtures were synthetic and local. No production account,
calendar, notification token, or user data was accessed, and no live provider
was exercised. The
authorized Android build consumed existing ignored local provider/signing
inputs without exposing, recording, or changing their values.

## Why the screen matrix is reconciled rather than duplicated

Phase 12 changed production API secret enforcement and tracked Expo/native
generation configuration. It did not change production UI source. The Phase 11
installed Android matrix is therefore the representative current-source visual
set: 32 PNGs, 32 basename-matched UIAutomator XML exports, 33 raw records, and
97 integrity-index rows. The source-aligned Phase 11 index SHA-256 is
`AD1F872742FCD8819A25B61CBC8EE22F90234EA03BAA44EB32C96D629F2AA419`.

Use [the Phase 11 evidence register](../phase-11-native/README.md) and its
[integrity index](../phase-11-native/raw/integrity-index.csv) for the actual
captures. Phase 12 independently reconciles the index, routes, sizes, font
scales, keyboard/dialog states, theme/effects states, and Back transitions in
[`raw/native-evidence-reconciliation.txt`](./raw/native-evidence-reconciliation.txt).
No copied image is presented as a new capture.

## Phase 12 records

- [`raw/git-provenance.txt`](./raw/git-provenance.txt) — entry gate and milestone ancestry boundary.
- [`raw/artifact-metadata.txt`](./raw/artifact-metadata.txt) — current debug APK, signed AAB, merged manifest, and release-feed artifact identity/hashes.
- [`raw/validation-summary.txt`](./raw/validation-summary.txt) — complete/focused test, TypeScript, build, and performance results.
- [`raw/native-evidence-reconciliation.txt`](./raw/native-evidence-reconciliation.txt) — current-source visual mapping and explicit unavailable evidence.
- [`raw/security-hygiene.txt`](./raw/security-hygiene.txt) — final static/hygiene scan classifications and cleanup result.
- [`raw/integrity-index.csv`](./raw/integrity-index.csv) — SHA-256 and byte count for every Phase 12 record plus this README.

The debug APK and AAB remain ignored local build outputs and are not copied into
documentation. Their cryptographic identities are sufficient for this local
evidence register; neither artifact was uploaded or published. The final scoped
commit is identified by Git history and the completion response because a
commit cannot embed its own object ID.

## Evidence limits

The authorized AVD is API 24. It is not proof of Android 13 notification
permission, modern predictive Back, or current TalkBack traversal. Windows
cannot establish iOS/Xcode signing, native Liquid Glass, swipe Back, Dynamic
Type, Reduce Transparency, or VoiceOver. The run used no live Google Calendar,
FCM, APNs, SMTP, authenticated content/provider, Play Console, or App Store
fixture. The tablet surface is an emulator display override, and performance is
not physical-device or fleet evidence. No installed authenticated native E2E
runner exists.
