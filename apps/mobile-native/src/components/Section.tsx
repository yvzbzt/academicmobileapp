import type { ReactNode } from "react";
import { Text } from "react-native";
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
    <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.md }}>
      <Text
        accessibilityRole="header"
        style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
      >
        {title}
      </Text>
      {children}
    </Card>
  );
}
