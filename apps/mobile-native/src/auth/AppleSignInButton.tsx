import * as AppleAuthentication from "expo-apple-authentication";
import { StyleSheet, View } from "react-native";

export interface AppleSignInButtonProps {
  busy: boolean;
  onPress: () => void;
  testID?: string;
  type?: "continue" | "sign-in";
}

export function AppleSignInButton({ busy, onPress, testID, type = "continue" }: AppleSignInButtonProps) {
  return (
    <View
      accessibilityState={{ disabled: busy, busy }}
      pointerEvents={busy ? "none" : "auto"}
      style={[styles.frame, busy && styles.busy]}
    >
      <AppleAuthentication.AppleAuthenticationButton
        accessibilityLabel={type === "continue" ? "Apple ile devam et" : "Apple ile doğrula"}
        accessibilityState={{ disabled: busy, busy }}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        buttonType={type === "continue"
          ? AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        cornerRadius={28}
        onPress={() => {
          if (!busy) onPress();
        }}
        style={styles.button}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    width: "100%",
  },
  busy: {
    opacity: 0.55,
  },
  frame: {
    height: 56,
    width: "100%",
  },
});
