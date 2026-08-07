# Phase 6 Android native presentation evidence

Evidence date: 1 August 2026

Platform: Android 7.0/API 24/x86_64 AVD `AcademicPhase1Low`

Application: `com.anssoft.akademiktakvim`, debug/Metro development runtime

Phase 6 base HEAD: `abdf0cc427039ddd324ef5964902c12839927d6b` plus the uncommitted Phase 6 working tree

This directory contains 20 curated 720×1280 PNG screenshots and 20 same-state UIAutomator XML hierarchies. Every PNG was opened at original resolution and visually reviewed. Each XML/PNG pair was captured from the same running emulator state and shares an exact descriptive basename.

The running application selected the real extracted Phase 6 screens through the synthetic `AuthOnboardingPreview`. That preview is available only when both `__DEV__` and `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW=1` are true. Named captures use `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO`; dark captures additionally use `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME=dark`. All identity-like values use `phase6.invalid`, all behavior is preview-local, and no API, storage, Google provider, email inbox, notification provider, credential, token, production account, or production data was accessed.

## What this evidence proves

- The extracted Login, Registration, Verification, password-recovery, and academic-onboarding components render in a running Android application on the repository's sole authorized AVD.
- The 360 dp light matrix exposes persistent labels, password actions, registration policy feedback, a masked four-digit verification/cooldown state, the three recovery stages, recovery success returned to Login, academic hierarchy/review/action states, selector presentation, and success feedback.
- The exact 320 dp matrix was captured at 720 px / 360 dpi. Login content remains scroll-reachable at normal scale; the keyboard remains open while IME Next transfers focus from email to password.
- The two font-scale-2.0 captures jointly cover the top and scrolled primary-action portions of the exact 320 dp Login surface. They are complementary scroll positions, not a claim that the complete long form fits in one viewport.
- The dark matrix covers Login default/actions and Registration using the explicit development theme selection; the corresponding light captures show the same component states.
- UIAutomator exposes the labelled fields, buttons, feedback, selector state, focus transition, and bounds represented by the paired captures.

This is native presentation and interaction evidence for synthetic state. It is not live registration, email delivery, Google account selection, backend mutation, persisted-session recovery, screen-reader traversal, or automated end-to-end acceptance.

## Reproducible capture commands

The evidence run used the installed debug APK plus the repository-local Metro server. The named scenario and theme values were changed between the bounded groups listed in the artifact table.

```powershell
# Terminal A, from the native application root.
Set-Location <REPO_ROOT>\apps\mobile-native
$env:EXPO_OFFLINE='1'
$env:EXPO_PUBLIC_PHASE6_AUTH_PREVIEW='1'
$env:EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO='login'
$env:EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME='light'
npm.cmd run start -- --port 8081

# Terminal B.
Set-Location <REPO_ROOT>\apps\mobile-native
$adb='<ANDROID_SDK_ROOT>\platform-tools\adb.exe'
& $adb install -r -d .\android\app\build\outputs\apk\debug\app-debug.apk
& $adb reverse tcp:8081 tcp:8081
& $adb shell am start -n com.anssoft.akademiktakvim/.MainActivity

# Native 720 px / 320 dpi = 360 dp.
& $adb shell wm density reset
& $adb shell settings put system font_scale 1.0

# Exact compact-width matrix: 720 px / 360 dpi = 320 dp.
& $adb shell wm density 360
& $adb shell settings put system font_scale 1.0

# Exact-320-dp large-text matrix.
& $adb shell settings put system font_scale 2.0

# One same-state accessibility/screenshot pair.
$phase6EvidenceRoot='<REPO_ROOT>\docs\mobile-native-redesign\evidence\phase-06-native'
$name='android-api24-360dp-light-font1x-login-default'
& $adb shell uiautomator dump "/sdcard/$name.xml"
& $adb pull "/sdcard/$name.xml" "$phase6EvidenceRoot\hierarchies\$name.xml"
& $adb shell screencap -p "/sdcard/$name.png"
& $adb pull "/sdcard/$name.png" "$phase6EvidenceRoot\screenshots\$name.png"
```

The IME evidence tapped the Android keyboard's visible Next control rather than simulating a hardware Enter key. `dumpsys input_method` reported `mInputShown=true` and `mIsInputViewShown=true`, while UIAutomator moved `focused="true"` from `E-posta adresi` to `Şifre`. After capture, density and `font_scale` were restored to 320 and 1.0. The final APK reinstall returned `Success`, and `com.anssoft.akademiktakvim/.MainActivity` exposed the `Tekrar hoş geldin` header. The preview app was then stopped, the ADB reverse was removed, and the local Metro listener was closed; the existing emulator was retained at its restored settings.

## Curated artifact index

All hashes are SHA-256 over the curated artifact bytes.

| State and review purpose | PNG / SHA-256 | UIAutomator XML / SHA-256 |
|---|---|---|
| Exact 320 dp, light, font 1.0 Login default; compact-width baseline | [`android-api24-320dp-light-font1x-login-default.png`](screenshots/android-api24-320dp-light-font1x-login-default.png)<br>`026406878D534FE59B841616B100C6FD4C4BB56468FF4B03773FAA3B2D774947` | [`android-api24-320dp-light-font1x-login-default.xml`](hierarchies/android-api24-320dp-light-font1x-login-default.xml)<br>`F20888D213F77A3817930B9F1D572F7FFA01C88CF531D52A60653DE6DC60B6BB` |
| Exact 320 dp, light, font 1.0; keyboard open and email focused before IME Next | [`android-api24-320dp-light-font1x-login-keyboard-email-visible.png`](screenshots/android-api24-320dp-light-font1x-login-keyboard-email-visible.png)<br>`62C177A56AF9D864127D0409EB0135FED9C9689AAF2F48715DB8F8C4025BABD4` | [`android-api24-320dp-light-font1x-login-keyboard-email-visible.xml`](hierarchies/android-api24-320dp-light-font1x-login-keyboard-email-visible.xml)<br>`C877E4A054449FBB155E0924AE894FE7C5C85BA931F9E11D9D7B7E8760A15DF3` |
| Exact 320 dp, light, font 1.0; same open keyboard after IME Next, password focused | [`android-api24-320dp-light-font1x-login-keyboard-password-focus.png`](screenshots/android-api24-320dp-light-font1x-login-keyboard-password-focus.png)<br>`8CEE372CC79EBE5BAE86C584741A068DBA6BEE7A861D2B9C3C580D666D019425` | [`android-api24-320dp-light-font1x-login-keyboard-password-focus.xml`](hierarchies/android-api24-320dp-light-font1x-login-keyboard-password-focus.xml)<br>`53C00AB80EFFD4A9983E92ED708798C6B0776AE5F790542406E42AC83937A478` |
| Exact 320 dp, light, font 2.0 Login top; large-text wrapping/scroll start | [`android-api24-320dp-light-font2x-login-top.png`](screenshots/android-api24-320dp-light-font2x-login-top.png)<br>`C5E656A06BFCA7662AC2280AB55A152679A390CC19B7F849729650D02810EC75` | [`android-api24-320dp-light-font2x-login-top.xml`](hierarchies/android-api24-320dp-light-font2x-login-top.xml)<br>`CC5DC2F4349E0BC29B4E3058F406581E5B4EED76DE16D9E0FB9BAA64D574DF1A` |
| Exact 320 dp, light, font 2.0 Login scrolled primary actions; large-text reachability | [`android-api24-320dp-light-font2x-login-primary.png`](screenshots/android-api24-320dp-light-font2x-login-primary.png)<br>`9090312ACAFAAD45806C56E39E47510B63193176978255143FA28D0487A86C77` | [`android-api24-320dp-light-font2x-login-primary.xml`](hierarchies/android-api24-320dp-light-font2x-login-primary.xml)<br>`6F9490D267D65AE01044998C212A8A07872B00FF90DEDDD1C831ABC47E56461B` |
| 360 dp, dark, font 1.0 Login default | [`android-api24-360dp-dark-font1x-login-default.png`](screenshots/android-api24-360dp-dark-font1x-login-default.png)<br>`7959B53302518401BAC65B972354EC15E390393D9796B910C79D0EB937EFCDC2` | [`android-api24-360dp-dark-font1x-login-default.xml`](hierarchies/android-api24-360dp-dark-font1x-login-default.xml)<br>`33F73B722657BC0E69CA5F79830DA5D6059C3F986818B8E2BFE96667C2DBD5E3` |
| 360 dp, dark, font 1.0 Login scrolled actions/provider-unavailable state | [`android-api24-360dp-dark-font1x-login-actions.png`](screenshots/android-api24-360dp-dark-font1x-login-actions.png)<br>`99C8AC125349BE2D7140B0FB3962A6207040E21D7414EBF8FAD9C03453CDA993` | [`android-api24-360dp-dark-font1x-login-actions.xml`](hierarchies/android-api24-360dp-dark-font1x-login-actions.xml)<br>`BC4D8E74B64F89F8317B61110E4DA1A923AF8238D4A57DBA567BEFAF22C962E6` |
| 360 dp, dark, font 1.0 Registration and min-10/matching feedback | [`android-api24-360dp-dark-font1x-registration.png`](screenshots/android-api24-360dp-dark-font1x-registration.png)<br>`47630B591E78ED834985E0EFA1FC8382140E5A644C7E0626A15014FB2D483636` | [`android-api24-360dp-dark-font1x-registration.xml`](hierarchies/android-api24-360dp-dark-font1x-registration.xml)<br>`3F4F33D1E76CD27F9A9A20277CCEB404916B346322661EFFB4211B7AEB443518` |
| 360 dp, light, font 1.0 Login default | [`android-api24-360dp-light-font1x-login-default.png`](screenshots/android-api24-360dp-light-font1x-login-default.png)<br>`5771FD639F16760612834E7846975A85FB702C5CE62193C6F9025B9367D2A1DA` | [`android-api24-360dp-light-font1x-login-default.xml`](hierarchies/android-api24-360dp-light-font1x-login-default.xml)<br>`33F73B722657BC0E69CA5F79830DA5D6059C3F986818B8E2BFE96667C2DBD5E3` |
| 360 dp, light, font 1.0 Login actions/provider-unavailable state | [`android-api24-360dp-light-font1x-login-actions.png`](screenshots/android-api24-360dp-light-font1x-login-actions.png)<br>`4C7888058FD96F27DF1B599CF57CC9A42D543156D1352543D3287D6F3132B6BC` | [`android-api24-360dp-light-font1x-login-actions.xml`](hierarchies/android-api24-360dp-light-font1x-login-actions.xml)<br>`BC4D8E74B64F89F8317B61110E4DA1A923AF8238D4A57DBA567BEFAF22C962E6` |
| 360 dp, light, font 1.0 Registration and min-10/matching feedback | [`android-api24-360dp-light-font1x-registration.png`](screenshots/android-api24-360dp-light-font1x-registration.png)<br>`2FB6E4A4DBE4E161390F29FBBF889C89BF9CBA61DB757CB798456B40BC4F0DC8` | [`android-api24-360dp-light-font1x-registration.xml`](hierarchies/android-api24-360dp-light-font1x-registration.xml)<br>`3F4F33D1E76CD27F9A9A20277CCEB404916B346322661EFFB4211B7AEB443518` |
| 360 dp, light, font 1.0 Verification, masked email, four-digit code, active cooldown | [`android-api24-360dp-light-font1x-verification-cooldown.png`](screenshots/android-api24-360dp-light-font1x-verification-cooldown.png)<br>`695A9293A2BEFD87F95D305271DEE1676F4A4AB4E387D8208B9F327C4889C701` | [`android-api24-360dp-light-font1x-verification-cooldown.xml`](hierarchies/android-api24-360dp-light-font1x-verification-cooldown.xml)<br>`ED2EFB30AD099793FBA5EBD8731A9E8C45E8F7379509B02D32A59FB9FBB12A23` |
| 360 dp, light, font 1.0 Recovery request | [`android-api24-360dp-light-font1x-recovery-request.png`](screenshots/android-api24-360dp-light-font1x-recovery-request.png)<br>`3E1F586E22C2D2ED1ACE1663A5C29AEF1D63618766CCF01DD59095ED132A9509` | [`android-api24-360dp-light-font1x-recovery-request.xml`](hierarchies/android-api24-360dp-light-font1x-recovery-request.xml)<br>`E3868DBAA21CD2528857914CABFC9AB5859106B04EA3637BCFF85E1DDF9D3855` |
| 360 dp, light, font 1.0 Recovery exact six-digit code/cooldown | [`android-api24-360dp-light-font1x-recovery-code.png`](screenshots/android-api24-360dp-light-font1x-recovery-code.png)<br>`8FBB4EEBFA5F49233171E6ABA31749FD3378A4D96B7BD2132D92400E44BC5BC1` | [`android-api24-360dp-light-font1x-recovery-code.xml`](hierarchies/android-api24-360dp-light-font1x-recovery-code.xml)<br>`25BAC394FAB892E84C07246E16FD72F9028D6EC2B49D218BE579223A5798637F` |
| 360 dp, light, font 1.0 Recovery new password/confirmation | [`android-api24-360dp-light-font1x-recovery-new-password.png`](screenshots/android-api24-360dp-light-font1x-recovery-new-password.png)<br>`984374BB63043F59C054259264F02AB4396D46E44F84191375940BAFC9008E7F` | [`android-api24-360dp-light-font1x-recovery-new-password.xml`](hierarchies/android-api24-360dp-light-font1x-recovery-new-password.xml)<br>`937E604562F3C8649E4F8A65C8BA6CB940C5ACF17E7ED944A8204F385CAB40A3` |
| 360 dp, light, font 1.0 Recovery success feedback returned to Login | [`android-api24-360dp-light-font1x-recovery-success-return-login.png`](screenshots/android-api24-360dp-light-font1x-recovery-success-return-login.png)<br>`D1D1208A7523D97CBB858A65B3126FC5677F4DEEEE0216DD5543E7E7A9EE23E4` | [`android-api24-360dp-light-font1x-recovery-success-return-login.xml`](hierarchies/android-api24-360dp-light-font1x-recovery-success-return-login.xml)<br>`72A8013F99701F319442B1AA19442C1E40030CBD8ED2B236AD9956C9E4D6ED80` |
| 360 dp, light, font 1.0 Academic onboarding identity and hierarchy start | [`android-api24-360dp-light-font1x-academic-onboarding.png`](screenshots/android-api24-360dp-light-font1x-academic-onboarding.png)<br>`00FDF9F2229BDD09C63DBA441258110989D9620F5544DE7100DF3331DC7F4F9E` | [`android-api24-360dp-light-font1x-academic-onboarding.xml`](hierarchies/android-api24-360dp-light-font1x-academic-onboarding.xml)<br>`39A7E50F8F7B349309D85F07878F503980C71ADAFD975FD829E61FDA594D62F6` |
| 360 dp, light, font 1.0 Open university search/selector | [`android-api24-360dp-light-font1x-onboarding-university-selector.png`](screenshots/android-api24-360dp-light-font1x-onboarding-university-selector.png)<br>`49B9F0CA29914F53B17B0DB1709C9897D18D70D66E0D03489113927E5A6DF384` | [`android-api24-360dp-light-font1x-onboarding-university-selector.xml`](hierarchies/android-api24-360dp-light-font1x-onboarding-university-selector.xml)<br>`5C13F14691D0B3D3ABB0FDE68CFE74C5C6322DAE227DE637878C463BC21FDC86` |
| 360 dp, light, font 1.0 Academic review and final save action | [`android-api24-360dp-light-font1x-onboarding-summary-action.png`](screenshots/android-api24-360dp-light-font1x-onboarding-summary-action.png)<br>`A7CCCA799497DD9F30F59799B78227F2ED559A0ECAC1E8D587ACF03BBAA6C2CB` | [`android-api24-360dp-light-font1x-onboarding-summary-action.xml`](hierarchies/android-api24-360dp-light-font1x-onboarding-summary-action.xml)<br>`B4AC30A1936DA8679F3493982AB927D82CFC75EAB8A63D1190C80746FDDA5C33` |
| 360 dp, light, font 1.0 Academic save success feedback | [`android-api24-360dp-light-font1x-onboarding-success.png`](screenshots/android-api24-360dp-light-font1x-onboarding-success.png)<br>`66230A0AF0405694E7C542AD566D704E1C057485F9AB25AB9E3060454CD02DA0` | [`android-api24-360dp-light-font1x-onboarding-success.xml`](hierarchies/android-api24-360dp-light-font1x-onboarding-success.xml)<br>`48CBFEC52270C8CCC5FAEB570E7D3F4EC4CDA549A9D48DF70ED5B39CA4E3DEDC` |

The light and dark XML hashes may be byte-identical where the semantic tree, text, and bounds are identical; UIAutomator does not encode the rendered color pixels. The paired PNG hashes differ and carry the visual-theme evidence.

## Capture matrix result

| Requirement | Result | Boundary |
|---|---|---|
| 360 dp light auth/onboarding presentation | PASS for the curated synthetic states listed above | Real components in a running Android app; no backend/provider traffic |
| Exact 320 dp Login | PASS for default, keyboard focus transfer, and scroll reachability | 720 px / 360 dpi; Login surface only |
| 200% text | PASS for the complementary Login top and scrolled-primary captures | Exact 320 dp, `font_scale=2.0`; not a complete all-screen large-text matrix |
| Keyboard/IME Next | PASS: keyboard remains open and focus changes from email to password | UIAutomator `focused="true"` changes between the paired states; no hardware-keyboard/iOS claim |
| Light/dark | PASS for explicit development renderer selection | Dark Login/Registration plus light counterparts; not OS-controlled theme-switch acceptance |
| Recovery return | PASS for preview-local Confirm → success feedback on Login | Synthetic state transition only; no recovery API, email, persistence, or fresh live login |
| Academic selector/review/success | PASS for preview-local presentation | Synthetic `.invalid` options; no `/me/university` request |

## Exact blockers and non-claims

- Windows has no Xcode, iOS runtime, or simulator. There is no iOS build, screenshot, keyboard, Dynamic Type, VoiceOver, swipe-back, or native visual acceptance in this directory.
- TalkBack is unavailable on the authorized API 24 image. UIAutomator and semantic Jest queries do not replace TalkBack traversal.
- API 24 cannot exercise Android predictive-Back callbacks or animation. The application retains the supported callback opt-out; ordinary Back must not be presented as predictive-Back evidence.
- No authorized non-production Google provider/account fixture was available. The real account chooser, cancellation/provider error boundary, and incomplete-Google-profile handoff were not exercised.
- No installed-app native E2E framework exists in the repository. These captures do not close live registration→verification→onboarding→Home, unverified-account recovery, password reset→fresh login, or Google incomplete-profile→onboarding E2E.
- The APK is debug signed and development JavaScript is Metro-served. This is not a release, store, publish, performance, or offline-bundle artifact.
- No Phase 7 surface or behavior is represented.

## Integrity checks

The directory is complete when all of the following hold:

- exactly 20 PNG files and 20 XML files exist;
- every PNG is 720×1280;
- the PNG and XML basename sets are identical;
- every SHA-256 digest matches the table above;
- no artifact contains a real credential, token, production account, or production content.

The test/build ledger and the distinction between synthetic native presentation evidence and missing live E2E/provider/platform acceptance are recorded in [`TEST_MATRIX.md`](../../TEST_MATRIX.md) and the [Phase 6 report](../../phases/phase-06-auth-onboarding-ui.md).
