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

test("release Gradle policy minifies and refuses missing or debug signing identities", () => {
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
  assert.match(hardened, /AKADEMIK_UPLOAD_STORE_FILE/u);
  assert.match(hardened, /usesDebugSigningIdentity/u);
  assert.match(hardened, /androiddebugkey/u);
  assert.match(hardened, /Release signing credentials are required/u);
  assert.match(hardened, /debug signing identity cannot be used/u);
  assert.doesNotMatch(
    hardened,
    /release \{\s*signingConfig signingConfigs\.debug/u
  );
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
