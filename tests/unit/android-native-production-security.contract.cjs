const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { XMLParser } = require("fast-xml-parser");

const repoRoot = path.resolve(__dirname, "../..");
const securityPluginPath = path.join(
  repoRoot,
  "apps/mobile-native/plugins/with-android-production-security.cjs"
);
const security = require(securityPluginPath);

test("production manifest blocks risky permissions, backups, and cleartext traffic", () => {
  const fixture = manifestFixture();
  security.applyAndroidProductionSecurity(fixture);

  const manifest = fixture.manifest;
  const application = manifest.application[0];
  assert.equal(application.$["android:allowBackup"], "false");
  assert.equal(application.$["android:usesCleartextTraffic"], "false");
  assert.equal(application.$["android:networkSecurityConfig"], "@xml/network_security_config");
  assert.equal(application.$["android:fullBackupContent"], "@xml/backup_rules_deny_all");
  assert.equal(
    application.$["android:dataExtractionRules"],
    "@xml/data_extraction_rules_deny_all"
  );

  const permissions = new Map(
    manifest["uses-permission"].map((entry) => [entry.$["android:name"], entry.$])
  );
  assert.ok(permissions.has("android.permission.INTERNET"));
  for (const permission of security.removedProductionPermissions) {
    assert.equal(permissions.get(permission)?.["tools:node"], "remove");
  }
});

test("production deep links expose only the runtime allowlist hosts", () => {
  const fixture = manifestFixture();
  security.applyAndroidProductionSecurity(fixture);

  const mainActivity = fixture.manifest.application[0].activity[0];
  const deepLink = mainActivity["intent-filter"][1];
  assert.deepEqual(
    deepLink.data.map((entry) => entry.$),
    security.allowedDeepLinkHosts.map((host) => ({
      "android:scheme": "academicpulse",
      "android:host": host
    }))
  );
});

test("network and extraction resources deny release data egress", () => {
  const parser = new XMLParser({ ignoreAttributes: false });
  const releaseNetwork = parser.parse(
    security.androidSecurityResources["app/src/main/res/xml/network_security_config.xml"]
  );
  const debugNetwork = parser.parse(
    security.androidSecurityResources["app/src/debug/res/xml/network_security_config.xml"]
  );
  const legacyBackup = parser.parse(
    security.androidSecurityResources["app/src/main/res/xml/backup_rules_deny_all.xml"]
  );
  const extraction = parser.parse(
    security.androidSecurityResources["app/src/main/res/xml/data_extraction_rules_deny_all.xml"]
  );

  assert.equal(
    releaseNetwork["network-security-config"]["base-config"]["@_cleartextTrafficPermitted"],
    "false"
  );
  assert.equal(
    debugNetwork["network-security-config"]["base-config"]["@_cleartextTrafficPermitted"],
    "true"
  );
  assert.equal(legacyBackup["full-backup-content"].exclude.length, 9);
  assert.equal(extraction["data-extraction-rules"]["cloud-backup"].exclude.length, 9);
  assert.equal(extraction["data-extraction-rules"]["device-transfer"].exclude.length, 9);
});

test("release Gradle policy requires an explicit signed or unsigned identity mode", () => {
  const properties = security.applyAndroidReleaseGradleProperties([
    { type: "property", key: "EX_DEV_CLIENT_NETWORK_INSPECTOR", value: "true" }
  ]);
  const byKey = new Map(
    properties.filter((entry) => entry.type === "property").map((entry) => [entry.key, entry.value])
  );
  assert.equal(byKey.get("android.enableMinifyInReleaseBuilds"), "true");
  assert.equal(byKey.get("android.enableShrinkResourcesInReleaseBuilds"), "true");
  assert.equal(byKey.get("EX_DEV_CLIENT_NETWORK_INSPECTOR"), "false");

  const hardened = security.applyReleaseSigningPolicy(gradleFixture());
  assert.match(hardened, /AKADEMIK_RELEASE_MODE/u);
  assert.match(hardened, /signed.*unsigned/u);
  assert.match(hardened, /AKADEMIK_UPLOAD_STORE_FILE/u);
  assert.match(hardened, /usesDebugSigningIdentity/u);
  assert.match(hardened, /androiddebugkey/u);
  assert.match(hardened, /Signed release credentials are required/u);
  assert.match(hardened, /debug signing identity cannot be used/u);
  assert.match(hardened, /Unsigned release unexpectedly has a signing configuration/u);
  assert.match(hardened, /AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD/u);
  assert.match(hardened, /verify-android-google-auth-config\.mjs/u);
  assert.match(hardened, /verifyAkademikGoogleAuthRelease\(\)/u);
  assert.match(hardened, /verifyAkademikUploadSigningIdentity\(akademikReleaseMode, uploadSigning\)/u);
  assert.match(hardened, /pinned upload certificate/u);
  assert.match(hardened, /AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD_END/u);
  assert.match(hardened, /createBundleReleaseJsAndAssets/u);
  assert.match(hardened, /outputs\.upToDateWhen \{ false \}/u);
  assert.match(hardened, /verifyAkademikReleaseJsBundle\(task\)/u);
  assert.match(hardened, /pinned Web OAuth audience/u);
  assert.match(hardened, /incorrectly embeds a native OAuth client/u);
  assert.match(hardened, /packageReleaseBundle/u);
  assert.match(hardened, /signReleaseBundle/u);
  assert.match(hardened, /generateAutolinkingNewArchitectureFiles/u);
  assert.match(hardened, /AKADEMIK_WINDOWS_SHORT_MOBILE_ROOT/u);
  assert.match(hardened, /Windows release autolinking paths could not be shortened/u);
  assert.match(hardened, /Variant-specific google-services\.json files are forbidden/u);
  assert.doesNotMatch(
    hardened,
    /release \{\s*signingConfig signingConfigs\.debug/u
  );

  const hardenedAgain = security.applyReleaseSigningPolicy(hardened);
  assert.equal(hardenedAgain, hardened);

  const legacyGuard = hardened.replace("\n// AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD_END", "");
  const migratedGuard = security.applyReleaseSigningPolicy(legacyGuard);
  assert.match(migratedGuard, /AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD_END/u);
  assert.match(migratedGuard, /verifyAkademikUploadSigningIdentity/u);
});

test("Windows releases can consume a prewritten short-path autolinking config", () => {
  const fixture = `extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  if (System.getenv('EXPO_USE_COMMUNITY_AUTOLINKING') == '1') {
    ex.autolinkLibrariesFromCommand()
  } else {
    ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)
  }
}
`;
  const hardened = security.applyWindowsAutolinkingSettingsPolicy(fixture);
  assert.match(hardened, /AKADEMIK_WINDOWS_AUTOLINKING_CONFIG/u);
  assert.match(hardened, /autolinkLibrariesFromConfigFile/u);
  assert.match(hardened, /Windows release autolinking config is missing/u);
  assert.match(hardened, /else if \(System\.getenv\('EXPO_USE_COMMUNITY_AUTOLINKING'/u);
  assert.match(hardened, /autolinkLibrariesFromCommand\(expoAutolinking\.rnConfigCommand\)/u);
  assert.equal(security.applyWindowsAutolinkingSettingsPolicy(hardened), hardened);
});

test("Windows release orchestration refreshes only release-native and requested outputs", () => {
  const releaseScript = readFileSync(
    path.join(repoRoot, "scripts/build-android-release.mjs"),
    "utf8"
  );
  assert.match(releaseScript, /AKADEMIK_WINDOWS_AUTOLINKING_CONFIG/u);
  assert.match(releaseScript, /react-native-config[\s\S]*--platform[\s\S]*android[\s\S]*--json/u);
  assert.match(releaseScript, /remapMobileRootPaths/u);
  assert.match(releaseScript, /GRADLE_USER_HOME/u);
  assert.match(releaseScript, /refreshWindowsReleaseNativeCaches/u);
  assert.match(releaseScript, /join\(cxxDirectory, "RelWithDebInfo"\)/u);
  assert.match(releaseScript, /join\(cxxDirectory, "tools", "release"\)/u);
  assert.match(releaseScript, /"build", "intermediates", "cxx", "RelWithDebInfo"/u);
  assert.match(releaseScript, /removeRequestedReleaseOutputs\(artifactFormat\)/u);
  assert.equal(releaseScript.match(/removeRequestedReleaseOutputs\(artifactFormat\)/gu)?.length, 1);
  assert.ok(
    releaseScript.indexOf("removeRequestedReleaseOutputs(artifactFormat)")
      < releaseScript.indexOf("runWindowsGradle(gradleArguments, releaseEnvironment)")
  );
  assert.match(releaseScript, /resolveWindowsJavaHome/u);
  assert.match(releaseScript, /generatedAutolinkingCmake/u);
  assert.match(releaseScript, /verifyPackagedOAuthAudience\(label, artifact, identity\)/u);
  assert.match(releaseScript, /base\/assets\/index\.android\.bundle/u);
  assert.match(releaseScript, /verifySignedAabIdentity\(artifact, identity\)/u);
  assert.match(releaseScript, /the signed AAB certificate does not match the pinned upload identity/u);
  assert.doesNotMatch(releaseScript, /\["Debug"\]/u);
});

test("Gradle wrapper and app config retain the production policy across prebuild", () => {
  const wrapper = security.applyGradleWrapperChecksum([
    "distributionBase=GRADLE_USER_HOME",
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip",
    "validateDistributionUrl=true",
    ""
  ].join("\n"));
  assert.match(
    wrapper,
    new RegExp(`^distributionSha256Sum=${security.gradleDistributionSha256}$`, "mu")
  );

  const appConfig = JSON.parse(
    readFileSync(path.join(repoRoot, "apps/mobile-native/app.json"), "utf8")
  );
  assert.ok(
    appConfig.expo.plugins.includes("./plugins/with-android-production-security.cjs")
  );
});

function manifestFixture() {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      "uses-permission": [
        { $: { "android:name": "android.permission.INTERNET" } },
        { $: { "android:name": "android.permission.READ_EXTERNAL_STORAGE" } },
        { $: { "android:name": "android.permission.SYSTEM_ALERT_WINDOW" } }
      ],
      application: [{
        $: { "android:allowBackup": "true" },
        activity: [{
          $: { "android:name": ".MainActivity", "android:exported": "true" },
          "intent-filter": [
            {
              action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
              category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }]
            },
            {
              action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
              category: [
                { $: { "android:name": "android.intent.category.DEFAULT" } },
                { $: { "android:name": "android.intent.category.BROWSABLE" } }
              ],
              data: [{ $: { "android:scheme": "academicpulse" } }]
            }
          ]
        }]
      }]
    }
  };
}

function gradleFixture() {
  return `apply plugin: "com.android.application"

def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;
}
