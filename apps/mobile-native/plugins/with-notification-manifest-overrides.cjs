const { withAndroidManifest } = require("expo/config-plugins");

const metadataOverrides = new Map([
  ["com.google.firebase.messaging.default_notification_channel_id", "android:value"],
  ["com.google.firebase.messaging.default_notification_color", "android:resource"]
]);

module.exports = function withNotificationManifestOverrides(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) throw new Error("ANDROID_APPLICATION_MANIFEST_MISSING");

    manifest.$ = {
      ...manifest.$,
      "xmlns:tools": manifest.$?.["xmlns:tools"] ?? "http://schemas.android.com/tools"
    };

    for (const metadata of application["meta-data"] ?? []) {
      const replaceAttribute = metadataOverrides.get(metadata.$?.["android:name"]);
      if (replaceAttribute) metadata.$["tools:replace"] = replaceAttribute;
    }
    return modConfig;
  });
};
