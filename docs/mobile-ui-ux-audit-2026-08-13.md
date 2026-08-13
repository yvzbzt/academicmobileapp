# Mobil UI/UX, Performans ve İşlev Denetimi

Tarih: 13 Ağustos 2026
Sürüm: 0.1.4, Android derleme 15
Hedef: React Native Android ve iOS uygulaması
Görsel test cihazı: yerel `GalaxyS24Qa`, 1080x2340 px, 420 dpi, Android API 24 Google APIs, 2 GB RAM, 4 çekirdek
Referans: Leonxlnx Taste Skill içindeki `scan -> diagnose -> targeted fix -> verify` yaklaşımı

## Sonuç

İlk ekran görüntülerindeki yapay portreler, üretilmiş kampüs/takvim görselleri, büyük tanıtım kartları, zor okunan yatay etkinlik düzeni, gereksiz kart katmanları ve aynı işi yapıyormuş gibi görünen filtre şeritleri kaldırıldı. Uygulama artık platformun yerel yazı tipini kullanıyor: Android'de sistem Roboto, iOS'ta sistem San Francisco. Bu tercih, web kökenli Inter görünümünü kaldırırken iki platformun erişilebilirlik ve dinamik yazı boyutu davranışını koruyor.

Yerel release APK üzerinde giriş, ana sayfa ve sekme geçişlerinde 10-20 saniyelik bekleme yeniden oluşmadı. Ölçülen görünür sekme süreleri 46-91 ms, ilgili render tamamlanmaları 141-181 ms aralığında kaldı. Üretim VPS'sinde yüksek yük görülmedi; gecikmenin ana nedeni mobil başlangıçta seri ve gereğinden erken yapılan veri çağrıları ile Android sekme olaylarının iki kez tetiklenmesiydi.

Google yerel oturum penceresi açılıyor ve Google hesap ekleme ekranına ulaşıyor. Ancak bu APK hâlâ debug anahtarıyla release imzalanıyor. Gerçek mağaza/üretim Google oturumunun tamamlanması için ayrı release keystore oluşturulmalı, release SHA-1/SHA-256 değerleri Google Cloud/Firebase Android OAuth istemcisine eklenmeli ve modern Play Store imajı veya fiziksel cihazla hesap dönüşü doğrulanmalıdır. Bu dış yapılandırma tamamlanmadan Google girişine “üretimde tamamen doğrulandı” denmemelidir.

## Bulgu ve Düzeltmeler

| Alan | İlk bulgu | Yapılan düzeltme | Doğrulama |
| --- | --- | --- | --- |
| Üniversite seçimi | Klavye alt sayfanın üstüne geliyor, arama sonucu klavyenin altında kalıyor ve ilk dokunuş seçim yapmıyordu. | Android alt sayfası `KeyboardAvoidingView` ile kullanılabilir yüksekliğe küçültüldü. Sonuç listesi her sorguda başa alınıyor, klavye açıkken liste dokunuşları korunuyor ve boşluk/karakter normalizasyonu Türkçe aramada uygulanıyor. | Aranan Abdullah Gül Üniversitesi görünür kaldı, sonuç dokunularak seçildi ve alt sayfa kapandı. `60-latest-university-search.png`, `61-latest-university-selected.png`. |
| Giriş ekranı | Büyük kart içinde form, gereksiz şablon hissi ve ekran boyuna bağlı kaydırma riski vardı. | Dış kart kaldırıldı, kod tabanlı gündem özeti ve düz form yüzeyi kullanıldı. Yerleşim güvenli alan yüksekliğine göre üç sabit yoğunlukta çözülüyor. | Galaxy S24 profilinde iki ScrollView de `scrollable=false`; son eylem güvenli alan içinde. `74-login-unframed.png`. |
| Kayıt | Uzun formda alanların ve şifre ölçütlerinin taşma riski vardı. | Alan sırası, görünür etiketler, şifre gereksinimleri ve dokunma hedefleri düzenlendi. Bu ekran içerik uzunluğu nedeniyle bilinçli olarak kaydırılabilir. | Alanlarda kesilme veya üst üste binme görülmedi. `75-registration.png`. |
| Ana sayfa | Yapay takvim görseli, sahte portre ve sıkışık üç sütunlu etkinlik kartları akademik araçtan çok tanıtım ekranı görünümü veriyordu. | Üretilmiş görseller kaldırıldı. Gerçek fotoğraf yoksa baş harf avatarı, sade sıradaki etkinlik özeti ve okunabilir iki bölümlü etkinlik satırları kullanıldı. | Uzun Türkçe başlıklarda içerik sırası ve tarih görünür. `77-final-home.png`. |
| Duyurular | İki yatay filtre satırı aynı işlevi tekrar ediyormuş gibi görünüyordu; sekmeye girildiğinde boş ekran donmuş izlenimi veriyordu. | İçerik türleri tek yatay kategori şeridinde kaldı; farklı iş yapan kaynak kapsamı etiketli tek açılır alana dönüştürüldü. Yükleme, boş, hata ve güvenilir içerik durumları ayrıldı. | Sekme 76 ms'de görünür, güvenilir feed 171 ms'de sonuçlandı. Boş durum açıkça gösteriliyor. `78-final-announcements.png`. |
| Takvim | Metinli yüzen “kişisel sınav ekle” düğmesi etkinlik kartlarının üstünü kapatıyor, kişisel kayıt yalnız sınav gibi adlandırılıyordu. | Kişisel kayıt Etkinlik, Sınav, Ders, Çalışma, Görev ve Diğer türlerine genişletildi. Ekleme eylemi 48x48 başlık ikonuna taşındı; içerik üstündeki mutlak düğme kaldırıldı. | Kart örtüşmesi yok. Ekleme alt sayfası başlık, tür, tarih, saat, konum/not ve hatırlatma alanlarıyla açılıyor. `81-final-calendar-no-overlay.png`, `82-final-personal-editor.png`. |
| Kişisel hatırlatıcı | Yerel kayıtların bildirim zamanı yoktu. | Hatırlatma yok, başlangıçta, 10/30 dakika, 1 saat ve 1 gün önce seçenekleri; planlama, güncelleme, iptal ve uygulama açılışında uzlaştırma eklendi. | Yarın için etkinlik ve 10 dakika önce hatırlatma kaydedildi; Android alarmı görüldü. Kayıt silindiğinde alarmın da kaldırıldığı doğrulandı. `68-latest-reminder-options.png`. |
| Profil | Yapay profil fotoğrafı, dekoratif kampüs görseli, tamamı büyük bölüm başlıkları ve “Tehlikeli İşlemler” altında çıkış güven vermiyordu. | Yalnız gerçek URI varsa fotoğraf gösteriliyor; aksi halde baş harf var. Bölümler cümle biçiminde. Çıkış, nötr “Oturum” bölümünde bağımsız düğme. Silme alanı “Hesap ve veri” içinde açık biçimde adlandırıldı. | `80-final-profile.png`, `62-latest-account-data.png`, `63-latest-profile-logout.png`. |
| Çoklu üniversite | API'de ekleme/listeme temeli vardı; mobil yönetim, kaldırma, birleşik duyuru ve bildirim kapsamı eksikti. | Takip ekranı, ekleme/kaldırma endpoint'i, kullanıcı sahipliği kontrolü, ana üniversite ile takiplerin duyuru birleşimi ve bildirim worker kapsamı eklendi. | Canlı API'de switch ile takip kaldırma `200` döndü ve sayaç 2'den 1'e indi; sahiplik API testi de geçti. `85-post-vps-follows.png`. |
| Admin duyuru kaynakları | Üniversite dışındaki fakülte/bölüm kaynaklarını elle yönetme, kaynak sağlığı ve dinamik tarama sıklığı yoktu. | Üniversite/fakülte/bölüm kapsamlı kaynak CRUD, 5-10080 dakika dinamik sıklık, etkin/pasif durum, sağlık/kayıt sayısı ve “Şimdi tara” eylemi eklendi. Yeni kaynak ilk kayıtta otomatik taranıyor; scheduler yalnız süresi gelen aktif kaynakları çekiyor. | Playwright ile bölüm kaynağı oluşturma, 90'dan 45 dakikaya güncelleme, manuel tarama, sağlık sayısı ve pasife alma uçtan uca geçti. `admin-announcement-sources.png`. |
| Admin ders programı | Ders adı, saat, yer ve haftalık tekrar için yapılandırılmış yönetim yoktu. | Üniversite/fakülte/bölüm, dönem, ders kodu/adı, başlangıç-bitiş, yer ve haftalık tekrar bitişi alanları eklendi. Tek seri yayınlanıyor, listeleniyor ve seri olarak kaldırılıyor. Mobil ders programı endpoint'i bu yayınlanmış kayıtları okuyor. | Playwright ile dört haftalık oturum oluşturma, listeleme ve silme uçtan uca geçti. `admin-course-schedule.png`. |
| Genel tasarım | Inter, yüksek yarıçaplar, yoğun gölge, yapay görseller ve tek ton mavi kullanım “AI şablonu” hissi veriyordu. | Inter bağımlılığı/import'u kaldırıldı; sistem fontları, daha küçük yarıçaplar, daha az gölge, mavi yanında işlevsel yeşil/sarı/kırmızı tonları ve kod tabanlı ikonlar kullanıldı. | Ana sayfa, duyuru, takvim, profil, auth ve admin ekranları ekran görüntüsüyle yeniden incelendi. |

## Performans Ölçümleri

Ölçümler release x86_64 APK, yerel Galaxy S24 profili ve üretim API'si ile `EXPO_PUBLIC_RUNTIME_DIAGNOSTICS=1` kullanılarak alındı.

| Akış | Ölçüm |
| --- | ---: |
| Temiz uygulama başlangıcı, Android Activity | 1140 ms |
| Temiz başlangıçta yerel oturum depolama | 349 ms |
| Oturumsuz bootstrap hazır | 368 ms |
| Üniversite kataloğu, arka plan | 998 ms |
| E-posta/şifre login API | 1024 ms |
| Login sonrası `/me` | 158 ms |
| Login isteğinden Home görünür olana kadar | 1386 ms |
| Arka plan takvim/ders/takip/tercih istekleri | 167-456 ms |
| Duyurular sekmesi görünür | 76 ms |
| Duyurular ilk render / feed | 166 ms / 171 ms |
| Takvim sekmesi görünür / render | 91 ms / 181 ms |
| Profil sekmesi görünür / render | 46 ms / 141 ms |

Uygulama başlangıcında yalnız oturum ve profil navigasyonu bloke ediyor. Üniversiteler, takvim, ders programı, yaklaşanlar, takipler ve bildirim tercihleri görünür ekran hazır olduktan sonra paralel yükleniyor. Sekmeler lazy mount ve blur sırasında native freeze kullanıyor. Android'in tek dokunuşta ürettiği `onPressIn + onPress` ikilisi 500 ms route bazlı dedupe ile tek dispatch'e indiriliyor; gerekirse 80 ms sonra state kontrollü tek retry yapılıyor.

## Google Giriş Denetimi

- Android OAuth istemcisi ve Web istemcisi `google-services.json` içinde bulundu.
- Mevcut debug SHA-1 yapılandırması yerel anahtarla eşleşiyor.
- Native `SignInHubActivity` yaklaşık 176 ms'de açıldı; Google hesap ekleme akışına ulaşıldı.
- Loglarda `DEVELOPER_ERROR`, `ApiException` veya istemci kimliği hatası görülmedi.
- Düşük gereksinimli API 24 Google APIs imajında Play Store hesabı yok ve Google hesap ekleme tamamlanamıyor. Bu nedenle token callback ve backend `/auth/google` çağrısı bu emülatörde uçtan uca tamamlanmadı.
- Teslim APK'sı debug keystore ile imzalı release yapıdadır. Üretim release keystore ve onun SHA-1/SHA-256 OAuth kaydı eksik olan gerçek yayın engelidir.
- VPS'de `GOOGLE_OAUTH_CLIENT_IDS` yapılandırılmıştır; Google token doğrulamasının OAuth `tokeninfo` yedeği kullanılabilir. `FIREBASE_SERVICE_ACCOUNT_JSON` ve `GOOGLE_APPLICATION_CREDENTIALS` ise eksiktir. Bu eksiklik Google OAuth yedeğini engellemez, ancak sunucudan Firebase push gönderimini engeller. Yalnız proje kimliğinin Admin kimliği sayılmasına son verilerek gereksiz metadata sorgusu ve belirsiz push sonucu kaldırıldı.

## Test Sonuçları

- Native Jest: `36/36` suite, `300/300` test başarılı.
- AppNavigator: `28/28` tam route/sekme/back/keyboard senaryosu başarılı.
- API ve ortak Vitest: yerel Mongo gerektirmeyen `990/990` test başarılı; `11` Mongo testi atlandı.
- Üç Mongo suite'i yerelde `127.0.0.1:27017` servisi olmadığı için setup aşamasında çalışmadı. Docker daemon da bu bilgisayarda açık değildi. Üretim veritabanı test amacıyla kullanılmadı.
- Admin Playwright Chromium: `2/2` uçtan uca senaryo başarılı.
- Root TypeScript ve native TypeScript kontrolleri başarılı.
- Admin production Vite build başarılı.
- x86_64 release APK Galaxy S24 emülatöründe kuruldu ve manuel akışlar doğrulandı.
- Son x86_64 APK yeniden kurulduğunda oturum korundu; soğuk açılışta profil dahil ana ekran `2350 ms` içinde hazırlandı.

## VPS Dağıtımı

- API commit'i `0a4d05a`, checksum etiketli Docker image olarak otomatik rollback kaydıyla etkinleştirildi.
- Admin üretim paketi staging, backup ve rollback akışıyla etkinleştirildi; edge Caddy yeniden başlatılmadan reload edildi.
- API, admin, MongoDB ve edge container'ları sağlıklı; API ve admin restart sayıları `0`.
- Dış üniversite kataloğu ve admin yanıtları son kontrolde `0.12 sn` altında kaldı.
- Takip silme, duyuru kaynağı ve ders programı rotaları kimliksiz istekte beklenen `401` korumasını verdi.
- Son on dakikalık API logunda hata satırı ve Firebase metadata uyarısı yoktu.

## APK Teslimi

- Dosya: `artifacts/native-qa-20260813-galaxy-s24/AcademicCalendar-0.1.4-ui-ux-qa-arm64-v8a-release.apk`
- Paket: `com.anssoft.akademiktakvim`
- Sürüm: `0.1.4`, derleme `15`
- Android: minimum API 24, hedef API 36
- Yerel mimari: yalnız `arm64-v8a`
- Boyut: `37.965.529` bayt
- İmza doğrulaması: APK Signature Scheme v2 başarılı
- İmza sertifikası: Android Debug, SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- APK SHA-256: `9FDB232FD3A53057AA2FF41E54E7B296C7C39C80D2984ABB32E8D026B35C325C`

Bu dosya doğrudan QA/cihaz kurulumu içindir. Play Store veya üretim dağıtımı öncesinde kuruluşa ait release keystore ile yeniden imzalanmalı ve bu sertifikanın Google OAuth SHA-1/SHA-256 kayıtları eklenmelidir.

## Görsel Kanıt Dizini

Tüm kanıtlar `artifacts/native-qa-20260813-galaxy-s24/` dizinindedir. Ana dosyalar:

- `74-login-unframed.png`: sabit, kaydırmasız giriş
- `75-registration.png`: kayıt alanları ve şifre ölçütleri
- `60-latest-university-search.png`: arama sonucu açık seçim alt sayfası
- `61-latest-university-selected.png`: klavye açık aramadan sonra seçim
- `77-final-home.png`: sade ana sayfa
- `78-final-announcements.png`: tek kategori şeridi ve ayrı kaynak filtresi
- `81-final-calendar-no-overlay.png`: kartları kapatmayan başlık eylemi
- `82-final-personal-editor.png`: genel kişisel etkinlik ve hatırlatma formu
- `80-final-profile.png`: gerçek veri/baş harf kullanan profil
- `85-post-vps-follows.png`: canlı API ile tek ek üniversite takibi
- `90-final-home-copy.png`: son ana sayfa metni ve taşmasız yerleşim
- `admin-announcement-sources.png`: kaynak, sıklık ve sağlık yönetimi
- `admin-course-schedule.png`: yapılandırılmış ders programı yönetimi

## Doğrulama Sınırları

1. Windows üzerinde gerçek iOS simulator çalıştırılamadı. iOS için safe-area, keyboard avoiding, dinamik font ve navigation sözleşmeleri test edildi; fiziksel iPhone/iPad görsel turu ayrıca yapılmalıdır.
2. API 24 headless emülatör input servisi odak ve yeniden boyutlandırmayı raporlasa da ekran görüntüsünde IME piksellerini boyamıyor. Sonucun görünür/tıklanabilir bounds'u ve seçim sonrası modal kapanışı UIAutomator ile doğrulandı.
3. Google'ın gerçek hesap callback'i modern Play Store imajı veya fiziksel cihaz ve üretim imza kaydı olmadan tamamlanamaz.
4. Duyurular endpoint'i hızlı yanıt veriyor ancak seçili üniversite için üretimde henüz güvenilir içerik dönmüyor. Yeni admin kaynakları eklenip ilk tarama tamamlandığında boş durum içerikle dolacaktır.
