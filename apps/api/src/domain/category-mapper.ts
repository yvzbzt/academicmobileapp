import type { AcademicEventCategory } from "./academic-event.types.js";

const categoryRules: Array<{ category: AcademicEventCategory; patterns: RegExp[] }> = [
  { category: "course_add_drop", patterns: [/ekle\s*[-/]?\s*sil/u, /ders ekleme/u] },
  { category: "course_registration", patterns: [/ders kay[ıi]t/u, /kay[ıi]tlanma/u] },
  { category: "course_renewal", patterns: [/kay[ıi]t yenile/u] },
  { category: "midterm_exam", patterns: [/vize/u, /ara s[ıi]nav/u] },
  { category: "final_exam", patterns: [/final/u, /yar[ıi]y[ıi]l sonu/u] },
  { category: "makeup_exam", patterns: [/bütünleme/u, /butunleme/u] },
  { category: "single_course_exam", patterns: [/tek ders/u] },
  { category: "graduation_application", patterns: [/mezuniyet başvuru/u, /mezuniyet basvuru/u] },
  { category: "tuition_payment", patterns: [/harç/u, /harc/u, /katk[ıi] pay[ıi]/u] },
  { category: "horizontal_transfer", patterns: [/yatay geçiş/u, /yatay gecis/u] },
  { category: "summer_school_registration", patterns: [/yaz okulu kay[ıi]t/u] },
  { category: "summer_school_start", patterns: [/yaz okulu baş/u, /yaz okulu bas/u] },
  { category: "summer_school_end", patterns: [/yaz okulu bit/u, /yaz okulu son/u] },
  { category: "fall_term_start", patterns: [/güz.*baş/u, /guz.*bas/u] },
  { category: "fall_term_end", patterns: [/güz.*bit/u, /guz.*son/u] },
  { category: "spring_term_start", patterns: [/bahar.*baş/u, /bahar.*bas/u] },
  { category: "spring_term_end", patterns: [/bahar.*bit/u, /bahar.*son/u] },
  { category: "academic_year_start", patterns: [/akademik y[ıi]l.*baş/u, /akademik yil.*bas/u] },
  { category: "academic_year_end", patterns: [/akademik y[ıi]l.*bit/u, /akademik yil.*son/u] },
  { category: "holiday", patterns: [/resmi tatil/u, /bayram/u, /tatil/u] },
  { category: "orientation", patterns: [/oryantasyon/u, /uyum program[ıi]/u] }
];

export function mapAcademicEventCategory(titleOrText: string): AcademicEventCategory {
  const normalized = titleOrText.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
  const match = categoryRules.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)));
  return match?.category ?? "custom_event";
}
