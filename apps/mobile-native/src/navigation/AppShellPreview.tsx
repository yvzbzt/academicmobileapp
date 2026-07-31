import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card, ListItem, useTheme } from "../design-system";
import {
  AppNavigator,
  type AppNavigationRequest,
  type AppScreenSlots,
  type AppVisibleRoute,
} from "./AppNavigator";

const EVIDENCE_ROW_COUNT = 10;

interface EvidenceRootProps {
  routeLabel: string;
  actions?: ReactNode;
}

function EvidenceRoot({ routeLabel, actions }: EvidenceRootProps) {
  const theme = useTheme();

  return (
    <View style={[styles.stack, { gap: theme.spacing.sm }]}>
      <Card variant="tonal">
        <Text
          accessibilityLabel={`${routeLabel} deterministik kabuk kanıtı başlangıcı`}
          accessibilityRole="header"
          style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
        >
          {routeLabel} deterministik kabuk kanıtı
        </Text>
        <Text
          style={[theme.typography.body, { color: theme.colors.text.secondary }]}
        >
          Bu geliştirme yüzeyi yalnızca Phase 5 uygulama kabuğunu doğrular;
          üretim içeriği veya hesap verisi değildir.
        </Text>
      </Card>

      {actions ? (
        <View
          accessibilityLabel={`${routeLabel} deterministik rota eylemleri`}
          style={[styles.stack, { gap: theme.spacing.xs }]}
        >
          {actions}
        </View>
      ) : null}

      {Array.from({ length: EVIDENCE_ROW_COUNT }, (_, index) => (
        <ListItem
          key={`${routeLabel}-evidence-row-${index + 1}`}
          accessibilityLabel={`${routeLabel} deterministik kaydırma satırı ${index + 1}`}
          supportingText="Kaydırma ve sekme yeniden seçim kanıtı için sentetik satır."
          title={`Deterministik kanıt satırı ${index + 1}`}
        />
      ))}

      <Text
        accessibilityLabel={`${routeLabel} deterministik kabuk kanıtı sonu`}
        style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}
      >
        {routeLabel} kaydırma kanıtı sonu
      </Text>
    </View>
  );
}

function EvidenceDetail({ routeLabel }: { routeLabel: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.stack, { gap: theme.spacing.sm }]}>
      <Card variant="tonal">
        <Text
          accessibilityLabel={`${routeLabel} deterministik iç rota kanıtı`}
          accessibilityRole="header"
          style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
        >
          {routeLabel}
        </Text>
        <Text
          style={[theme.typography.body, { color: theme.colors.text.secondary }]}
        >
          Bu ekran Android Geri ve sekme yeniden seçim davranışı için sentetik,
          üretim dışı bir Phase 5 rota kanıtıdır.
        </Text>
      </Card>
    </View>
  );
}

function InactiveEvidenceSlot({ routeLabel }: { routeLabel: string }) {
  return <EvidenceDetail routeLabel={`${routeLabel} kullanılmayan önizleme yuvası`} />;
}

/**
 * Deterministic native shell evidence. Mount only behind the application-level
 * `__DEV__` plus explicit Phase 5 preview environment gate.
 */
export function AppShellPreview() {
  const [activeRoute, setActiveRoute] = useState<AppVisibleRoute>("Home");
  const [request, setRequest] = useState<AppNavigationRequest | null>(null);
  const requestSequenceRef = useRef(0);

  const requestRoute = useCallback(
    (
      route: AppVisibleRoute,
      params?: Readonly<Record<string, string>>,
    ) => {
      requestSequenceRef.current += 1;
      setRequest({
        key: `phase5-shell-preview-${requestSequenceRef.current}`,
        route,
        ...(params ? { params } : {}),
      });
    },
    [],
  );

  const screens = useMemo<AppScreenSlots>(() => ({
    BootstrapLoading: <InactiveEvidenceSlot routeLabel="Yükleme" />,
    BootstrapError: <InactiveEvidenceSlot routeLabel="Yükleme hatası" />,
    Login: <InactiveEvidenceSlot routeLabel="Giriş" />,
    Register: <InactiveEvidenceSlot routeLabel="Kayıt" />,
    Verification: <InactiveEvidenceSlot routeLabel="Doğrulama" />,
    PasswordRecoveryRequest: <InactiveEvidenceSlot routeLabel="Şifre kurtarma isteği" />,
    PasswordRecoveryCode: <InactiveEvidenceSlot routeLabel="Şifre kurtarma kodu" />,
    PasswordRecoveryConfirm: <InactiveEvidenceSlot routeLabel="Şifre kurtarma onayı" />,
    AcademicOnboarding: <InactiveEvidenceSlot routeLabel="Akademik profil kurulumu" />,
    Home: <EvidenceRoot routeLabel="Ana Sayfa" />,
    Announcements: (
      <EvidenceRoot
        routeLabel="Duyurular"
        actions={(
          <>
            <Button
              accessibilityLabel="Yaz Okulu iç rotasını aç"
              fullWidth
              label="Yaz Okulu iç rotasını aç"
              onPress={() => requestRoute("SummerSchool")}
              variant="secondary"
            />
            <Button
              accessibilityLabel="YÖK duyuruları iç rotasını aç"
              fullWidth
              label="YÖK duyuruları iç rotasını aç"
              onPress={() => requestRoute("YokAnnouncements")}
              variant="secondary"
            />
          </>
        )}
      />
    ),
    SummerSchool: <EvidenceDetail routeLabel="Yaz Okulu iç rota kanıtı" />,
    YokAnnouncements: <EvidenceDetail routeLabel="YÖK duyuruları iç rota kanıtı" />,
    AnnouncementDetail: <EvidenceDetail routeLabel="Duyuru ayrıntısı iç rota kanıtı" />,
    Calendar: (
      <EvidenceRoot
        routeLabel="Takvim"
        actions={(
          <Button
            accessibilityLabel="Takvim ayrıntısı iç rotasını aç"
            fullWidth
            label="Takvim ayrıntısı iç rotasını aç"
            onPress={() => requestRoute("CalendarEventDetail", { eventId: "phase5-preview-event" })}
            variant="secondary"
          />
        )}
      />
    ),
    CalendarEventDetail: (
      <EvidenceDetail routeLabel="Takvim ayrıntısı iç rota kanıtı" />
    ),
    Profile: (
      <EvidenceRoot
        routeLabel="Profil"
        actions={(
          <Button
            accessibilityLabel="Bildirim ayarları iç rotasını aç"
            fullWidth
            label="Bildirim ayarları iç rotasını aç"
            onPress={() => requestRoute("NotificationSettings")}
            variant="secondary"
          />
        )}
      />
    ),
    AcademicProfileSettings: (
      <EvidenceDetail routeLabel="Akademik profil ayarları iç rota kanıtı" />
    ),
    NotificationSettings: <EvidenceDetail routeLabel="Bildirim ayarları iç rota kanıtı" />,
    GoogleCalendarSettings: (
      <EvidenceDetail routeLabel="Google Takvim ayarları iç rota kanıtı" />
    ),
    AccountDataSettings: <EvidenceDetail routeLabel="Hesap ve veri ayarları iç rota kanıtı" />,
    UnknownRoute: <EvidenceDetail routeLabel="Bilinmeyen rota güvenli geri dönüş kanıtı" />,
  }), [requestRoute]);

  const handleRequestHandled = useCallback((handledKey: string) => {
    setRequest((currentRequest) => (
      currentRequest?.key === handledKey ? null : currentRequest
    ));
  }, []);

  return (
    <AppNavigator
      activeRoute={activeRoute}
      onRequestHandled={handleRequestHandled}
      onVisibleRouteChange={setActiveRoute}
      request={request}
      rootSurface="authenticated"
      screens={screens}
    />
  );
}

const styles = StyleSheet.create({
  stack: {
    alignSelf: "stretch",
  },
});
