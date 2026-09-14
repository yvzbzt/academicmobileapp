jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  const actual = jest.requireActual("react-native-safe-area-context");
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };

  return {
    ...actual,
    SafeAreaFrameContext: actual.SafeAreaFrameContext,
    SafeAreaInsetsContext: actual.SafeAreaInsetsContext,
    SafeAreaProvider: ({
      children,
      initialMetrics,
    }: {
      children: React.ReactNode;
      initialMetrics?: { frame: typeof frame; insets: typeof insets };
    }) => React.createElement(
      actual.SafeAreaFrameContext.Provider,
      { value: initialMetrics?.frame ?? frame },
      React.createElement(
        actual.SafeAreaInsetsContext.Provider,
        { value: initialMetrics?.insets ?? insets },
        children,
      ),
    ),
    SafeAreaConsumer: ({
      children,
    }: {
      children: (value: typeof insets) => React.ReactNode;
    }) => React.createElement(actual.SafeAreaInsetsContext.Consumer, null, (value: typeof insets | null) => children(value ?? insets)),
    SafeAreaView: ({
      children,
      edges: _edges,
      ...props
    }: {
      children: React.ReactNode;
      edges?: string[];
    }) => React.createElement(View, props, children),
    initialWindowMetrics: { insets, frame },
    useSafeAreaFrame: () => React.useContext(actual.SafeAreaFrameContext) ?? frame,
    useSafeAreaInsets: () => React.useContext(actual.SafeAreaInsetsContext) ?? insets,
  };
});

jest.mock("expo-glass-effect", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    GlassView: ({
      children,
      glassEffectStyle: _glassEffectStyle,
      colorScheme: _colorScheme,
      isInteractive: _isInteractive,
      ...props
    }: {
      children: React.ReactNode;
      glassEffectStyle?: string;
      colorScheme?: string;
      isInteractive?: boolean;
    }) => React.createElement(View, { ...props, testID: "mock-liquid-glass" }, children),
    isGlassEffectAPIAvailable: () => false,
    isLiquidGlassAvailable: () => false,
  };
});

jest.mock("expo-network", () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
    type: "WIFI",
  })),
  useNetworkState: jest.fn(() => ({
    isConnected: true,
    isInternetReachable: true,
    type: "WIFI",
  })),
}));

jest.mock("@react-native-async-storage/async-storage", () => (
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

jest.mock("expo-apple-authentication", () => {
  const React = require("react");
  const { Pressable } = require("react-native");
  return {
    AppleAuthenticationButton: ({ onPress, ...props }: { onPress: () => void }) => React.createElement(
      Pressable,
      { ...props, accessibilityRole: "button", onPress },
    ),
    AppleAuthenticationButtonStyle: { BLACK: 2, WHITE: 0, WHITE_OUTLINE: 1 },
    AppleAuthenticationButtonType: { CONTINUE: 1, SIGN_IN: 0, SIGN_UP: 2 },
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    formatFullName: jest.fn(() => "Test Student"),
    isAvailableAsync: jest.fn(async () => false),
    signInAsync: jest.fn(),
  };
});

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(async (length: number) => new Uint8Array(length).fill(7)),
}));

// react-freeze suspends with a never-resolving thenable, which the React test
// renderer retains across tab transitions until the Jest process exhausts memory.
// Native screen freezing remains enabled in production; tests still exercise the
// complete navigation state while rendering inactive screens normally.
jest.mock("react-freeze", () => {
  const React = require("react");
  return {
    Freeze: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});

jest.mock("@react-native-community/datetimepicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: ({ mode, onChange, value, ...props }: {
      mode: "date" | "time";
      onChange: (event: { type: "set" | "dismissed" }, value?: Date) => void;
      value: Date;
    }) => React.createElement(View, {
      ...props,
      accessibilityLabel: mode === "date" ? "Sistem tarih seçici" : "Sistem saat seçici",
      onChange,
      testID: `native-${mode}-picker`,
      value,
    }),
  };
});
