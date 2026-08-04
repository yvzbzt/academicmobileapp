import { StyleSheet, Text, View } from "react-native";
import { Banner, Button, PasswordField, useTheme } from "../design-system";
import type {
  DestructiveAccountAction,
  RecentAuthenticationMethod
} from "./recent-authentication";

export interface RecentAuthenticationPanelProps {
  action: DestructiveAccountAction;
  methods: readonly RecentAuthenticationMethod[];
  password: string;
  busy: boolean;
  error?: string;
  onPasswordChange: (password: string) => void;
  onSubmitPassword: () => void;
  onSubmitGoogle: () => void;
  onCancel: () => void;
}

export function RecentAuthenticationPanel(props: RecentAuthenticationPanelProps) {
  const theme = useTheme();
  const actionLabel = props.action === "account" ? "hesabını silmek" : "verilerini silmek";
  const passwordAvailable = props.methods.includes("password");
  const googleAvailable = props.methods.includes("google");

  return (
    <View
      accessibilityLabel="Kimliğini yeniden doğrula"
      style={[
        styles.panel,
        {
          backgroundColor: theme.colors.background.surfaceRaised,
          borderColor: theme.colors.border.default,
          borderRadius: theme.radii.card,
          gap: theme.spacing.sm,
          padding: theme.spacing.md
        }
      ]}
    >
      <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>Kimliğini yeniden doğrula</Text>
      <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
        {actionLabel.charAt(0).toLocaleUpperCase("tr-TR") + actionLabel.slice(1)} için kısa süreli bir güvenlik doğrulaması gerekiyor.
      </Text>

      {passwordAvailable && (
        <>
          <PasswordField
            label="Hesap şifresi"
            autoCapitalize="none"
            autoComplete="current-password"
            disabled={props.busy}
            onChangeText={props.onPasswordChange}
            onSubmitEditing={props.onSubmitPassword}
            placeholder="Hesap şifren"
            returnKeyType="done"
            value={props.password}
          />
          <Button
            disabled={props.busy || !props.password}
            fullWidth
            label="Şifre ile Doğrula"
            onPress={props.onSubmitPassword}
          />
        </>
      )}

      {googleAvailable && (
        <Button
          disabled={props.busy}
          fullWidth
          label="Google ile Doğrula"
          onPress={props.onSubmitGoogle}
          variant="secondary"
        />
      )}

      {!passwordAvailable && !googleAvailable && (
        <Banner
          title="Bu hesap için kullanılabilir doğrulama yöntemi bulunamadı."
          tone="error"
        />
      )}
      {props.error && (
        <Banner title={props.error} tone="error" />
      )}

      <Button
        disabled={props.busy}
        fullWidth
        label="Vazgeç"
        onPress={props.onCancel}
        variant="ghost"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    width: "100%"
  }
});
