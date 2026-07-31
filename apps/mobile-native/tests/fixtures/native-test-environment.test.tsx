import { Text } from "react-native";
import {
  renderAsync,
  screen,
} from "@testing-library/react-native";
import {
  usePlatformAdaptation,
  useReducedMotion,
  useReducedTransparency,
  useTheme,
} from "../../src/design-system";
import {
  NativeTestEnvironmentProvider,
  signedInLargeTextFixture,
  useNativeTestEnvironment,
} from "./native-test-environment";

function FixtureProbe() {
  const fixture = useNativeTestEnvironment();
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const reducedMotion = useReducedMotion();
  const reducedTransparency = useReducedTransparency();
  return (
    <Text accessibilityLabel="Deterministic fixture" accessibilityRole="summary">
      {[
        fixture.session.status,
        fixture.session.ownerId,
        fixture.api.status,
        fixture.integrations.googleCalendar,
        fixture.integrations.notifications,
        fixture.appearance.fontScale,
        theme.mode,
        adaptation.platform,
        adaptation.navigationMaterial,
        adaptation.screenGutter,
        reducedMotion ? "reduced-motion" : "system-motion",
        reducedTransparency ? "reduced-transparency" : "system-transparency",
      ].join("|")}
    </Text>
  );
}

describe("deterministic native test environment", () => {
  it("provides session, API, integration, font-scale, theme, and platform state together", async () => {
    await renderAsync(
      <NativeTestEnvironmentProvider fixture={signedInLargeTextFixture}>
        <FixtureProbe />
      </NativeTestEnvironmentProvider>,
    );

    expect(screen.getByRole("summary", { name: "Deterministic fixture" })).toHaveTextContent(
      "signed_in|fixture-owner|ready|partial|active|2|dark|ios|opaque-tonal|16|system-motion|reduced-transparency",
    );
  });
});
