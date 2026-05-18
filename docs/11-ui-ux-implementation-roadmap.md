# UI/UX Implementation Roadmap (Web + Mobile)

## 1. Yol Haritasi Ozeti

Toplam sure: 8 hafta

- Faz 0: Audit ve hedef netlestirme (Hafta 1)
- Faz 1: Design System Foundation (Hafta 2-3)
- Faz 2: Admin Web UX Upgrade (Hafta 4-5)
- Faz 3: Mobile Web UX Upgrade (Hafta 6-7)
- Faz 4: Performance, Accessibility, Release Gates (Hafta 8)

## 2. Faz Bazli Plan

## Faz 0 - Audit ve Hedef Netlestirme (Hafta 1)

Cikti:

- Ekran envanteri ve component envanteri
- UX risk haritasi
- KPI baseline olcumleri
- CTA audit raporu

Is paketleri:

- UX-000: Mevcut ekran envanteri cikarma
- UX-001: CTA hiyerarsi analizi
- UX-002: Renk kontrast ve erisilebilirlik taramasi
- UX-003: Frontend performans baseline olcumu

Onay kriteri:

- KPI baseline metrikleri dokumante edildi.
- Kritik UX sorunlari severity seviyesi ile etiketlendi.

## Faz 1 - Design System Foundation (Hafta 2-3)

Cikti:

- Token seti (renk, tipografi, spacing, elevation)
- CTA button ailesi
- Input, select, textarea, table, card, toast standardlari
- Ikon ve SVG standardi

Is paketleri:

- UX-100: Semantic token yapisinin olusturulmasi
- UX-101: Button sisteminin 4 seviye CTA modeline gore kurulmasi
- UX-102: Form componentlerinin durumlariyla birlikte standardize edilmesi
- UX-103: Durum komponentleri (loading/empty/error/success)
- UX-104: Ikon boyut, stroke ve kullanim standardi

Onay kriteri:

- Admin ve mobile uygulamalarinda en az %70 ortak token kullanimina gecildi.
- Butun butonlarda state seti tamamlandi (default/hover/focus/disabled/loading).

## Faz 2 - Admin Web UX Upgrade (Hafta 4-5)

Cikti:

- Operasyon panellerinde daha hizli gorev tamamlatan akislari
- Veri tablosu okunabilirlik ve hata toleransi iyilestirmeleri
- Kritik aksiyonlarda guardrail patternleri

Is paketleri:

- UX-200: Sol navigasyonun bilgi mimarisi ile sadelestirilmesi
- UX-201: Catalog/PDF/Review/Publish ekranlarinda CTA hiyerarsisinin uygulanmasi
- UX-202: Table satirlarinda hierarchy ve scanability artisi
- UX-203: Long running islemler icin progress and retry patterni
- UX-204: Audit export ve notification is akislari icin task feedback iyilestirmesi

Onay kriteri:

- Admin task completion oraninda en az +%15 artis.
- Kritik admin akislarda kullanici hata oraninda en az -%30 azalis.

## Faz 3 - Mobile Web UX Upgrade (Hafta 6-7)

Cikti:

- Mobil odakli okunabilirlik ve dokunma ergonomisi
- Auth, university selection ve preferences akislarinda friction azaltma
- Takvim ve upcoming ekranlarinda algilanan hiz artisi

Is paketleri:

- UX-300: Mobil tipografi ve spacing optimizasyonu
- UX-301: Auth form ve validation patternlerinin iyilestirilmesi
- UX-302: University secim ekraninda karar destekli kart tasarimi
- UX-303: Takvim ve upcoming kartlarinda bilgi hiyerarsisinin guclendirilmesi
- UX-304: Preferences ekraninda grouped toggle UX ve inline save feedback

Onay kriteri:

- Login + university selection completion >= %90
- Mobilde first meaningful state suresinde minimum %20 iyilesme

## Faz 4 - Performance, Accessibility, Release Gates (Hafta 8)

Cikti:

- Lighthouse CI ve accessibility gate
- Bundle ve runtime performans butcelerinin aktif takibi
- UI regression test seti

Is paketleri:

- UX-400: Lighthouse CI threshold tanimlari
- UX-401: Axe-based accessibility testleri
- UX-402: Playwright visual regression senaryolari
- UX-403: JS/CSS/SVG butce kontrolu
- UX-404: Reduced motion ve keyboard-only dogrulama

Onay kriteri:

- Performance >= 90, Accessibility >= 95
- Kritik ekranlarda WCAG 2.2 AA ihlali kalmadi
- Release pipeline UI gate'leri yesil

## 3. CTA, Renk ve Vektor Uygulama Takvimi

Hafta 2:

- CTA copy guide
- CTA color-state map

Hafta 3:

- Theme tokenlari
- Dark-mode hazirlik tokenlari (aktif etmeden)

Hafta 4:

- Admin panel CTA migration
- Tablo ve form state standardizasyonu

Hafta 6:

- Mobile CTA migration
- Touch target standardizasyonu

Hafta 8:

- SVG/Lottie budget enforcement
- Performance gate baglantisi

## 4. Roller ve Sorumluluk

- UI/UX Lead: strateji, token governance, usability test.
- Frontend Lead: component implementation, performans ve kod kalitesi.
- Product Owner: is degeri onceligi, KPI hedefleri.
- QA Lead: regression, accessibility ve cross-device test.

## 5. Riskler ve Onleyici Aksiyon

Risk 1: Tasarim sistemi disina cikan hizli hotfixler.

- Onlem: PR checklist + token linter + component library zorunlulugu.

Risk 2: Performans iyilestirmesi ile gorunurluk kalitesi catismasi.

- Onlem: her ekran icin quality/performance trade-off review.

Risk 3: Mobilde cihaz cesitliligi kaynakli UX tutarsizligi.

- Onlem: dusuk, orta, yuksek cihaz sinifi icin ayri test matrisi.

## 6. Definition of Done (UI/UX)

Bir ekran UI/UX acisindan tamamlandi sayilmasi icin:

- Design token kullaniyor.
- CTA hiyerarsisi dogru.
- Loading/empty/error/success durumlari var.
- WCAG 2.2 AA testleri gecti.
- Performance butcesi icinde.
- Usability testten gecme puani >= 80.

## 7. Beklenen Is Sonucu

Bu roadmap sonunda:

- Admin panel kritik operasyonlarda daha hizli, daha guvenli ve daha az hata ile kullanilir hale gelir.
- Mobile web uygulamasi onboarding ve gunluk takvim takibinde daha yuksek tamamlama oranina ulasir.
- UI/UX kalitesi olculebilir, tekrarlanabilir ve surdurulebilir bir standarda baglanir.
