import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppShellPreview } from "../navigation/AppShellPreview";
import { ThemeProvider, DesignSystemPreview } from "../design-system";
import { referencePalette } from "../design-system/tokens";
import {
  ProfileSettingsPreview,
  type ProfileSettingsPreviewScenario,
} from "../profile/ProfileSettingsPreview";
import { type AuthOnboardingPreviewScenario, AuthOnboardingPreview } from "../auth/AuthOnboardingPreview";
import { CalendarPreview, type CalendarPreviewScenario } from "../calendar/CalendarPreview";
import { HomeDailyBriefPreview, type HomeDailyBriefPreviewScenario } from "../home/HomeDailyBriefPreview";
import { ContentFeedPreview, type ContentFeedPreviewScenario } from "../announcements/ContentFeedPreview";
import { MainApplication } from "./MainApplication";

export default function App() {
  const showPhase10ProfilePreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW === "1";
  const showPhase9CalendarPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW === "1";
  const showPhase8ContentFeedPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW === "1";
  const showPhase7HomePreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE7_HOME_PREVIEW === "1";
  const showPhase6AuthPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE6_AUTH_PREVIEW === "1";
  const showPhase5AppShellPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW === "1";
  const showPhase4DesignPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW === "1";

  if (showPhase10ProfilePreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <>
        <StatusBar backgroundColor={referencePalette.white} style="dark" translucent={false} />
        <ProfileSettingsPreview
          preference={previewTheme}
          scenario={process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_SCENARIO as ProfileSettingsPreviewScenario | undefined}
        />
      </>
    );
  }

  if (showPhase9CalendarPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <>
        <StatusBar backgroundColor={referencePalette.white} style="dark" translucent={false} />
        <CalendarPreview
          preference={previewTheme}
          scenario={process.env.EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_SCENARIO as CalendarPreviewScenario | undefined}
        />
      </>
    );
  }

  if (showPhase8ContentFeedPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <>
        <StatusBar backgroundColor={referencePalette.white} style="dark" translucent={false} />
        <ContentFeedPreview
          preference={previewTheme}
          scenario={process.env.EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_SCENARIO as ContentFeedPreviewScenario | undefined}
        />
      </>
    );
  }

  if (showPhase7HomePreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE7_HOME_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <>
        <StatusBar backgroundColor={referencePalette.academicBlueDeep} style="light" translucent={false} />
        <HomeDailyBriefPreview
          preference={previewTheme}
          scenario={process.env.EXPO_PUBLIC_PHASE7_HOME_PREVIEW_SCENARIO as HomeDailyBriefPreviewScenario | undefined}
        />
      </>
    );
  }

  if (showPhase6AuthPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    const previewScenario = process.env.EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO as AuthOnboardingPreviewScenario | undefined;
    return (
      <>
        <StatusBar backgroundColor={referencePalette.white} style="dark" translucent={false} />
        <AuthOnboardingPreview
          initialScenario={previewScenario}
          preference={previewTheme}
          showScenarioControls={!previewScenario}
        />
      </>
    );
  }

  if (showPhase5AppShellPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME === "dark"
      ? "dark"
      : process.env.EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME === "light"
        ? "light"
        : "system";

    return (
      <SafeAreaProvider>
        <ThemeProvider preference={previewTheme}>
          <StatusBar
            style={previewTheme === "dark" ? "light" : previewTheme === "light" ? "dark" : "auto"}
          />
          <AppShellPreview />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  if (showPhase4DesignPreview) {
    return (
      <SafeAreaProvider>
        <ThemeProvider preference="light">
          <StatusBar style="dark" />
          <DesignSystemPreview />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return <MainApplication />;
}
