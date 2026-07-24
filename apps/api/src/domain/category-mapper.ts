import type { AcademicEventCategory } from "./academic-event.types.js";

const categoryRules: Array<{ category: AcademicEventCategory; patterns: RegExp[] }> = [
  { category: "course_add_drop", patterns: [/ekle\s*[-/]?\s*sil/u, /ders ekleme/u] },
  { category: "course_schedule", patterns: [/ders program/u, /haftalik ders/u, /course schedule/u, /weekly schedule/u] },
  { category: "course_registration", patterns: [/ders kayit/u, /kayitlanma/u, /kayit tarih/u] },
  { category: "course_renewal", patterns: [/kayit yenile/u] },
  { category: "department_exam_schedule", patterns: [/sinav program/u, /exam schedule/u, /examination schedule/u] },
  { category: "midterm_exam", patterns: [/vize/u, /ara sinav/u] },
  { category: "final_exam", patterns: [/final/u, /yariyil sonu/u] },
  { category: "makeup_exam", patterns: [/butunleme/u] },
  { category: "single_course_exam", patterns: [/tek ders/u] },
  { category: "horizontal_transfer", patterns: [/yatay gecis/u] },
  { category: "graduation_application", patterns: [/mezuniyet basvuru/u, /basvuru tarih/u] },
  { category: "tuition_payment", patterns: [/harc/u, /katki payi/u, /odeme/u] },
  { category: "summer_school_registration", patterns: [/yaz okulu.*(kayit|basvuru|ders sec|ders alma)/u] },
  { category: "summer_school_start", patterns: [/yaz okulu.*(bas|baslangic)/u] },
  { category: "summer_school_end", patterns: [/yaz okulu.*(bit|son)/u] },
  { category: "fall_term_start", patterns: [/guz.*bas/u] },
  { category: "fall_term_end", patterns: [/guz.*bit/u, /guz.*son/u] },
  { category: "spring_term_start", patterns: [/bahar.*bas/u] },
  { category: "spring_term_end", patterns: [/bahar.*bit/u, /bahar.*son/u] },
  { category: "academic_year_start", patterns: [/akademik yil.*bas/u] },
  { category: "academic_year_end", patterns: [/akademik yil.*bit/u, /akademik yil.*son/u] },
  { category: "holiday", patterns: [/resmi tatil/u, /bayram/u, /tatil/u] },
  { category: "orientation", patterns: [/oryantasyon/u, /uyum programi/u] }
];

export function mapAcademicEventCategory(titleOrText: string): AcademicEventCategory {
  const normalized = foldForMatch(titleOrText);
  const match = categoryRules.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)));
  return match?.category ?? "custom_event";
}

function foldForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
