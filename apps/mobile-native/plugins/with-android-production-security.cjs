const fs = require("node:fs/promises");
const path = require("node:path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withSettingsGradle
} = require("@expo/config-plugins");

const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android";
const TOOLS_NAMESPACE = "http://schemas.android.com/tools";
const GRADLE_DISTRIBUTION_SHA256 =
  "bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531";
const RELEASE_SIGNING_MARKER = "// AKADEMIK_RELEASE_SIGNING_POLICY";
const GOOGLE_AUTH_RELEASE_GUARD_MARKER = "// AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD";
const GOOGLE_AUTH_RELEASE_GUARD_END_MARKER = "// AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD_END";
const WINDOWS_AUTOLINKING_SETTINGS_MARKER = "// AKADEMIK_WINDOWS_AUTOLINKING_CONFIG";

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

function applyWindowsAutolinkingSettingsPolicy(contents) {
  if (contents.includes(WINDOWS_AUTOLINKING_SETTINGS_MARKER)) return contents;

  const reactSettingsBlock = /extensions\.configure\(com\.facebook\.react\.ReactSettingsExtension\) \{ ex ->\r?\n  if \(System\.getenv\('EXPO_USE_COMMUNITY_AUTOLINKING'\) == '1'\) \{\r?\n    ex\.autolinkLibrariesFromCommand\(\)\r?\n  \} else \{\r?\n    ex\.autolinkLibrariesFromCommand\(expoAutolinking\.rnConfigCommand\)\r?\n  \}\r?\n\}/u;
  if (!reactSettingsBlock.test(contents)) {
    throw new Error("ANDROID_REACT_SETTINGS_AUTOLINKING_ANCHOR_MISSING");
  }

  const guardedBlock = `extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  ${WINDOWS_AUTOLINKING_SETTINGS_MARKER}
  def akademikWindowsAutolinkingConfig = System.getenv("AKADEMIK_WINDOWS_AUTOLINKING_CONFIG")
  if (akademikWindowsAutolinkingConfig) {
    def akademikWindowsAutolinkingFile = new File(akademikWindowsAutolinkingConfig)
    if (!akademikWindowsAutolinkingFile.isFile()) {
      throw new GradleException("The Windows release autolinking config is missing.")
    }
    ex.autolinkLibrariesFromConfigFile(akademikWindowsAutolinkingFile)
  } else if (System.getenv('EXPO_USE_COMMUNITY_AUTOLINKING') == '1') {
    ex.autolinkLibrariesFromCommand()
  } else {
    ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)
  }
}`;
  return contents.replace(reactSettingsBlock, guardedBlock);
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
      `$1$2            if (akademikReleaseMode == "signed" && hasUploadSigning) {\n                signingConfig signingConfigs.release\n            }`
    );
  } else if (!next.includes("usesDebugSigningIdentity")) {
    const uploadSigningPattern = /def hasUploadSigning = uploadSigning\.values\(\)\.every \{ value ->[\s\S]*?\r?\n\}/;
    if (!uploadSigningPattern.test(next)) throw new Error("ANDROID_UPLOAD_SIGNING_ANCHOR_MISSING");
    next = next.replace(
      uploadSigningPattern,
      (block) => `${block}\n${debugSigningIdentityDefinition()}`
    );
  }

  const googleAuthBlock = `${googleAuthReleaseDefinitions()}\n`;
  const currentGoogleAuthBlockPattern = /\/\/ AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD[\s\S]*?\/\/ AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD_END\r?\n?/u;
  const legacyGoogleAuthBlockPattern = /\/\/ AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD[\s\S]*?(?=\r?\ndef akademikReleaseMode =)/u;
  if (currentGoogleAuthBlockPattern.test(next)) {
    next = next.replace(currentGoogleAuthBlockPattern, googleAuthBlock);
  } else if (legacyGoogleAuthBlockPattern.test(next)) {
    next = next.replace(legacyGoogleAuthBlockPattern, googleAuthBlock.trimEnd());
  } else {
    const projectRootPattern = /def projectRoot = [^\r\n]+/;
    if (!projectRootPattern.test(next)) throw new Error("ANDROID_PROJECT_ROOT_ANCHOR_MISSING");
    next = next.replace(
      projectRootPattern,
      (line) => `${line}\n${googleAuthBlock.trimEnd()}`
    );
  }

  if (!next.includes("AKADEMIK_RELEASE_MODE")) {
    const uploadSigningAnchor = /def uploadSigning = \[/;
    if (!uploadSigningAnchor.test(next)) throw new Error("ANDROID_UPLOAD_SIGNING_ANCHOR_MISSING");
    next = next.replace(
      uploadSigningAnchor,
      `${releaseModeDefinition()}\ndef uploadSigning = [`
    );
  }
  next = next.replace(
    /if \(hasUploadSigning\) \{/gu,
    'if (akademikReleaseMode == "signed" && hasUploadSigning) {'
  );

  const guardPattern = /\r?\ngradle\.taskGraph\.whenReady \{[\s\S]*?\r?\n\}\s*$/;
  if (guardPattern.test(next)) {
    next = next.replace(guardPattern, `\n${releaseTaskGuard()}\n`);
  } else {
    next = `${next.trimEnd()}\n\n${releaseTaskGuard()}\n`;
  }
  return next;
}

function releaseSigningDefinitions() {
  return `${releaseModeDefinition()}
def uploadSigning = [
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

function releaseModeDefinition() {
  return `def akademikReleaseMode = System.getenv("AKADEMIK_RELEASE_MODE") ?: ""`;
}

function googleAuthReleaseDefinitions() {
  return `${GOOGLE_AUTH_RELEASE_GUARD_MARKER}
def akademikGoogleAuthVerifier = new File(projectRoot, "../../scripts/verify-android-google-auth-config.mjs").canonicalFile
def akademikGoogleAuthContract = new File(projectRoot, "android-release-identity.json").canonicalFile
def akademikGoogleServices = new File(projectDir, "google-services.json").canonicalFile
def akademikGoogleAuthAppConfig = new File(projectRoot, "app.json").canonicalFile
def akademikGoogleAuthAppSource = new File(projectRoot, "App.tsx").canonicalFile
def shortenAkademikWindowsAutolinkingPaths = { autolinkingTask ->
    def longMobileRoot = System.getenv("AKADEMIK_WINDOWS_LONG_MOBILE_ROOT")
    def shortMobileRoot = System.getenv("AKADEMIK_WINDOWS_SHORT_MOBILE_ROOT")
    if (!longMobileRoot || !shortMobileRoot || longMobileRoot.equalsIgnoreCase(shortMobileRoot)) return
    def generatedCmake = new File(
        projectDir,
        "build/generated/autolinking/src/main/jni/Android-autolinking.cmake"
    )
    if (!generatedCmake.isFile()) {
        throw new GradleException("Windows release autolinking output is missing.")
    }
    def longPrefix = longMobileRoot.replace("\\\\", "/")
    def shortPrefix = shortMobileRoot.replace("\\\\", "/")
    def current = generatedCmake.getText("UTF-8")
    def shortened = current.replaceAll(
        "(?i)" + java.util.regex.Pattern.quote(longPrefix),
        java.util.regex.Matcher.quoteReplacement(shortPrefix)
    )
    if (shortened == current && !current.toLowerCase(java.util.Locale.ROOT).contains(
        shortPrefix.toLowerCase(java.util.Locale.ROOT)
    )) {
        throw new GradleException("Windows release autolinking paths could not be shortened.")
    }
    generatedCmake.write(shortened, "UTF-8")
}
tasks.matching { task -> task.name == "generateAutolinkingNewArchitectureFiles" }.configureEach { task ->
    if (System.getenv("AKADEMIK_WINDOWS_SHORT_MOBILE_ROOT")) {
        task.outputs.upToDateWhen { false }
    }
    task.doLast {
        shortenAkademikWindowsAutolinkingPaths(task)
    }
}
def verifyAkademikReleaseJsBundle = { releaseTask ->
    def identity = new groovy.json.JsonSlurper().parse(akademikGoogleAuthContract)
    def bundleCandidates = releaseTask.outputs.files.files.collectMany { output ->
        if (output.isFile() && output.name == "index.android.bundle") return [output]
        if (!output.isDirectory()) return []
        return fileTree(output) {
            include "**/index.android.bundle"
        }.files
    }.unique { output -> output.canonicalPath }
    if (bundleCandidates.size() != 1) {
        throw new GradleException("The fresh Android release JavaScript bundle could not be identified.")
    }
    def bundleContents = bundleCandidates.first().getText("UTF-8")
    if (!bundleContents.contains(identity.webOauthClientId)) {
        throw new GradleException("The Android release bundle does not contain the pinned Web OAuth audience.")
    }
    def embedsNativeClient = identity.androidOauthClients.values().any { nativeIdentity ->
        bundleContents.contains(nativeIdentity.clientId)
    }
    if (embedsNativeClient) {
        throw new GradleException("The Android release bundle incorrectly embeds a native OAuth client as runtime configuration.")
    }
}
tasks.matching { task -> task.name == "createBundleReleaseJsAndAssets" }.configureEach { task ->
    // Release identity changes must always produce a fresh embedded JS bundle.
    task.outputs.upToDateWhen { false }
    task.doLast {
        verifyAkademikReleaseJsBundle(task)
    }
}
def normalizeAkademikCertificateHash = { value ->
    String.valueOf(value ?: "").replaceAll("[^A-Fa-f0-9]", "").toLowerCase(java.util.Locale.ROOT)
}
def akademikCertificateDigest = { algorithm, certificate ->
    java.security.MessageDigest.getInstance(algorithm)
        .digest(certificate.encoded)
        .collect { value -> String.format(java.util.Locale.ROOT, "%02x", value & 0xff) }
        .join()
}
def verifyAkademikUploadSigningIdentity = { releaseMode, signing ->
    if (releaseMode != "signed") return
    def identity = new groovy.json.JsonSlurper().parse(akademikGoogleAuthContract)
    def expectedSha1 = normalizeAkademikCertificateHash(identity.androidOauthClients.upload.certificateSha1)
    def expectedSha256 = normalizeAkademikCertificateHash(identity.androidOauthClients.upload.certificateSha256)
    def signingStore = file(signing.storeFile).canonicalFile
    def loadedKeyStore = null
    for (def keyStoreType : ["PKCS12", "JKS"]) {
        if (loadedKeyStore != null) break
        try {
            def candidate = java.security.KeyStore.getInstance(keyStoreType)
            signingStore.withInputStream { stream ->
                candidate.load(stream, signing.storePassword.toCharArray())
            }
            loadedKeyStore = candidate
        } catch (Exception ignored) {
            // Try the other standard Android keystore container format.
        }
    }
    if (loadedKeyStore == null) {
        throw new GradleException("The Android release keystore could not be validated.")
    }
    def certificate = loadedKeyStore.getCertificate(signing.keyAlias)
    if (certificate == null) {
        throw new GradleException("The Android release key alias has no certificate.")
    }
    def actualSha1 = akademikCertificateDigest("SHA-1", certificate)
    def actualSha256 = akademikCertificateDigest("SHA-256", certificate)
    if (actualSha1 != expectedSha1 || actualSha256 != expectedSha256) {
        throw new GradleException("The Android release signer does not match the pinned upload certificate.")
    }
}
def verifyAkademikGoogleServicesLayout = { appDirectory ->
    def variantOverrides = fileTree(new File(appDirectory, "src")) {
        include "**/google-services.json"
    }.files
    if (!variantOverrides.isEmpty()) {
        throw new GradleException("Variant-specific google-services.json files are forbidden for production releases.")
    }
}
def verifyAkademikGoogleAuthRelease = {
    def command = [
        System.getenv("NODE_BINARY") ?: "node",
        akademikGoogleAuthVerifier.absolutePath,
        "--contract", akademikGoogleAuthContract.absolutePath,
        "--app-config", akademikGoogleAuthAppConfig.absolutePath,
        "--google-services", akademikGoogleServices.absolutePath,
        "--app-source", akademikGoogleAuthAppSource.absolutePath,
        "--env-dir", projectRoot,
    ]
    def verifierProcess = new ProcessBuilder(command)
        .directory(rootDir)
        .redirectErrorStream(true)
        .start()
    def verifierOutput = verifierProcess.inputStream.getText("UTF-8").trim()
    def verifierExitCode = verifierProcess.waitFor()
    if (verifierExitCode != 0) {
        throw new GradleException(verifierOutput
            ? "Android Google authentication release preflight failed:\\n\${verifierOutput}"
            : "Android Google authentication release preflight failed without diagnostic output.")
    }
    if (!verifierOutput.isEmpty()) println verifierOutput
}
${GOOGLE_AUTH_RELEASE_GUARD_END_MARKER}`;
}

function releaseSigningConfig() {
  return `        if (akademikReleaseMode == "signed" && hasUploadSigning) {
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
        task.path ==~ /:app:(assembleRelease|bundleRelease|packageRelease|packageReleaseBundle|signReleaseBundle|installRelease)/
    }
    if (requestsReleaseArtifact && !(akademikReleaseMode in ["signed", "unsigned"])) {
        throw new GradleException("AKADEMIK_RELEASE_MODE must be explicitly set to signed or unsigned.")
    }
    if (requestsReleaseArtifact && akademikReleaseMode == "signed" && !hasUploadSigning) {
        throw new GradleException("Signed release credentials are required; debug signing is not allowed.")
    }
    if (requestsReleaseArtifact && akademikReleaseMode == "signed" && usesDebugSigningIdentity) {
        throw new GradleException("The Android debug signing identity cannot be used for a release artifact.")
    }
    if (requestsReleaseArtifact && akademikReleaseMode == "unsigned" && android.buildTypes.release.signingConfig != null) {
        throw new GradleException("Unsigned release unexpectedly has a signing configuration.")
    }
    if (requestsReleaseArtifact && akademikReleaseMode == "signed") {
        verifyAkademikUploadSigningIdentity(akademikReleaseMode, uploadSigning)
    }
    if (requestsReleaseArtifact) {
        verifyAkademikGoogleServicesLayout(projectDir)
        verifyAkademikGoogleAuthRelease()
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

  config = withSettingsGradle(config, (modConfig) => {
    modConfig.modResults.contents = applyWindowsAutolinkingSettingsPolicy(
      modConfig.modResults.contents
    );
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
module.exports.applyWindowsAutolinkingSettingsPolicy = applyWindowsAutolinkingSettingsPolicy;
module.exports.gradleDistributionSha256 = GRADLE_DISTRIBUTION_SHA256;
module.exports.removedProductionPermissions = removedProductionPermissions;
module.exports.writeAndroidSecurityResources = writeAndroidSecurityResources;
