import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const targetUrl = new URL(
  "../node_modules/react-native-screens/android/src/fabric/java/com/swmansion/rnscreens/NativeProxy.kt",
  import.meta.url,
);
const targetPath = fileURLToPath(targetUrl);
const unsafeBlock = `        if (screen is Screen) {
            screen.startRemovalTransition()
        } else {`;
const uiThreadBlock = `        if (screen is Screen) {
            val isScheduled =
                screen.post {
                    screen.startRemovalTransition()
                }
            if (!isScheduled) {
                Log.w("[RNScreens]", "Failed to schedule removal transition start for screen with tag $screenTag")
            }
        } else {`;

const source = await readFile(targetPath, "utf8");
if (source.includes(uiThreadBlock)) process.exit(0);
if (!source.includes(unsafeBlock)) {
  throw new Error(
    "react-native-screens NativeProxy.kt has changed; review the UI-thread removal patch before building.",
  );
}

await writeFile(targetPath, source.replace(unsafeBlock, uiThreadBlock), "utf8");
console.log("Patched react-native-screens removal transitions onto the Android UI thread.");
