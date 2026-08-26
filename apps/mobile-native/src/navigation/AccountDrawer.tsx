import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Banner, Button, referencePalette, useTheme } from "../design-system";

export interface AccountDrawerProps {
  email: string;
  fullName: string;
  universityName?: string;
  visible: boolean;
  onClose: () => void;
  onLogout: () => void | Promise<void>;
  onOpenAccount: () => void;
}

export function AccountDrawer({
  email,
  fullName,
  universityName,
  visible,
  onClose,
  onLogout,
  onOpenAccount,
}: AccountDrawerProps) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | undefined>();
  const normalizedName = fullName.trim() || "Öğrenci hesabı";
  const normalizedEmail = email.trim() || "E-posta bilgisi yok";

  useEffect(() => {
    if (!visible) {
      setLogoutBusy(false);
      setLogoutError(undefined);
    }
  }, [visible]);

  const submitLogout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError(undefined);
    try {
      await onLogout();
    } catch {
      setLogoutBusy(false);
      setLogoutError("Oturum kapatılamadı. Bağlantını kontrol edip tekrar dene.");
    }
  };

  const openAccount = () => {
    onClose();
    onOpenAccount();
  };

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <SafeAreaView
          accessible={false}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.panel,
            {
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.subtle,
              width: Math.min(344, width * 0.88),
            },
          ]}
          testID="account-drawer"
        >
          <View style={styles.drawerHeader}>
            <Text accessibilityRole="header" style={[theme.typography.screenTitle, styles.drawerTitle, { color: theme.colors.text.primary }]}>Hesabım</Text>
            <Pressable
              accessibilityLabel="Hesap menüsünü kapat"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && { backgroundColor: theme.colors.action.ghostPressed },
              ]}
            >
              <Ionicons color={theme.colors.text.primary} name="close" size={24} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.drawerScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.drawerScroll}
            testID="account-drawer-scroll"
          >
            <View
              style={[
                styles.identity,
                fontScale >= 1.6 && styles.identityLargeText,
                { borderBottomColor: theme.colors.border.subtle },
              ]}
              testID="account-drawer-identity"
            >
              <View style={[styles.avatar, { backgroundColor: theme.colors.action.secondary }]}>
                <Text style={[theme.typography.sectionTitle, { color: theme.colors.text.link }]}>{initials(normalizedName)}</Text>
              </View>
              <View style={[styles.identityCopy, fontScale >= 1.6 && styles.identityCopyLargeText]}>
                <Text style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>{normalizedName}</Text>
                <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{normalizedEmail}</Text>
                {universityName ? (
                  <View style={[styles.universityTag, { backgroundColor: referencePalette.academicGreenSoft }]}>
                    <Ionicons color={referencePalette.academicGreen} name="school-outline" size={15} />
                    <Text style={[theme.typography.metaStrong, styles.universityName, { color: referencePalette.academicTealTitle }]}>{universityName}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {logoutError ? <Banner message={logoutError} title="Çıkış yapılamadı" tone="error" /> : null}

            <View style={styles.menuSection}>
              <Pressable
                accessibilityHint="Kişisel hesap ve veri seçeneklerini açar."
                accessibilityRole="button"
                onPress={openAccount}
                style={({ pressed }) => [
                  styles.menuRow,
                  { borderColor: theme.colors.border.subtle },
                  pressed && { backgroundColor: theme.colors.action.ghostPressed },
                ]}
              >
                <View style={[styles.menuIcon, { backgroundColor: theme.colors.action.secondary }]}>
                  <Ionicons color={theme.colors.action.primary} name="person-outline" size={22} />
                </View>
                <View style={styles.identityCopy}>
                  <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Kişisel profil ve hesap</Text>
                  <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Hesap bilgileri, gizlilik ve veri yönetimi</Text>
                </View>
                <Ionicons color={theme.colors.text.secondary} name="chevron-forward" size={20} />
              </Pressable>
            </View>

            <View style={styles.drawerFooter}>
              <Button
                disabled={logoutBusy}
                fullWidth
                label="Çıkış yap"
                leadingIcon={<Ionicons color={theme.colors.text.primary} name="log-out-outline" size={20} />}
                loading={logoutBusy}
                onPress={() => void submitLogout()}
                variant="secondary"
              />
            </View>
          </ScrollView>
        </SafeAreaView>

        <Pressable
          accessibilityLabel="Hesap menüsünü kapat"
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.scrim, { backgroundColor: theme.colors.state.scrim }]}
        />
      </View>
    </Modal>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  const selected = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return selected.map((part) => part?.[0] ?? "").join("").toLocaleUpperCase("tr-TR").slice(0, 2) || "Ö";
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: "row",
  },
  panel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  scrim: {
    flex: 1,
  },
  drawerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  drawerTitle: {
    flex: 1,
    minWidth: 0,
  },
  drawerScroll: {
    flex: 1,
  },
  drawerScrollContent: {
    flexGrow: 1,
    gap: 18,
    paddingBottom: 18,
    paddingTop: 18,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  identity: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    paddingBottom: 18,
  },
  identityLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  avatar: {
    alignItems: "center",
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityCopyLargeText: {
    flex: 0,
    width: "100%",
  },
  universityTag: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  menuSection: {
    flexGrow: 1,
  },
  menuRow: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 11,
    minHeight: 76,
    padding: 11,
  },
  menuIcon: {
    alignItems: "center",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  drawerFooter: {
    gap: 10,
  },
  universityName: {
    flex: 1,
    minWidth: 0,
  },
});
