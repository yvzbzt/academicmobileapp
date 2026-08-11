# Local Native Capture Hash Register

This is the historical hash register for Android emulator PNGs reviewed during closure. The filename, size, timestamp, and SHA-256 identify each binary as captured; they do not imply that every binary is still retained. A filename is not a functional PASS; outcome and redaction review belong in `native-qa-results.md` and `artifact-manifest.md`.

## Post-QA privacy retention

After review and hashing, 45 transient or potentially sensitive PNGs and all 144 UIAutomator XML dumps were deleted from `C:\tmp`. Cleanup verification returned `NO_UNSAFE_PHASE1_CAPTURES_REMAIN`. Exactly these 11 reviewed, non-secret PNGs remain outside Git:

- `layout-320-verification-profile.png`
- `layout-320-register.png`
- `layout-320-recovery.png`
- `font-200-login-controls.png`
- `font-200-register-fields.png`
- `font-200-home-clean.png`
- `font-200-profile.png`
- `font-200-verification-actions2.png`
- `font-200-recovery-request-actions.png` — synthetic documentation-domain address only
- `font-200-recovery-confirm-fields.png` — invalid synthetic code marker and blank password placeholders only
- `font-200-recovery-confirm-actions.png` — blank password placeholders only

Every other filename in the table below is a historical path/hash whose binary was deleted after its result was reconciled. None is required as the sole evidence for a PASS verdict.

| Local filename under `C:\tmp` | Bytes | Captured at (+03:00) | SHA-256 |
|---|---:|---|---|
| `after-forgot-tap.png` | 90,027 | 2026-07-29 15:58:17 | `B222A55082D06180951C0F43D6D1E1581DE7D11D613776F16708DFA579E7F4C7` |
| `exam-a-added.png` | 100,693 | 2026-07-29 16:23:25 | `B4A7FC6CDCC466B5D48A10A4762174026B9C4FC2BFD04A1136E8A3F18E6DD1BD` |
| `exam-a-relaunch.png` | 103,906 | 2026-07-29 16:24:03 | `671FC95193CC3D155CD6B316E132763A8B3E2569AAA5D6883ABFDA512BF9DE95` |
| `exam-b-added.png` | 92,258 | 2026-07-29 16:36:45 | `AC657FD6B17B224F8E92BC5349574B6C2E6F451B4F456C9D19832DD7A6B6BC07` |
| `hydration-final.png` | 16,968 | 2026-07-29 16:17:59 | `B5E07BF0A5931E0B2FD1A3CD4960B518C001FDE0F93EF127275CEEA5D150DBE5` |
| `hydration-final-2.png` | 113,967 | 2026-07-29 16:22:02 | `E7437EDD20CD4E659C1FE73DCD58531C5EC7CC7F4DF3FDEBF44C92211F907A0A` |
| `hydration-immediate.png` | 16,968 | 2026-07-29 16:17:56 | `B5E07BF0A5931E0B2FD1A3CD4960B518C001FDE0F93EF127275CEEA5D150DBE5` |
| `hydration-immediate-2.png` | 15,305 | 2026-07-29 16:21:48 | `EF3662E264E2108910BE32703BF3A5F9D5B654D3CE781DEC8999A4DB97F42956` |
| `hydration-ready.png` | 17,094 | 2026-07-29 16:18:48 | `1B8B06B07D5E06FBD483ECFBF076669169BF416B217AE80FB8B741FA80ACDA3E` |
| `login-new-accepted.png` | 99,465 | 2026-07-29 16:17:20 | `9CE9BFE4915996E438F8A64AA0C51AFF0CE5F4A2741403B5CD7959B7BC15C287` |
| `login-old-ready.png` | 81,132 | 2026-07-29 16:13:01 | `74F9636CB5A3E00B8698F395D2D00A143BF5F6BAEEFE71E0E5ADB2803EA6A8A7` |
| `login-old-rejected.png` | 79,909 | 2026-07-29 16:15:15 | `6B1DEB7D5DF374E93D4DED3CF4776E7FC7494EB85C3E0380B74AC1D7F5EB9665` |
| `logout-a.png` | 85,648 | 2026-07-29 16:25:47 | `0539D3140A09ADC9E1B9AFF613FC25E03AE533EAD618D46B75CA0CA034CB5DFA` |
| `phase1-login.png` | 16,282 | 2026-07-29 15:52:14 | `5D3124545A1F5ED3E3EBEFF893000BD7D8B8A4A0C988F3E5CEC8FA7CE6D1D134` |
| `phase1-login-ready.png` | 89,958 | 2026-07-29 15:53:08 | `B93B05AFAD364E5823BB96AEE0CCF0F1D0241D76C3C2C270C082AAF9374E2068` |
| `recovery-after-new.png` | 65,662 | 2026-07-29 16:08:37 | `2F39BF6EC5CD95548DAF5D3A79315235F16D08551FD50A97FC9B73331AD8D772` |
| `recovery-code.png` | 102,721 | 2026-07-29 16:00:55 | `12A70ADDDC07688020671FB11FF8692A4CCA60F0C438342893AA22A7AB5A818E` |
| `recovery-fields.png` | 78,054 | 2026-07-29 16:01:26 | `538FEAE4D04B7D7103F87087A99357221AEAC6FD7D815D12C57CA8C48DBFC994` |
| `recovery-invalid-code-ready.png` | 68,124 | 2026-07-29 16:01:53 | `F2993D83EC9466839B51EA3B5E735E1DA650D57E8C174BD827EB889ECBA806FE` |
| `recovery-invalid-message.png` | 96,364 | 2026-07-29 16:09:35 | `1A9815CC9AF48D24011AE17BCE8B19237EAEE8D8599367FD5E5D4F720F0D0E72` |
| `recovery-invalid-ready.png` | 58,555 | 2026-07-29 16:08:53 | `1BC6C5F206A25E1A764C97EF3CA4B86861C761E4ADFE8B1E2D731686BC8051D7` |
| `recovery-invalid-result.png` | 61,988 | 2026-07-29 16:09:14 | `2206547E909823D23C1DC42431CB7B01188BEE4B70017333653B18D5902EB90F` |
| `recovery-keyboard-result.png` | 84,764 | 2026-07-29 16:12:29 | `C82A2695DA71C274D403EE4DCAE844065948EF1505619C28793BDCAC6FDA723B` |
| `recovery-resend-ready.png` | 57,931 | 2026-07-29 16:10:01 | `DC38DE452255DB35F5D66DAD8CAD086E76DEBCCA022E435D28471C9AE74F970C` |
| `recovery-success.png` | 84,401 | 2026-07-29 16:10:29 | `30488C369CF29EE52B962689FCDD8DED8AFDA548842406AE4B391188DAFB4AC0` |
| `recovery-success-final.png` | 85,927 | 2026-07-29 16:11:25 | `E82972C8B9B869E6F0A8E678E43DBE015DD4213CCA5841A8F352EC897478786B` |
| `user-a-return.png` | 94,197 | 2026-07-29 16:40:56 | `75854CB5D422D671BD9A41FA52902F523129B29C37C20380F59FF1A994C54ED5` |
| `verification-recovered.png` | 96,570 | 2026-07-29 17:01:01 | `BA275259017C9FB90426B4ACF865B757A3F73138DDA7A5B2EF65588717E9B8AF` |
| `verification-resend-ready.png` | 80,223 | 2026-07-29 17:01:51 | `8259FEAC6584A60647EFAF48504E59610AAFDB60589C59CC2E83C56070F9E4E0` |
| `verification-resend-recovered.png` | 82,066 | 2026-07-29 17:02:36 | `261362029AF765191A1DAC39A1221B3994A06BA9D41FF38DA50D0B187BC1CFF1` |
| `verification-complete.png` | 85,099 | 2026-07-29 17:03:59 | `5B5AF5AA0208B56B0282A7C83C9CD937A77C0439103EF2778E09F23E4831DEB9` |
| `verification-complete-final.png` | 97,282 | 2026-07-29 17:04:33 | `52B71CEFDE056835EF615C04415296A56E89C2B81AD86729617F3BBE19308BB2` |
| `layout-320-verification-profile.png` | 86,767 | 2026-07-29 17:05:32 | `F669B1988729BAC66663462B4F6D4A0238A5F199D89E47041480735CF917B6A9` |
| `layout-320-register.png` | 91,208 | 2026-07-29 17:06:24 | `D5E1E4AD420FCABC4B22E76A2998071E50BED33598221850517AA306E69CB1BE` |
| `layout-320-recovery.png` | 87,857 | 2026-07-29 17:09:05 | `05E55DBDE4F036FA2368599A9F4655524E2700EE04E58C92E98A308CC8C2E031` |
| `font-200-recovery.png` | 96,867 | 2026-07-29 17:10:50 | `9DA0887829EB3BC2DE22EA725847424E7F4B1692A89ACFECBC9194FBB2619DF4` |
| `font-200-login-controls.png` | 87,401 | 2026-07-29 17:11:17 | `D05DE15B5C4CCBB4A26229B072AA7EF2309B5FC8B1B557E262EDDBC413B3A9E9` |
| `font-200-register.png` | 96,693 | 2026-07-29 17:12:08 | `2509CAD6F7ECDB27A13FFCECF32D05F0AF36DFB9F8F2AFAF20763CEA53F884E4` |
| `font-200-register-fields.png` | 101,628 | 2026-07-29 17:12:33 | `7B22B029629F139CDA440677ECBB839F30F21A5EC6AA9697A396BDCD0F6DA362` |
| `font-200-post-login.png` | 87,788 | 2026-07-29 17:14:28 | `B0B48D0635DB5426C3CBFA6F9C7FD6F468B2162FF97BD19F93590334AE9D29B2` |
| `font-200-home-clean.png` | 110,467 | 2026-07-29 17:14:59 | `67CA446B0F58CCA0C0B124BE314A54D39F9495BC92D6580350D8EBA6FE1B4242` |
| `font-200-profile.png` | 109,113 | 2026-07-29 17:15:26 | `21D5E8339D393444D79B0225E1C6EF1302178197003DF6706861B73C2EA114CD` |
| `unverified-login-result.png` | 91,570 | 2026-07-29 17:39:50 | `14BCBCB191DEDF36CA3CDA8BABCD852EF2FD4228C3A8836D19F3014FB7AF42D3` |
| `verification-invalid-fast.png` | 87,800 | 2026-07-29 17:42:56 | `9AD7B429D6646CC5C73661EA454F453BB93423FD2F9E50DC828DB180DB5A2AF1` |
| `font-200-verification-top.png` | 95,838 | 2026-07-29 17:45:24 | `3502B0EBD4C8629C938C22AB52DEDC7BB4EB435DB3CEA2636ED00E3571C48C65` |
| `font-200-verification-actions2.png` | 88,835 | 2026-07-29 17:46:05 | `574DBF02A4644835EF76B84E843DE568D0BD50F124937EFC1D79748548B0938D` |
| `font-200-recovery-request-actions.png` | 98,926 | 2026-07-29 17:52:18 | `B046AA5B68670B0E78846A91140A3693BFB53FE3517BD576C6C9F6C250F7B11B` |
| `font-200-recovery-request-heading.png` | 88,880 | 2026-07-29 17:52:49 | `BEDB85EF7578ED4C7A85995F3342CF18FF9D3A0DB47698F2D4B1A526B8A381C0` |
| `font-200-recovery-confirm-fields.png` | 84,007 | 2026-07-29 17:59:01 | `7DACE9BA12A862B55A51C61358E26DC2466F3867A05E3618945B439754F9A4F9` |
| `font-200-recovery-confirm-actions.png` | 84,425 | 2026-07-29 17:59:06 | `95F6D046BEAB7A46590981FFF35A5833E6870670DDC7F397E268BF5E2B3432DF` |
| `separation-verification-success.png` | 98,219 | 2026-07-29 18:08:13 | `282FF91645D3720A60B908B491EFFFBA99E6EA563B13415D21EDB4497FDC9A33` |
| `separation-login-failure.png` | 98,693 | 2026-07-29 18:09:00 | `55085B0DD638C08F7A7D93A7A218A62E5A95916B6C7E77FA8919B5301589B68E` |

The 144 UIAutomator XML files accompanying these captures were deleted after result reconciliation because they can contain fixture field text and are not required binary evidence. The closure report uses controlled fixture labels rather than reproducing field values.

All captures above used device `emulator-5554`, API 24 Google APIs x86_64, package `com.anssoft.akademiktakvim` `0.1.1` (12), light application theme, and synthetic fixtures only. Unless prefixed `layout-320-` or `font-200-`, captures used 720 × 1280 at 320 dpi with default font scale. The `layout-320-*` set used physical 720 × 1280 with a 640 × 1280 override at 320 dpi and default font scale. The `font-200-*` set used 720 × 1280 at 320 dpi and font scale 2.0. Display/font overrides were reset after capture. Reviewer: closure runner with documentation reconciliation by Codex.

Filename warning: `layout-320-verification-profile.png` visually contains the 320 dp Login surface, and `font-200-recovery.png` visually contains the large-font Login/hero surface. Filenames are retained to preserve hash identity; neither file is cited as evidence for a Verification or Password Recovery surface it does not show.
