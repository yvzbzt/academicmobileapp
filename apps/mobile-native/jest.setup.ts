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
