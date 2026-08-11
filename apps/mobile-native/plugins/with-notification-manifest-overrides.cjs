const { withAndroidManifest } = require("expo/config-plugins");

const metadataOverrides = new Map([
  [
    "com.google.firebase.messaging.default_notification_channel_id",
    { attribute: "android:value", fallback: "academic-updates" }
  ],
  [
    "com.google.firebase.messaging.default_notification_color",
    { attribute: "android:resource", fallback: "@color/notification_icon_color" }
  ]
]);

function applyNotificationManifestOverrides(androidManifest) {
  const manifest = androidManifest.manifest;
  const application = manifest.application?.[0];
  if (!application) throw new Error("ANDROID_APPLICATION_MANIFEST_MISSING");

  manifest.$ = {
    ...manifest.$,
    "xmlns:tools": manifest.$?.["xmlns:tools"] ?? "http://schemas.android.com/tools"
  };

  application["meta-data"] ??= [];
  for (const [name, { attribute, fallback }] of metadataOverrides) {
    let metadata = application["meta-data"].find(
      (item) => item.$?.["android:name"] === name
    );
    if (!metadata) {
      metadata = { $: { "android:name": name, [attribute]: fallback } };
      application["meta-data"].push(metadata);
    }

    metadata.$["tools:replace"] = attribute;
  }

  return androidManifest;
}

module.exports = function withNotificationManifestOverrides(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyNotificationManifestOverrides(modConfig.modResults);
    return modConfig;
  });
};

module.exports.applyNotificationManifestOverrides = applyNotificationManifestOverrides;
