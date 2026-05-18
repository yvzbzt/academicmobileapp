# UI/UX Product Readiness Report (Web + Mobile)

## 1. Hedef

Bu raporun amaci, mevcut admin web ve student mobile web arayuzlerini MVP seviyesinden production seviyesine tasimak icin net tasarim ilkeleri, tasarim sistemi standartlari ve uygulanabilir UX kararlarini tanimlamaktir.

Kapsam:

- Admin web operasyon deneyimi
- Student mobile web deneyimi
- CTA stratejisi
- Renk sistemi
- Vektor ve ikon standardi
- Erisilebilirlik
- Performans ve algilanan hiz iyilestirmeleri

## 2. Mevcut Durum Ozeti

Gozlenen guclu yonler:

- Is akislari calisiyor: katalog, PDF, review, publish, notification, audit.
- Mobil tarafta temel onboarding ve takvim akislarinin tamamlanmis olmasi.
- Tutarli temel CSS ve responsive kirilimlarin varligi.

Gozlenen kritik bosluklar:

- Tasarim token mimarisi resmi olarak tanimli degil (renk, spacing, radius, state).
- CTA hiyerarsisi tek tip buton gorunumu ile sinirli.
- Tipografi karakteri ve marka kimligi yeterince ayrismiyor.
- Durum ekranlari (empty/error/loading/success) standardize degil.
- Gorsel varlik (SVG, ilustrasyon, animasyon) pipeline standartlari yok.
- Performans butceleri ve UI kalite gate metrikleri resmi degil.

## 3. Hedeflenen UX Sonucu

Urun deneyimi asagidaki 4 ilke etrafinda standardize edilir:

1. Clarity: Her ekranda birincil gorev tek bakista anlasilir.
2. Confidence: Kritik aksiyonlarda hataya dayanikli ve geri alinabilir akislar sunulur.
3. Speed: Ozellikle mobilde dusuk cihazlarda da akici etkileisim saglanir.
4. Trust: Renk, metin, geri bildirim ve erisilebilirlik tutarlidir.

## 4. Design System V1.0 Kararlari

### 4.1 Token Katmanlari

- Primitive tokens: ham renk, spacing, radius, shadow, type degerleri.
- Semantic tokens: `surface.default`, `text.primary`, `cta.primary.bg` gibi anlamli isimler.
- Component tokens: `button.primary.bg`, `input.error.border`, `badge.warning.bg`.

### 4.2 Tipografi

Onerilen font stratejisi:

- Admin web: "Manrope Variable" + fallback "Noto Sans".
- Mobile web: "Plus Jakarta Sans Variable" + fallback "Noto Sans".

Tipografi olcegi:

- Display: 40/48
- H1: 32/40
- H2: 24/32
- H3: 20/28
- Body L: 18/28
- Body M: 16/24
- Body S: 14/20
- Caption: 12/16

### 4.3 Spacing ve Grid

- 8pt spacing sistemi (4, 8, 12, 16, 24, 32, 40, 48, 64).
- Admin web: 12 kolon desktop grid + 24px gutter.
- Mobile web: 4 kolon fluid grid + 16px yatay padding.

### 4.4 Radius, Border, Shadow

- Radius: 6, 10, 14, 20.
- Border: 1px neutral-300 default, 2px focus state.
- Shadow katmanlari: elevation-1, elevation-2, elevation-3.

## 5. CTA Stratejisi

### 5.1 CTA Seviyeleri

1. Primary CTA: Tek bir ekranin ana hedefi.
2. Secondary CTA: Ana hedefi destekleyen islemler.
3. Tertiary CTA: Dusuk oncelikli, metin agirlikli islemler.
4. Destructive CTA: Silme, arsivleme, geri alinmasi zor islemler.

### 5.2 CTA Renk ve Durum Kurali

- Primary: brand-600 arkaplan + beyaz metin.
- Secondary: beyaz arkaplan + brand-700 border/metin.
- Tertiary: text-link stili.
- Destructive: danger-600 arkaplan + beyaz metin.

Her CTA icin zorunlu state seti:

- default
- hover (web)
- pressed
- focus-visible
- disabled
- loading

### 5.3 Ekran Bazli CTA Haritasi

Admin web kritik CTA:

- Publish Calendar: Primary
- Approve Extracted Event: Primary
- Process Due Notifications: Primary
- Retry Failed Job: Secondary
- Archive University: Destructive
- Export Audit: Secondary

Mobile web kritik CTA:

- Continue Login/Register: Primary
- Select University: Primary
- Save Preferences: Primary
- Register Device: Secondary
- Refresh Upcoming: Tertiary

### 5.4 CTA Metin Kurali

- Fiil + nesne formati kullan: "Takvimi Yayinla", "Etkinligi Onayla".
- 2-4 kelime ideal uzunluk.
- Teknik jargon yerine sonuc odakli ifade kullan.

## 6. Renk Sistemi (AA Uyumlu)

### 6.1 Onerilen Temel Palet

Brand:

- brand-900: #062F42
- brand-700: #0B4F6C
- brand-600: #146C94
- brand-500: #1C87B8
- brand-100: #D9EEF8

Neutral:

- neutral-950: #0E141B
- neutral-800: #1E2A36
- neutral-700: #334155
- neutral-500: #64748B
- neutral-300: #CBD5E1
- neutral-200: #E2E8F0
- neutral-100: #F1F5F9
- neutral-50: #F8FAFC

State:

- success-600: #127A4E
- warning-600: #A15C00
- danger-600: #B42318
- info-600: #0C5DD6

### 6.2 Semantic Esleme

- canvas.bg -> neutral-50
- surface.bg -> #FFFFFF
- text.primary -> neutral-800
- text.secondary -> neutral-500
- border.default -> neutral-300
- cta.primary.bg -> brand-600
- cta.primary.text -> #FFFFFF
- cta.destructive.bg -> danger-600
- focus.ring -> info-600

### 6.3 Kontrast Kurallari

- Normal metin kontrasti en az 4.5:1
- Buyuk metin kontrasti en az 3:1
- Kritik metin ve veri tablolarinda hedef 7:1
- Salt renge bagli durum anlatimi yasak (ikon/metin destekli)

## 7. Vektor, Ikon ve Ilustrasyon Standarti

### 7.1 Ikon Sistemi

- Ana ikon kutuphanesi: Lucide.
- Stroke width: 1.75 standardize.
- Boyutlar: 16, 20, 24.
- Ikon + metin arasi min 8px bosluk.

### 7.2 SVG Uretim Kurali

- Tum custom ikonlar SVG olarak saklanir.
- SVGO ile otomatik optimize edilir.
- Fill yerine stroke tabanli, sade geometri tercih edilir.
- Inline SVG veya sprite kullanilir; base64 icon embed edilmez.

### 7.3 Ilustrasyon ve Mikro Animasyon

- Empty state ve onboarding icin hafif vektor ilustrasyonlar.
- Lottie sadece yuksek degerli noktalarda (or. onboarding success).
- Tek animasyon dosyasi ust sinir: 80KB gzip.
- `prefers-reduced-motion` ile animasyon azaltma zorunlu.

## 8. UX Akis ve Etkilesim Standartlari

### 8.1 Form UX

- Inline validasyon + alan bazli hata metni.
- Submit oncesi zorunlu alan ozeti.
- Submit sonrasi optimistic feedback + geri alma imkani (uygunsa).

### 8.2 Durum Ekranlari

Her kritik bolumde su 4 durum icin reusable desen olusturulur:

- Loading: skeleton + context label
- Empty: acik yonlendirme metni + CTA
- Error: neden + cozum adimi + retry CTA
- Success: sonuc metni + sonraki adim CTA

### 8.3 Bilgi Mimarisi

Admin bilgi mimarisi:

- Catalog
- PDF Operations
- Review Queue
- Calendar Publish
- Notifications
- Audit

Mobile bilgi mimarisi:

- Auth
- University Selection
- Calendar
- Upcoming
- Preferences

## 9. Erisilebilirlik Standardi

Hedef standart: WCAG 2.2 AA.

Zorunlu maddeler:

- Klavye ile tam gezinme
- Gorunur focus ring
- Min dokunma alani 44x44
- Landmark ve dogru heading hiyerarsisi
- Formlarda `label` ve `aria-describedby` baglantilari
- Error mesajlarinda ekran okuyucu dostu duyurular

## 10. Basari Metrikleri (UX KPI)

Admin KPI:

- Calendar publish task completion >= %95
- Publish islemi ortalama sure <= 3 dakika
- Kritik form hata orani <= %2

Mobile KPI:

- Login + university selection completion >= %90
- Upcoming events first paint <= 2.5 sn (4G)
- Preferences save success >= %98

Genel kalite KPI:

- Lighthouse Performance >= 90
- Lighthouse Accessibility >= 95
- INP < 200ms
- CLS < 0.1

## 11. Cikis Artefaktlari

Bu rapora bagli uretilmesi gereken artefaktlar:

- Design token JSON/CSS degisken seti
- UI component spec dosyalari (button, input, table, card, toast, modal)
- CTA copy guideline
- Icon ve SVG governance dokumani
- UX acceptance checklist

## 12. Onay Kriteri

Bu plan asagidaki durumlarda "production-ready UI/UX baseline" kabul edilir:

- Tum kritik ekranlar design system tokenlari ile refactor edilir.
- CTA hiyerarsisi tum ekranlarda tek standarda gecer.
- Erisilebilirlik checklisti ve performans butceleri CI gate haline gelir.
- Admin ve mobile task-based usability testlerinde hedef KPI'lar yakalanir.
