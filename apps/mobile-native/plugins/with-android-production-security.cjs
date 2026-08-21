const fs = require("node:fs/promises");
const path = require("node:path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties
} = require("@expo/config-plugins");

const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android";
const TOOLS_NAMESPACE = "http://schemas.android.com/tools";
const GRADLE_DISTRIBUTION_SHA256 =
  "bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531";
const RELEASE_SIGNING_MARKER = "// AKADEMIK_RELEASE_SIGNING_POLICY";

const removedProductionPermissions = Object.freeze([
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW"
]);

const allowedDeepLinkHosts = Object.freeze([
  "tab",
  "announcements",
  "settings",
  "notification"
]);

const androidSecurityResources = Object.freeze({
  "app/src/main/res/xml/network_security_config.xml": `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`,
  "app/src/debug/res/xml/network_security_config.xml": `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system"/>
      <certificates src="user"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`,
  "app/src/main/res/xml/backup_rules_deny_all.xml": `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="."/>
  <exclude domain="file" path="."/>
  <exclude domain="database" path="."/>
  <exclude domain="sharedpref" path="."/>
  <exclude domain="external" path="."/>
  <exclude domain="device_root" path="."/>
  <exclude domain="device_file" path="."/>
  <exclude domain="device_database" path="."/>
  <exclude domain="device_sharedpref" path="."/>
</full-backup-content>
`,
  "app/src/main/res/xml/data_extraction_rules_deny_all.xml": `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
    <exclude domain="root" path="."/>
    <exclude domain="file" path="."/>
    <exclude domain="database" path="."/>
    <exclude domain="sharedpref" path="."/>
    <exclude domain="external" path="."/>
    <exclude domain="device_root" path="."/>
    <exclude domain="device_file" path="."/>
    <exclude domain="device_database" path="."/>
    <exclude domain="device_sharedpref" path="."/>
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="."/>
    <exclude domain="file" path="."/>
    <exclude domain="database" path="."/>
    <exclude domain="sharedpref" path="."/>
    <exclude domain="external" path="."/>
    <exclude domain="device_root" path="."/>
    <exclude domain="device_file" path="."/>
    <exclude domain="device_database" path="."/>
    <exclude domain="device_sharedpref" path="."/>
  </device-transfer>
</data-extraction-rules>
`
});

function applyAndroidProductionSecurity(androidManifest) {
  const manifest = androidManifest.manifest;
  const application = manifest.application?.[0];
  if (!application) throw new Error("ANDROID_APPLICATION_MANIFEST_MISSING");

  manifest.$ = {
    ...manifest.$,
    "xmlns:android": manifest.$?.["xmlns:android"] ?? ANDROID_NAMESPACE,
    "xmlns:tools": manifest.$?.["xmlns:tools"] ?? TOOLS_NAMESPACE
  };

  const permissionNodes = manifest["uses-permission"] ?? [];
  manifest["uses-permission"] = [
    ...permissionNodes.filter((entry) => (
      !removedProductionPermissions.includes(entry.$?.["android:name"])
    )),
    ...removedProductionPermissions.map((permission) => ({
      $: {
        "android:name": permission,
        "tools:node": "remove"
      }
    }))
  ];

  application.$ ??= {};
  Object.assign(application.$, {
    "android:allowBackup": "false",
    "android:usesCleartextTraffic": "false",
    "android:networkSecurityConfig": "@xml/network_security_config",
    "android:fullBackupContent": "@xml/backup_rules_deny_all",
    "android:dataExtractionRules": "@xml/data_extraction_rules_deny_all"
  });
  mergeToolsReplace(application.$, [
    "android:allowBackup",
    "android:usesCleartextTraffic",
    "android:networkSecurityConfig",
    "android:fullBackupContent",
    "android:dataExtractionRules"
  ]);

  restrictAcademicPulseDeepLink(application);
  return androidManifest;
}

function mergeToolsReplace(attributes, requiredAttributes) {
  const current = String(attributes["tools:replace"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  attributes["tools:replace"] = [...new Set([...current, ...requiredAttributes])].join(",");
}

function restrictAcademicPulseDeepLink(application) {
  const activities = application.activity ?? [];
  const mainActivity = activities.find((activity) => {
    const name = activity.$?.["android:name"];
    return name === ".MainActivity" || name?.endsWith(".MainActivity");
  });
  if (!mainActivity) throw new Error("ANDROID_MAIN_ACTIVITY_MISSING");

  const deepLinkFilter = (mainActivity["intent-filter"] ?? []).find((filter) => {
    const actions = (filter.action ?? []).map((entry) => entry.$?.["android:name"]);
    const categories = (filter.category ?? []).map((entry) => entry.$?.["android:name"]);
    const schemes = (filter.data ?? []).map((entry) => entry.$?.["android:scheme"]);
    return actions.includes("android.intent.action.VIEW")
      && categories.includes("android.intent.category.BROWSABLE")
      && schemes.includes("academicpulse");
  });
  if (!deepLinkFilter) throw new Error("ACADEMIC_PULSE_DEEP_LINK_FILTER_MISSING");

  deepLinkFilter.data = allowedDeepLinkHosts.map((host) => ({
    $: {
      "android:scheme": "academicpulse",
      "android:host": host
    }
  }));
}

function applyAndroidReleaseGradleProperties(properties) {
  const next = [...properties];
  setGradleProperty(next, "android.enableMinifyInReleaseBuilds", "true");
  setGradleProperty(next, "android.enableShrinkResourcesInReleaseBuilds", "true");
  setGradleProperty(next, "EX_DEV_CLIENT_NETWORK_INSPECTOR", "false");
  return next;
}

function setGradleProperty(properties, key, value) {
  const existing = properties.find((entry) => entry.type === "property" && entry.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: "property", key, value });
}

function applyReleaseSigningPolicy(contents) {
  let next = contents;
  if (!next.includes(RELEASE_SIGNING_MARKER)) {
    next = `${RELEASE_SIGNING_MARKER}\n${next}`;
  }

  if (!next.includes("AKADEMIK_UPLOAD_STORE_FILE")) {
    const projectRootPattern = /def projectRoot = [^\r\n]+/;
    if (!projectRootPattern.test(next)) throw new Error("ANDROID_PROJECT_ROOT_ANCHOR_MISSING");
    next = next.replace(projectRootPattern, (line) => `${line}\n${releaseSigningDefinitions()}`);

    const signingConfigPattern = /(\r?\n    signingConfigs \{\r?\n        debug \{[\s\S]*?\r?\n        \}\r?\n)(    \})/;
    if (!signingConfigPattern.test(next)) throw new Error("ANDROID_SIGNING_CONFIG_ANCHOR_MISSING");
    next = next.replace(
      signingConfigPattern,
      `$1${releaseSigningConfig()}$2`
    );

    const debugReleaseSigningPattern = /(\r?\n        release \{[\s\S]*?)(\r?\n\s*)signingConfig signingConfigs\.debug/;
    if (!debugReleaseSigningPattern.test(next)) {
      throw new Error("ANDROID_DEBUG_RELEASE_SIGNING_ANCHOR_MISSING");
    }
    next = next.replace(
      debugReleaseSigningPattern,
      `$1$2            if (hasUploadSigning) {\n                signingConfig signingConfigs.release\n            }`
    );
  } else if (!next.includes("usesDebugSigningIdentity")) {
    const uploadSigningPattern = /def hasUploadSigning = uploadSigning\.values\(\)\.every \{ value ->[\s\S]*?\r?\n\}/;
    if (!uploadSigningPattern.test(next)) throw new Error("ANDROID_UPLOAD_SIGNING_ANCHOR_MISSING");
    next = next.replace(
      uploadSigningPattern,
      (block) => `${block}\n${debugSigningIdentityDefinition()}`
    );
  }

  const guardPattern = /\r?\ngradle\.taskGraph\.whenReady \{[\s\S]*?\r?\n\}\s*$/;
  if (guardPattern.test(next)) {
    next = next.replace(guardPattern, `\n${releaseTaskGuard()}\n`);
  } else {
    next = `${next.trimEnd()}\n\n${releaseTaskGuard()}\n`;
  }
  return next;
}

function releaseSigningDefinitions() {
  return `def uploadSigning = [
    storeFile: System.getenv("AKADEMIK_UPLOAD_STORE_FILE"),
    storePassword: System.getenv("AKADEMIK_UPLOAD_STORE_PASSWORD"),
    keyAlias: System.getenv("AKADEMIK_UPLOAD_KEY_ALIAS"),
    keyPassword: System.getenv("AKADEMIK_UPLOAD_KEY_PASSWORD"),
]
def hasUploadSigning = uploadSigning.values().every { value ->
    value != null && !value.trim().isEmpty()
}
${debugSigningIdentityDefinition()}`;
}

function debugSigningIdentityDefinition() {
  return `def usesDebugSigningIdentity = hasUploadSigning && (
    uploadSigning.keyAlias.equalsIgnoreCase("androiddebugkey") ||
    file(uploadSigning.storeFile).canonicalFile == file("debug.keystore").canonicalFile
)`;
}

function releaseSigningConfig() {
  return `        if (hasUploadSigning) {
            release {
                storeFile file(uploadSigning.storeFile)
                storePassword uploadSigning.storePassword
                keyAlias uploadSigning.keyAlias
                keyPassword uploadSigning.keyPassword
            }
        }
`;
}

function releaseTaskGuard() {
  return `gradle.taskGraph.whenReady { graph ->
    def requestsReleaseArtifact = graph.allTasks.any { task ->
        task.path ==~ /:app:(assemble|bundle|package|install)Release/
    }
    if (requestsReleaseArtifact && !hasUploadSigning) {
        throw new GradleException("Release signing credentials are required; debug signing is not allowed.")
    }
    if (requestsReleaseArtifact && usesDebugSigningIdentity) {
        throw new GradleException("The Android debug signing identity cannot be used for a release artifact.")
    }
}`;
}

function applyGradleWrapperChecksum(contents) {
  const checksumLine = `distributionSha256Sum=${GRADLE_DISTRIBUTION_SHA256}`;
  if (/^distributionSha256Sum=.*$/mu.test(contents)) {
    return contents.replace(/^distributionSha256Sum=.*$/mu, checksumLine);
  }
  const distributionUrlPattern = /^(distributionUrl=.*)$/mu;
  if (!distributionUrlPattern.test(contents)) throw new Error("GRADLE_DISTRIBUTION_URL_MISSING");
  return contents.replace(distributionUrlPattern, `$1\n${checksumLine}`);
}

async function writeAndroidSecurityResources(platformProjectRoot) {
  for (const [relativePath, contents] of Object.entries(androidSecurityResources)) {
    const destination = path.join(platformProjectRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents, "utf8");
  }

  const wrapperProperties = path.join(
    platformProjectRoot,
    "gradle",
    "wrapper",
    "gradle-wrapper.properties"
  );
  const current = await fs.readFile(wrapperProperties, "utf8");
  await fs.writeFile(wrapperProperties, applyGradleWrapperChecksum(current), "utf8");
}

function withAndroidProductionSecurity(config) {
  config = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyAndroidProductionSecurity(modConfig.modResults);
    return modConfig;
  });

  config = withGradleProperties(config, (modConfig) => {
    modConfig.modResults = applyAndroidReleaseGradleProperties(modConfig.modResults);
    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = applyReleaseSigningPolicy(modConfig.modResults.contents);
    return modConfig;
  });

  return withDangerousMod(config, ["android", async (modConfig) => {
    await writeAndroidSecurityResources(modConfig.modRequest.platformProjectRoot);
    return modConfig;
  }]);
}

module.exports = withAndroidProductionSecurity;
module.exports.allowedDeepLinkHosts = allowedDeepLinkHosts;
module.exports.androidSecurityResources = androidSecurityResources;
module.exports.applyAndroidProductionSecurity = applyAndroidProductionSecurity;
module.exports.applyAndroidReleaseGradleProperties = applyAndroidReleaseGradleProperties;
module.exports.applyGradleWrapperChecksum = applyGradleWrapperChecksum;
module.exports.applyReleaseSigningPolicy = applyReleaseSigningPolicy;
module.exports.gradleDistributionSha256 = GRADLE_DISTRIBUTION_SHA256;
module.exports.removedProductionPermissions = removedProductionPermissions;
module.exports.writeAndroidSecurityResources = writeAndroidSecurityResources;
