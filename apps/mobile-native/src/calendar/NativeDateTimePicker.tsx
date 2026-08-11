import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Platform } from "react-native";

export interface NativeDateTimePickerProps {
  mode: "date" | "time";
  value: Date;
  onSelect: (value: Date) => void;
  onDismiss: () => void;
}

/**
 * The personal-exam form must not accept an unrestricted date/time string.
 * This wrapper keeps the feature component independent of picker-specific
 * event shapes while rendering the Android/iOS system picker.
 */
export function NativeDateTimePicker({
  mode,
  value,
  onSelect,
  onDismiss,
}: NativeDateTimePickerProps) {
  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === "dismissed" || !selected) {
      onDismiss();
      return;
    }
    onSelect(selected);
    if (Platform.OS === "android") onDismiss();
  };

  return (
    <DateTimePicker
      accessibilityLabel={mode === "date" ? "Sistem tarih seçici" : "Sistem saat seçici"}
      display={Platform.OS === "ios" ? (mode === "date" ? "inline" : "spinner") : "default"}
      is24Hour
      locale="tr-TR"
      mode={mode}
      onChange={handleChange}
      value={value}
    />
  );
}
