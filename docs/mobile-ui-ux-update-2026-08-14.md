# Mobile UI/UX ve APK Doğrulama Raporu

Tarih: 14 Ağustos 2026
Sürüm: 0.1.5
Android derleme: 16

## Kapsam

- Giriş öncesi karşılama akışı
- Giriş ekranı ve Google ile giriş yönlendirmesi
- Ana sayfa, üst gezinme ve hesap menüsü
- Ayarlar sekmesi ve hesap/veri ekranı
- Takvim liste yoğunluğu ve renk paleti
- Düşük gereksinimli Android emülatöründe release APK doğrulaması

## Yapılan Değişiklikler

- Tek sayfalı sahte ajanda karşılama ekranı, üç sayfalı yatay tanıtım akışına dönüştürüldü.
- Karşılama ekranından "Ana Sayfa", sahte gün planı ve ders kayıt tarihi içerikleri kaldırıldı.
- Giriş ekranındaki kampüs görseli geri getirildi; giriş düğmesindeki gereksiz ok kaldırıldı.
- Açılış yükleme durumu uygulamaya özel takvim animasyonuyla değiştirildi.
- Ana ekranın Google Takvim bağlantısı uyarı kartı kaldırıldı.
- Üst gezinmeye sol hamburger menü eklendi; bildirim düğmesi sağda korundu.
- Kişisel kimlik, hesap/veri yönetimi ve çıkış eylemi hamburger menüsüne taşındı.
- Alt menüdeki "Profil" sekmesi "Ayarlar" olarak değiştirildi.
- Ayarlar ekranında akademik bilgiler, takip edilen üniversiteler, bildirim tercihleri ve Google Takvim bağlantısı bırakıldı.
- Takvim ajandası ilk etapta 12 öğeyle sınırlandı; sayaç ve "Daha fazla etkinlik göster" eylemi eklendi.
- Takvim başlıkları ve alt gezinme seçili rengi daha sakin çelik mavi/akademik yeşil palete çekildi.

## Emülatörde Bulunan ve Düzeltilen Hatalar

1. Hamburgerden doğrudan açılan "Hesap ve veri" ekranında geri düğmesi yoktu. Ayarlar ana ekranı artık yığın tabanı olarak korunuyor ve geri dönüş çalışıyor.
2. Logout sonrasında aynı kısmi temizlik uyarısı iki banner olarak görünüyordu. Durum tek, kısa banner ile sınırlandı.
3. Android API 24 üzerinde logout sırasında aralıklı native kapanma yakalandı. `react-native-screens 4.16.0` kaldırma geçişini UI thread dışında çalıştırıyordu. Güncel upstream davranışı olan `screen.post { ... }` güvenli ve idempotent bir `postinstall` yamasıyla geri taşındı.
4. Düzeltmeden sonra aynı hesapla art arda iki giriş-çıkış tamamlandı; süreç canlı kaldı ve temiz logda fatal hata oluşmadı.

## Manuel Doğrulama

Test cihazı: Galaxy S24 profili, 1080x2340, 420 dpi, Android API 24, 2 GB RAM, 4 çekirdek.

- Soğuk activity başlangıcı: 1.346 sn.
- Ana sayfa, duyurular, takvim ve Ayarlar sekmeleri ilk dokunuşta açıldı; 10-20 sn bekleme yeniden oluşmadı.
- Sekmeler 1.2 sn sonraki kontrol karesinde tamamen çizilmiş ve etkileşime hazırdı.
- Takvim gerçek QA verisinde 68 kayıt döndürdü; önce 12 kayıt gösterildi ve ikinci grup düğmeyle açıldı.
- Giriş ekranı 360x640 dp düşük ekran senaryosunda kaydırmasız ve kesilmeden sığdı.
- Google düğmesi gerçek `com.google.android.gms` hesap ekleme ekranına ulaştı. Kişisel Google hesabı girilmedi.
- QA üniversitesinde güvenilir duyuru kaydı dönmedi; boş durum ekranı doğru çalıştı. Bu gözlem veri kapsamıyla ilgilidir.

## Ekran Görüntüleri

Kanıt klasörü: `artifacts/native-qa-20260814-galaxy-s24`

- `01-welcome-slide-1.png`, `02-welcome-slide-2.png`, `03-welcome-slide-3.png`
- `04-login.png`, `06-login-small-360x640.png`
- `07-after-login.png`, `10-announcements.png`, `11-calendar.png`
- `12-calendar-page-limit.png`, `13-calendar-load-more.png`
- `14-settings-root.png`, `15-account-back-fixed.png`, `17-account-drawer-final.png`
- `20-logout-patched.png`, `22-google-signin-wait.png`

## Otomatik Kontroller

- Mobil TypeScript kontrolü: başarılı.
- Native Jest: 37/37 paket, 303/303 test başarılı.
- Son değişiklik odaklı native testler: 61/61 başarılı.
- Oturum, güvenlik ve kütüphane yaması testleri: 47/47 başarılı.
- `git diff --check`: başarılı.

## APK

Dosya: `artifacts/native-qa-20260814-galaxy-s24/AcademicCalendar-0.1.5-student-navigation-arm64-v8a-release.apk`

- Mimari: arm64-v8a
- Boyut: 37.968.725 bayt
- İmza: APK Signature Scheme v2 geçerli
- SHA-256: `C5E64B3A21C93C4E6323C1667E167FBB723D6EF3C14400FA21BB572BE015EBD7`

Not: Release varyantı mevcut Android debug sertifikasıyla imzalanıyor. Mağaza/üretim dağıtımı öncesinde kurumun korunan release anahtarıyla yeniden imzalanmalıdır.
