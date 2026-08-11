import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import {
  ThemeProvider,
  type ThemePreference,
} from "../../src/design-system";

export interface NativeTestEnvironment {
  session: {
    status: "signed_out" | "signed_in";
    ownerId: string | null;
  };
  api: {
    status: "idle" | "loading" | "ready" | "empty" | "error";
  };
  integrations: {
    googleCalendar: "disconnected" | "connected" | "partial" | "error";
    notifications: "disabled" | "active" | "denied" | "error";
  };
  appearance: {
    platform: "ios" | "android";
    preference: ThemePreference;
    systemMode: "light" | "dark";
    windowWidth: number;
    fontScale: number;
    reducedMotion: boolean;
    reducedTransparency: boolean;
    liquidGlassAvailable: boolean;
  };
}

export const defaultNativeTestEnvironment: NativeTestEnvironment = {
  session: { status: "signed_out", ownerId: null },
  api: { status: "idle" },
  integrations: {
    googleCalendar: "disconnected",
    notifications: "disabled",
  },
  appearance: {
    platform: "android",
    preference: "light",
    systemMode: "light",
    windowWidth: 390,
    fontScale: 1,
    reducedMotion: true,
    reducedTransparency: false,
    liquidGlassAvailable: false,
  },
};

export const signedInLargeTextFixture: NativeTestEnvironment = {
  session: { status: "signed_in", ownerId: "fixture-owner" },
  api: { status: "ready" },
  integrations: {
    googleCalendar: "partial",
    notifications: "active",
  },
  appearance: {
    platform: "ios",
    preference: "system",
    systemMode: "dark",
    windowWidth: 320,
    fontScale: 2,
    reducedMotion: false,
    reducedTransparency: true,
    liquidGlassAvailable: true,
  },
};

const NativeTestEnvironmentContext =
  createContext<NativeTestEnvironment | null>(null);

export function NativeTestEnvironmentProvider({
  children,
  fixture = defaultNativeTestEnvironment,
}: {
  children: ReactNode;
  fixture?: NativeTestEnvironment;
}) {
  const { appearance } = fixture;
  return (
    <NativeTestEnvironmentContext.Provider value={fixture}>
      <ThemeProvider
        liquidGlassAvailable={appearance.liquidGlassAvailable}
        platform={appearance.platform}
        preference={appearance.preference}
        reducedMotion={appearance.reducedMotion}
        reducedTransparency={appearance.reducedTransparency}
        systemMode={appearance.systemMode}
        windowWidth={appearance.windowWidth}
      >
        {children}
      </ThemeProvider>
    </NativeTestEnvironmentContext.Provider>
  );
}

export function useNativeTestEnvironment(): NativeTestEnvironment {
  const environment = useContext(NativeTestEnvironmentContext);
  if (!environment) {
    throw new Error("Native test fixtures require NativeTestEnvironmentProvider");
  }
  return environment;
}
