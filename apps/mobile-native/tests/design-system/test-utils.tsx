import type { ReactElement } from "react";
import { renderAsync } from "@testing-library/react-native";
import {
  ThemeProvider,
  type ThemeProviderProps,
} from "../../src/design-system/theme";

type EnvironmentOverrides = Omit<ThemeProviderProps, "children">;

export function renderWithTheme(
  element: ReactElement,
  overrides: EnvironmentOverrides = {},
) {
  return renderAsync(
    <ThemeProvider
      liquidGlassAvailable={false}
      platform="android"
      preference="light"
      reducedMotion
      reducedTransparency={false}
      windowWidth={390}
      {...overrides}
    >
      {element}
    </ThemeProvider>,
  );
}
