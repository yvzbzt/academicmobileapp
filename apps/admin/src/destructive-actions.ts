export const adminDestructiveActionPrompts = {
  archiveUniversity: "Bu üniversiteyi arşivlemek istiyor musunuz? Üniversite aktif listelerden kaldırılacaktır.",
  deactivateAnnouncementSource: "Bu duyuru kaynağını pasife almak istiyor musunuz? Otomatik veri alımı duracaktır.",
  removeCourseScheduleSeries: "Bu ders programı serisini kaldırmak istiyor musunuz? Serideki tüm ders oturumları arşivlenecektir.",
  rejectAcademicUnitSuggestion: "Bu akademik birim önerisini reddetmek istiyor musunuz?",
  rejectExtractedEvent: "Bu çıkarılmış etkinliği reddetmek istiyor musunuz?",
  rollbackPublishedCalendar: "Bu yayınlanmış takvimi geri almak istiyor musunuz? Öğrencilerin takvim görünümü etkilenebilir.",
  deleteUser: "Bu kullanıcıyı yönetimden silmek istiyor musunuz?"
} as const;

export type AdminDestructiveAction = keyof typeof adminDestructiveActionPrompts;

export function confirmAdminDestructiveAction(
  action: AdminDestructiveAction,
  confirmAction: (message: string) => boolean = (message) => window.confirm(message)
): boolean {
  return confirmAction(adminDestructiveActionPrompts[action]);
}
