import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "../design-system";
import { AnnouncementsFeed } from "./AnnouncementsFeed";
import {
  CONTENT_FEED_PREVIEW_LONG_FEED_SIZE,
  createContentFeedPreviewFixture,
} from "./ContentFeedPreview";

type PerformanceStackParamList = {
  FeedPerformance: undefined;
};

const PerformanceStack = createNativeStackNavigator<PerformanceStackParamList>();
const performanceFixture = createContentFeedPreviewFixture("long-feed");

export const CONTENT_FEED_PERFORMANCE_RECORD_COUNT =
  CONTENT_FEED_PREVIEW_LONG_FEED_SIZE;
export const CONTENT_FEED_PERFORMANCE_MARKER =
  `Release feed performance harness, ${CONTENT_FEED_PERFORMANCE_RECORD_COUNT} records`;

if (
  performanceFixture.academicItems.length
    + performanceFixture.yokItems.length
    + performanceFixture.summerItems.length
  !== CONTENT_FEED_PERFORMANCE_RECORD_COUNT
) {
  throw new Error("CONTENT_FEED_PERFORMANCE_FIXTURE_SIZE_MISMATCH");
}

/**
 * Release-only entry surface used by the Android framestats runner. It imports
 * the existing deterministic 100-record fixture directly and never selects the
 * development-gated preview component or the authenticated application shell.
 */
export function ContentFeedPerformanceHarness() {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <ThemeProvider preference="light" reducedMotion>
        <NavigationContainer>
          <PerformanceStack.Navigator screenOptions={{ headerShown: false }}>
            <PerformanceStack.Screen name="FeedPerformance">
              {() => <PerformanceFeed />}
            </PerformanceStack.Screen>
          </PerformanceStack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function PerformanceFeed() {
  const theme = useTheme();

  return (
    <View style={{ backgroundColor: theme.colors.background.canvas, flex: 1 }}>
      <Text
        accessibilityLabel={CONTENT_FEED_PERFORMANCE_MARKER}
        style={{
          backgroundColor: theme.colors.background.canvas,
          color: theme.colors.text.secondary,
          fontSize: 12,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xxs,
        }}
        testID="phase8-feed-performance-record-count-100"
      >
        {CONTENT_FEED_PERFORMANCE_MARKER}
      </Text>
      <AnnouncementsFeed
        academicItems={performanceFixture.academicItems}
        yokItems={performanceFixture.yokItems}
        summerItems={performanceFixture.summerItems}
        universityName="Performance fixture"
        attempted
        serverLimit={CONTENT_FEED_PERFORMANCE_RECORD_COUNT}
        onOpenItem={() => undefined}
      />
    </View>
  );
}
