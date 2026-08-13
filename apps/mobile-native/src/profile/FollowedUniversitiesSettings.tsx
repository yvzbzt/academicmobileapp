import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Banner, Button, useTheme } from "../design-system";

export interface FollowedUniversityRecord {
  id: string;
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  createdAt: string;
}

export interface FollowedUniversityOption {
  id: string;
  name: string;
  city?: string;
  type?: string;
}

export interface FollowedUniversitiesSettingsProps {
  universities: readonly FollowedUniversityOption[];
  followed: readonly FollowedUniversityRecord[];
  primaryUniversityId?: string;
  loading?: boolean;
  busyUniversityId?: string;
  error?: string;
  onRetry: () => void;
  onToggle: (universityId: string, followed: boolean) => void | Promise<void>;
}

export function FollowedUniversitiesSettingsScreen({
  universities,
  followed,
  primaryUniversityId,
  loading = false,
  busyUniversityId,
  error,
  onRetry,
  onToggle,
}: FollowedUniversitiesSettingsProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const followedByUniversityId = useMemo(
    () => new Map(followed.map((scope) => [scope.universityId, scope])),
    [followed],
  );
  const visibleUniversities = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("tr-TR");
    const sorted = [...universities]
      .filter((university) => university.id !== primaryUniversityId)
      .sort((left, right) => {
        const followedOrder = Number(followedByUniversityId.has(right.id))
          - Number(followedByUniversityId.has(left.id));
        return followedOrder || left.name.localeCompare(right.name, "tr-TR");
      });
    if (normalized) {
      return sorted.filter((university) =>
        `${university.name} ${university.city ?? ""}`
          .normalize("NFKC")
          .toLocaleLowerCase("tr-TR")
          .includes(normalized),
      ).slice(0, 60);
    }
    const followedRows = sorted.filter((university) => followedByUniversityId.has(university.id));
    const discoveryRows = sorted.filter((university) => !followedByUniversityId.has(university.id)).slice(0, 24);
    return [...followedRows, ...discoveryRows];
  }, [followedByUniversityId, primaryUniversityId, query, universities]);

  return (
    <View style={[styles.screen, { gap: theme.spacing.md }]}>
      <View style={{ gap: theme.spacing.xxs }}>
        <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Takip edilen üniversiteler</Text>
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{followed.length} ek üniversite</Text>
      </View>

      {error ? <Banner actionLabel="Tekrar dene" message={error} onAction={onRetry} title="Takipler yüklenemedi" tone="error" /> : null}

      <View style={[styles.search, { borderColor: theme.colors.border.default, borderRadius: theme.radii.control }]}>
        <Ionicons color={theme.colors.text.secondary} name="search-outline" size={20} />
        <TextInput
          accessibilityLabel="Üniversite ara"
          accessibilityRole="search"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Üniversite veya şehir ara"
          placeholderTextColor={theme.colors.text.disabled}
          returnKeyType="search"
          selectionColor={theme.colors.action.focus}
          style={[theme.typography.body, styles.searchInput, { color: theme.colors.text.primary }]}
          value={query}
        />
        {query ? (
          <Pressable accessibilityLabel="Aramayı temizle" accessibilityRole="button" hitSlop={8} onPress={() => setQuery("")}>
            <Ionicons color={theme.colors.text.secondary} name="close-circle" size={21} />
          </Pressable>
        ) : null}
      </View>

      {loading && followed.length === 0 ? (
        <View accessibilityLabel="Üniversite takipleri yükleniyor" accessibilityRole="progressbar" accessibilityState={{ busy: true }} style={styles.loading}>
          <ActivityIndicator color={theme.colors.action.primary} />
        </View>
      ) : visibleUniversities.length === 0 ? (
        <View style={[styles.empty, { gap: theme.spacing.sm }]}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Sonuç bulunamadı</Text>
          <Button compact label="Aramayı temizle" onPress={() => setQuery("")} variant="secondary" />
        </View>
      ) : (
        <View accessibilityLabel="Üniversite takip listesi" style={[styles.list, { borderColor: theme.colors.border.subtle, borderRadius: theme.radii.card }]}>
          {visibleUniversities.map((university) => {
            const selected = followedByUniversityId.has(university.id);
            const busy = busyUniversityId === university.id;
            return (
              <Pressable
                key={university.id}
                accessibilityLabel={`${university.name}. ${selected ? "Takip ediliyor" : "Takip edilmiyor"}`}
                accessibilityRole="switch"
                accessibilityState={{ busy, checked: selected, disabled: Boolean(busyUniversityId) }}
                disabled={Boolean(busyUniversityId)}
                onPress={() => void onToggle(university.id, !selected)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: theme.colors.border.subtle },
                  pressed && { backgroundColor: theme.colors.action.ghostPressed },
                ]}
              >
                <View style={[styles.universityIcon, { backgroundColor: selected ? theme.colors.action.secondary : theme.colors.background.subtle, borderRadius: theme.radii.control }]}>
                  <Ionicons color={selected ? theme.colors.action.primary : theme.colors.text.secondary} name="business-outline" size={20} />
                </View>
                <View style={styles.copy}>
                  <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{university.name}</Text>
                  {university.city ? <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{university.city}</Text> : null}
                </View>
                {busy ? <ActivityIndicator color={theme.colors.action.primary} /> : (
                  <View pointerEvents="none">
                    <Switch
                      ios_backgroundColor={theme.colors.action.disabled}
                      thumbColor={selected ? theme.colors.action.primary : theme.colors.text.disabled}
                      trackColor={{ false: theme.colors.action.disabled, true: theme.colors.state.selected }}
                      value={selected}
                    />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: "100%",
  },
  search: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    minWidth: 0,
    paddingVertical: 8,
  },
  loading: {
    alignItems: "center",
    minHeight: 96,
    justifyContent: "center",
  },
  empty: {
    alignItems: "flex-start",
    minHeight: 96,
    justifyContent: "center",
  },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  universityIcon: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
