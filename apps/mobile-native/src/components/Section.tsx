import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, useTheme } from "../design-system";

export interface SectionProps {
  title: string;
  children: ReactNode;
}

/**
 * Transitional semantic boundary for the Phase 1–3 screen content. Later
 * visual phases can replace its presentation without moving feature state
 * back into the route layer.
 */
export function Section({ title, children }: SectionProps) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.md }} variant="elevated">
      <View style={[styles.heading, { gap: theme.spacing.xs }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.accent,
            {
              backgroundColor: theme.colors.action.primary,
              borderRadius: theme.radii.pill,
            },
          ]}
        />
        <Text
          accessibilityRole="header"
          style={[theme.typography.sectionTitle, styles.title, { color: theme.colors.text.primary }]}
        >
          {title}
        </Text>
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  accent: {
    height: 24,
    width: 4,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
});
