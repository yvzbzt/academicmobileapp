# UI/UX Optimization Scenarios (Web + Mobile)

## 1. Amac

Bu dokuman, production seviyesinde UI/UX kalitesini korumak icin performans, algilanan hiz, erisilebilirlik ve gorev tamamlama basarisi uzerinden senaryo bazli optimizasyon planini tanimlar.

## 2. Performance Budgets

Admin web butceleri:

- Initial JS (gzip): <= 220KB
- Initial CSS (gzip): <= 70KB
- SVG toplam (kritik path): <= 50KB
- LCP: <= 2.5s (desktop), <= 3.0s (4G)
- INP: < 200ms
- CLS: < 0.1

Mobile web butceleri:

- Initial JS (gzip): <= 180KB
- Initial CSS (gzip): <= 55KB
- Font toplam (woff2): <= 120KB
- LCP: <= 2.8s (4G), <= 4.0s (slow 4G)
- INP: < 180ms
- CLS: < 0.08

## 3. Senaryo Seti

## Senaryo A - Dusuk Donanimli Android + Zayif Ag

Risk:

- Auth ve university secim ekranlarinda gec algilanan tepki.

Aksiyon:

- Route-level code splitting.
- Skeleton-first render.
- Non-critical icon setini lazy load.
- Input validasyonunu debounce ile calistir.

Beklenen kazanc:

- First interactive state suresinde >= %25 iyilesme.

## Senaryo B - Yavas API Donusleri (700ms+)

Risk:

- Kullanici eylemden sonra sistemin kilitlendigini dusunuyor.

Aksiyon:

- Optimistic UI pattern (uygun endpointlerde).
- Request state machine (idle/loading/success/error/retrying).
- Retry CTA ve timeout fallback mesaji.

Beklenen kazanc:

- Islem yarim birakma oraninda >= %20 azalis.

## Senaryo C - Buyuk Veri Tablosu (Admin)

Risk:

- Table render ve scroll performansi dusuyor.

Aksiyon:

- Row virtualization.
- Sticky column ve sade satir layout.
- Server-side pagination + filtre debounce.

Beklenen kazanc:

- 5000+ satirli datasetlerde scroll jank'in kritik seviyeden cikmasi.

## Senaryo D - Bildirim Islem Zirvesi

Risk:

- Notification paneli stale gorunuyor, operatorde guven kaybi oluyor.

Aksiyon:

- Polling interval strategy (focus tab aktifken hizli, arka planda yavas).
- Incremental list update.
- Islem sonucu icin deterministic status labels.

Beklenen kazanc:

- Islem sonucu gorunurlugunde gecikmenin azalmasi ve operator guveninin artmasi.

## Senaryo E - Erisilebilirlik Kritik Aksiyonlar

Risk:

- Klavye veya ekran okuyucu kullanicisi kritik gorevi tamamlayamiyor.

Aksiyon:

- Focus order map.
- Live region ile hata/basari duyurusu.
- Color-only signal yerine icon + text.

Beklenen kazanc:

- WCAG 2.2 AA uyumunda kritik ihlallerin sifirlanmasi.

## 4. Vektor ve Gorsel Optimizasyon Kurallari

- Tum SVG varliklari SVGO pipeline'dan gecmeli.
- Repeated iconlar icin sprite veya komponent tabanli tekrar kullanim.
- Bitmap kullanimi gerekiyorsa AVIF -> WebP fallback strtejisi.
- Ilustrasyon dosya boyutu hedefi: <= 120KB.
- Lottie dosya boyutu hedefi: <= 80KB gzip.
- Tek sayfada ayni anda max 1 mikro animasyon oynatimi (CPU sagligi icin).

## 5. CTA ve Renk Optimizasyon Senaryolari

## Senaryo F - CTA Karar Yorgunlugu

Aksiyon:

- Her panelde tek primary CTA zorunlulugu.
- Secondary ve destructive butonlarin gorsel agirligini dusurme.

Metrik:

- Mis-click orani <= %3.

## Senaryo G - Kontrast ve Gece Kullanim

Aksiyon:

- Text/background kontrast taramasi otomasyonu.
- Theme tokenlari ile gelecekte dark mode acilimina hazir semantic katman.

Metrik:

- Tum ana metinlerde en az 4.5:1.

## 6. Tooling ve Otomasyon

- Lighthouse CI: performans butce gate.
- Axe-core: erisilebilirlik ihlal kontrolu.
- Playwright: kritik akislarda gorsel regression.
- Bundle analyzer: route bazli agirlik takibi.
- RUM telemetry: LCP, INP, CLS canli takibi.

## 7. Test Matrisi

Cihaz segmentleri:

- Low: 2 GB RAM Android
- Mid: 4 GB RAM Android / iOS
- High: modern desktop

Tarayici kapsami:

- Chrome, Edge, Safari, Firefox (son 2 major)

Ag profilleri:

- Wi-Fi
- 4G
- Slow 4G

## 8. Release Gate Kriterleri

Bir release adayinin UI/UX gate'i gecmesi icin:

- Performance budget ihlali yok.
- Accessibility kritik ihlali yok.
- Critical flow E2E testleri yesil.
- Visual regression farklari onayli.
- CTA hierarchy checklist gecti.

## 9. 30-60-90 Gunluk Optimizasyon Plani

Ilk 30 gun:

- Token migration ve CTA standardizasyonu.
- Kritik ekranlarda loading/empty/error/success patternleri.

60 gun:

- Table virtualization ve mobile flow friction azaltimi.
- SVG/Lottie budget enforcement.

90 gun:

- RUM bazli ince ayar.
- UX KPI trendlerine gore ikinci tur iyilestirme.

## 10. Beklenen Sonuc

Bu optimizasyon plani ile:

- Admin panelde operasyon hizi ve hataya dayaniklilik artar.
- Mobile web deneyiminde tamamlanma oranlari yukselir.
- UI/UX kalitesi release surecinde olculebilir gate mekanizmasina baglanir.
