import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Screen } from "./surfaces";
import { useTheme } from "./theme";
import {
  Banner,
  BottomSheet,
  Button,
  Card,
  Chip,
  ErrorState,
  ListItem,
  PasswordField,
  SearchField,
  SegmentedControl,
  SelectField,
  Skeleton,
  TextField,
  Toast,
} from "./primitives";

const previewUniversities = [
  { value: "ankara", label: "Ankara Üniversitesi", supportingText: "Seçili kurum" },
  { value: "ege", label: "Ege Üniversitesi" },
  { value: "disabled", label: "Örnek kullanılamayan kurum", disabled: true },
] as const;

export interface DesignSystemPreviewProps {
  initialSheetVisible?: boolean;
}

/**
 * Deterministic visual/interaction inventory for an explicit development-only
 * entry gate. It is exported, but deliberately never activated by production
 * application code.
 */
export function DesignSystemPreview({
  initialSheetVisible = false,
}: DesignSystemPreviewProps) {
  const theme = useTheme();
  const [email, setEmail] = useState("öğrenci@example.edu.tr");
  const [search, setSearch] = useState("sınav");
  const [segment, setSegment] = useState<"all" | "official">("all");
  const [university, setUniversity] = useState<"ankara" | "ege" | "disabled">(
    "ankara",
  );
  const [sheetVisible, setSheetVisible] = useState(initialSheetVisible);

  return (
    <Screen
      accessibilityLabel="Tasarım sistemi önizlemesi"
      contentStyle={{ gap: theme.spacing.xxl }}
      readableWidth="form"
      scroll
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text
          accessibilityRole="header"
          style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
        >
          Tasarım sistemi durum matrisi
        </Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          Bu yüzey yalnızca açık bir geliştirme giriş kapısından kullanılmalıdır.
        </Text>
      </View>

      <PreviewSection title="Eylemler">
        <Button label="Birincil eylem" />
        <Button label="İkincil eylem" variant="secondary" />
        <Button label="Tehlikeli eylem" variant="danger" />
        <Button disabled label="Devre dışı eylem" />
        <Button label="Yüklenen eylem" loading />
        <Button label="Kaydet" status="success" statusLabel="Kaydedildi" />
        <Button label="Gönder" status="error" statusLabel="Tekrar dene" />
      </PreviewSection>

      <PreviewSection title="Alanlar ve seçiciler">
        <TextField
          label="E-posta"
          onChangeText={setEmail}
          supportingText="Kalıcı etiket ve yardımcı metin"
          value={email}
        />
        <TextField error="Bu alan düzeltilmelidir." label="Hatalı alan" value="" />
        <TextField disabled label="Devre dışı alan" value="Değiştirilemez" />
        <PasswordField label="Şifre" value="gizli-parola" />
        <SearchField label="Duyurularda ara" onChangeText={setSearch} value={search} />
        <SelectField
          label="Üniversite"
          onValueChange={setUniversity}
          options={previewUniversities}
          supportingText="Alt sayfada tek bir kurum seçilir."
          value={university}
        />
        <SelectField
          disabled
          label="Devre dışı seçici"
          onValueChange={() => undefined}
          options={previewUniversities}
          value="ankara"
        />
        <SelectField
          label="Yüklenen seçici"
          loading
          onValueChange={() => undefined}
          options={[]}
          value={null}
        />
      </PreviewSection>

      <PreviewSection title="Seçim kontrolleri">
        <View style={[styles.wrap, { gap: theme.spacing.xs }]}>
          <Chip label="Varsayılan" />
          <Chip label="Seçili" selected />
          <Chip disabled label="Devre dışı" />
        </View>
        <SegmentedControl
          label="Duyuru türü"
          onValueChange={setSegment}
          options={[
            { value: "all", label: "Tümü" },
            { value: "official", label: "Resmî" },
          ]}
          value={segment}
        />
      </PreviewSection>

      <PreviewSection title="İçerik sınırları">
        <Card>
          <Text style={[theme.typography.body, { color: theme.colors.text.primary }]}>
            Çizgili, salt okunur kart
          </Text>
        </Card>
        <Card accessibilityLabel="Seçili yükseltilmiş kart" selected variant="elevated">
          <Text style={[theme.typography.body, { color: theme.colors.text.primary }]}>
            Seçili ve yükseltilmiş kart
          </Text>
        </Card>
        <ListItem
          supportingText="İkincil satır uzun metinde sarılır."
          title="Liste satırı"
        />
      </PreviewSection>

      <PreviewSection title="Geri bildirim">
        <Banner message="Bilgilendirici durum açıklaması." title="Bilgi" />
        <Banner message="İşlem başarıyla tamamlandı." title="Başarılı" tone="success" />
        <Banner message="Devam etmeden önce kontrol edin." title="Uyarı" tone="warning" />
        <Banner message="İşlem tamamlanamadı." title="Hata" tone="error" />
        <Toast message="Değişiklik kaydedildi." title="Tamamlandı" tone="success" />
        <Skeleton accessibilityLabel="Önizleme içeriği yükleniyor" height={56} />
        <ErrorState
          description="Son doğrulanmış içerik korunur."
          technicalDetails="Örnek hata ayrıntısı"
          title="Yükleme başarısız"
        />
      </PreviewSection>

      <PreviewSection title="Alt sayfa">
        <Button
          label="Alt sayfa önizlemesini aç"
          onPress={() => setSheetVisible(true)}
          variant="secondary"
        />
      </PreviewSection>

      <BottomSheet
        description="Modal semantik, güvenli alan ve kapatma davranışı örneği."
        onDismiss={() => setSheetVisible(false)}
        title="Alt sayfa örneği"
        visible={sheetVisible}
      >
        <ListItem title="Birinci alt sayfa satırı" />
        <ListItem title="İkinci alt sayfa satırı" />
      </BottomSheet>
    </Screen>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
