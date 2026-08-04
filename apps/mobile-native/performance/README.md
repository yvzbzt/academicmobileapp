# Android release feed performance check

Run the repository-owned check from the workspace root:

```powershell
npm.cmd run measure:mobile-native:feed-release
```

The command requires one connected Android `x86_64` emulator/device, the
configured Android SDK, and the existing local release-signing configuration.
Set `ANDROID_SERIAL` when more than one device is connected.

The runner refuses to replace an already installed application by default. A
known disposable or read-only emulator session may explicitly set
`FEED_PERFORMANCE_EPHEMERAL_DEVICE=1`; in that mode the runner removes the
pre-existing package inside that ephemeral session before installing the
benchmark. The benchmark package is always uninstalled during teardown.

## Measurement contract

The runner builds `assembleRelease` with
`ENTRY_FILE=index.feed-performance.ts`, `x86_64` as the only React Native ABI,
`NODE_ENV=production`, and `--rerun-tasks`. The alternate entry renders `AnnouncementsFeed` directly
with the existing deterministic 100-record `long-feed` fixture. The ordinary
application entry and the dual-gated development preview remain unchanged.

Before measuring, the runner verifies all of the following:

- the APK declares only the `x86_64` native ABI;
- neither APK badging nor installed-package flags mark it debuggable;
- the runtime accessibility hierarchy exposes the 100-record harness marker;
- startup logs contain no Metro/development-server connection error.

After a fixed 15-second post-build host-settling interval, it performs one
unmeasured warm scroll, resets `gfxinfo`, then records five measured warm-scroll
trials from Android `framestats`. The harness forces the light theme with
reduced motion enabled. One scroll exercise is six 450 ms upward swipes followed
by six 450 ms downward swipes between 82% and 24% of the screen height. A trial
repeats that exercise at most three times only when the dump has not yet reached
the required 100 valid frames. Only complete rows with
`Flags=0` and a positive `FrameCompleted - IntendedVsync` duration count.
Percentiles use the nearest-rank method over the aggregate of all five trials.

Acceptance requires:

- at least 100 valid frames in every measured trial;
- aggregate p90 no greater than 32 ms;
- aggregate p95 no greater than 50 ms;
- zero frames at or above 700 ms.

The command prints the APK SHA-256, ABI and non-debuggable proof, device and
screen metadata (API level, model, build fingerprint, AVD, density, graphics
renderer, font scale, refresh rate, and animation scales), each trial's frame count, aggregate statistics, and failure
reasons as JSON. It force-stops the test package and removes its temporary UI
hierarchy file in `finally`, and uninstalls the benchmark package; it does not
change display settings or add an ADB reverse port. The canonical release APK
created from the alternate entry is deleted after its hash and measurement are
captured so it cannot be mistaken for a publishable application artifact. If a
canonical release APK existed before the run, its bytes and timestamps are
restored during teardown.

The checked-in acceptance record is
[`release-evidence.json`](./release-evidence.json). It retains the rejected
SwiftShader control and the reverted virtualization experiment as well as the
accepted host-rendered run. This distinction prevents software-renderer
overhead from being mislabeled as a proven product-code bottleneck.
