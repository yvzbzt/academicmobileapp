import type { AcademicEventCategory } from "./academic-event.types.js";

interface CategoryRule {
  category: AcademicEventCategory;
  patterns: readonly RegExp[];
  excludedPatterns?: readonly RegExp[];
}

const NON_EVENT_INFORMATION_PATTERNS = [
  /\b(?:sonuc|sonuclar|sonuclari|sonuclarin|sonuclarinin|not|notlar|notlari|notlarin|notlarinin|istatistik|istatistikleri)\b/u,
  /\b(?:duyuru|duyurusu|duyurular|duyurulari|kilavuz|kilavuzu|rehber|rehberi|degerlendirme|itiraz)\b/u,
] as const;

const EXAM_NON_EVENT_PATTERNS = [
  ...NON_EVENT_INFORMATION_PATTERNS,
  /\bsinav(?:i|lar|lari|larin|larinin)?\b.*\b(?:basvuru|basvurusu|basvurular|basvurulari|basvurularin|basvurularinin)\b/u,
] as const;

const categoryRules: CategoryRule[] = [
  {
    category: "course_add_drop",
    patterns: [/\bekle sil\b/u, /\bekle birak\b/u, /\bders ekleme\b/u],
  },
  {
    category: "course_schedule",
    patterns: [/\bders programi?\b/u, /\bhaftalik ders\b/u, /\bcourse schedule\b/u, /\bweekly schedule\b/u],
  },
  {
    category: "course_renewal",
    patterns: [/\bkayit yenileme\b/u, /\bkayitlarin yenilenmesi\b/u],
    excludedPatterns: NON_EVENT_INFORMATION_PATTERNS,
  },
  {
    category: "summer_school_registration",
    patterns: [/\byaz okulu\b.*\b(?:kayit|kayitlar|kayitlari|kayitlarin|kayitlarinin|basvuru|basvurular|basvurulari|basvurularin|basvurularinin|ders secimi|ders alma)\b/u],
    excludedPatterns: NON_EVENT_INFORMATION_PATTERNS,
  },
  {
    category: "horizontal_transfer",
    patterns: [/\byatay gecis\b/u],
    excludedPatterns: NON_EVENT_INFORMATION_PATTERNS,
  },
  {
    category: "graduation_application",
    patterns: [/\bmezuniyet\b.*\b(?:basvuru|basvurusu|basvurular|basvurulari|basvurularin|basvurularinin)\b/u],
    excludedPatterns: NON_EVENT_INFORMATION_PATTERNS,
  },
  {
    category: "midterm_exam",
    patterns: [
      /\bara sinav(?:i|lar|lari)?\b/u,
      /\bvize (?:sinavi|sinavlari|haftasi|takvimi|tarihleri|donemi)\b/u,
      /\bvizeler(?:i)?\b/u,
    ],
    excludedPatterns: EXAM_NON_EVENT_PATTERNS,
  },
  {
    category: "final_exam",
    patterns: [
      /\bfinal (?:sinavi|sinavlari|haftasi|takvimi|tarihleri|donemi)\b/u,
      /\bfinaller(?:i)?\b/u,
      /\byariyil sonu sinav(?:i|lar|lari)?\b/u,
    ],
    excludedPatterns: EXAM_NON_EVENT_PATTERNS,
  },
  {
    category: "makeup_exam",
    patterns: [/\bbutunleme (?:sinavi|sinavlari|haftasi|takvimi|tarihleri|donemi)\b/u, /\bbutunlemeler(?:i)?\b/u],
    excludedPatterns: EXAM_NON_EVENT_PATTERNS,
  },
  {
    category: "single_course_exam",
    patterns: [/\btek ders sinav(?:i|lar|lari)?\b/u],
    excludedPatterns: EXAM_NON_EVENT_PATTERNS,
  },
  {
    category: "department_exam_schedule",
    patterns: [/\bsinav programi?\b/u, /\bexam schedule\b/u, /\bexamination schedule\b/u],
    excludedPatterns: EXAM_NON_EVENT_PATTERNS,
  },
  {
    category: "department_exam_schedule",
    patterns: [/\bsinav(?:i|lar|lari|larinin)?\b/u],
    excludedPatterns: EXAM_NON_EVENT_PATTERNS,
  },
  {
    category: "course_registration",
    patterns: [/\bders kayit(?:i|lari)?\b/u, /\bkayitlanma\b/u, /\bkayit tarih(?:i|leri)?\b/u],
    excludedPatterns: NON_EVENT_INFORMATION_PATTERNS,
  },
  {
    category: "course_registration",
    patterns: [/\b(?:basvuru|basvurusu|basvurular|basvurulari|basvurularin|basvurularinin)\b/u],
    excludedPatterns: NON_EVENT_INFORMATION_PATTERNS,
  },
  {
    category: "course_registration",
    patterns: [/\b(?:kayit|kaydi|kayitlar|kayitlari|kayitlarin|kayitlarinin)\b/u],
    excludedPatterns: [
      ...NON_EVENT_INFORMATION_PATTERNS,
      /\bkayit (?:dondurma|silme|sildirme)\b/u,
    ],
  },
  { category: "tuition_payment", patterns: [/\bharc\b/u, /\bkatki payi\b/u, /\bodeme\b/u] },
  {
    category: "summer_school_start",
    patterns: [/\byaz okulu\b.*\b(?:baslangici|baslangic tarihi|baslamasi|baslar)\b/u],
  },
  {
    category: "summer_school_end",
    patterns: [/\byaz okulu\b.*\b(?:bitisi|bitis tarihi|sona ermesi|son gunu)\b/u],
  },
  {
    category: "fall_term_start",
    patterns: [/\bguz(?: donemi| yariyili)?\b.*\b(?:baslangici|baslamasi|baslar)\b/u],
  },
  {
    category: "fall_term_end",
    patterns: [/\bguz(?: donemi| yariyili)?\b.*\b(?:bitisi|sona ermesi|sonu)\b/u],
  },
  {
    category: "spring_term_start",
    patterns: [/\bbahar(?: donemi| yariyili)?\b.*\b(?:baslangici|baslamasi|baslar)\b/u],
  },
  {
    category: "spring_term_end",
    patterns: [/\bbahar(?: donemi| yariyili)?\b.*\b(?:bitisi|sona ermesi|sonu)\b/u],
  },
  {
    category: "academic_year_start",
    patterns: [/\bakademik yil\b.*\b(?:baslangici|baslamasi|baslar)\b/u],
  },
  {
    category: "academic_year_end",
    patterns: [/\bakademik yil\b.*\b(?:bitisi|sona ermesi|sonu)\b/u],
  },
  { category: "holiday", patterns: [/\bresmi tatil\b/u, /\bbayram\b/u, /\btatil\b/u] },
  { category: "orientation", patterns: [/\boryantasyon\b/u, /\buyum programi\b/u] },
];

export function mapAcademicEventCategory(titleOrText: string): AcademicEventCategory {
  const normalized = foldForMatch(titleOrText);
  const match = categoryRules.find((rule) => (
    rule.patterns.some((pattern) => pattern.test(normalized))
    && !rule.excludedPatterns?.some((pattern) => pattern.test(normalized))
  ));
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
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
