# Duyuru kaynakları çalışma alanı

- `apps/admin/src/academic-source-workbench.tsx`: Üniversite → fakülte → bölüm ağacı ve kaynak formu. Kaynağı olmayan kayıtlar da görünür. Birimleri yalnız açıldıklarında yükleyerek ekranı ve ağ trafiğini küçük tutar.
- `apps/admin/src/academic-source-workbench.css`: Mevcut tema renkleriyle masaüstü ve mobil yerleşim.
- `apps/admin/src/main.tsx`: Üniversite kaynak sekmeleri, ortak kaynak listesi ve API bağlantısı. Hazır profili bulunmayan üniversiteler de kaynak oluşturabilir.
- URL, parser, altı CSS seçicisi, durum, öncelik ve kontrol aralığı düzenlenebilir. Önce Kaydet → Test Et → Onayla → İçerikleri Çek. Onay ve güvenlik kontrolleri atlanmaz.
- Gelişmiş alanlar açılır; birim, kaynak veya içerik türü değiştirirken kaydedilmemiş form için onay istenir. Düzelt bağlantısı kaynak ID'sini korur ve gerçek akademik birimi açıp ağaç içinde görünür kılar.
- Eski kayıtta içerik türü yoksa API sözleşmesine uygun olarak Duyuru kabul edilir. Kaynak listesi hem dizi hem `items/hasMore` sayfalamasıyla eksiksiz okunur.

Yerleşim araştırmasında [Ant Design ağaç örnekleri](https://ant.design/components/tree/) ve [MUI Tree View örnekleri](https://mui.com/x/react-tree-view/) incelendi; bu kütüphaneler eklenmedi, mevcut React/ikonlar ve tema renkleri kullanıldı.

## Yerel önizlemeyi yeniden açmak

Node 22 ile proje kökünde:

```bash
VITE_API_BASE_URL= npm run build:admin -- --base=/preview/
npm run preview:admin
```

Adres: http://127.0.0.1:3314/preview/#/sources

Bu yalnızca yerel arayüzdür; yayın veya GitHub push yapmaz. API canlı sisteme yönlendirilir. Giriş gerekir; Kaydet/Onayla gerçek veriyi değiştirebilir.

## Eksik kaynak bağlantısı düzeltmesi

- Ağaçtan üniversite/fakülte/bölüm seçilince eksik kaynak listesi aynı üniversiteye filtrelenir. İstek sayacı eski yanıtın yeni seçimi ezmesini engeller.
- Eksik kaynaktaki **Düzelt** ayrı bir ekran açar; URL birimin kimliğini ve kaynak türünü taşır, sayfa yenilenince aynı birim açılır.
- Web sitesi ve ders/sınav programı için yalnız seçilen katalog URL alanı PATCH ile kaydedilir. Diğer adresler silinmez. Duyuru/haber/etkinlik için ilgili birimin içerik düzenleyicisi açılır.
- Eksik kaynak listesi API'nin yayımlanmış doğrulama envanteridir, canlı kayıt listesi değildir. Kaydetmek tek başına bu uyarıyı kaldırmaz.
- Geçici güvenli demo: http://127.0.0.1:3316/preview/#/sources. `/tmp/admin-source-fix-demo.mjs` örnek verileri bellekte tutar; canlı API bağlantısı yoktur. Normal 3314 önizlemesiyle karıştırmayın. Bu demo bilgisayar/süreç kapanınca yeniden başlatılmalıdır.

## Parser ayarlarını toplu yapıştırma

`parser-selector-fields.tsx` iki düzenleyicinin ortak seçici alanlarını oluşturur. Liste öğesi alanına altı seçicili JSON ya da alan–değer tablosu yapıştırılınca önce blok doğrulanır, sonra değerler kendi alanlarına yazılır. Hatalı JSON, bilinmeyen anahtar veya uzun değer hiçbir alanı değiştirmez. Tek CSS seçicisi normal şekilde yapıştırılır. Bu işlem otomatik Kaydet/Onayla yapmaz; taslak değiştiği için önizlemeden önce Kaydet gerekir.

## Sorunlu birimlere hızlı erişim

Üniversite seçilince ağacın üzerinde yalnız o üniversitenin **Sorunlu fakülte ve bölümler** bloğu görünür. Bir kaynağa tıklamak mevcut katalog çözümleyicisini kullanarak doğru birimi, içerik türünü ve kaynak ID'sini sağdaki formda açar; yeni bir düzeltme motoru eklenmez. Kaydedilmemiş form varsa onay istenir. Uyarılar sağlık kontrolünden gelir; bu blok eksik envanter kaydı veya her uyarının gerçek parser hatası olduğunu iddia etmez.

## Eksik envanterin açılır blokları (14 Ekim arayüz sürümü)

`source-coverage-groups.tsx`, mevcut API sayfasını üniversite → fakülte → bölüm kimlikleriyle gruplar. Bölümün farklı kaynak türleri tek blokta kalır; fakülte geneli ayrı gösterilir. Kapalı blokların satırları ancak açılınca oluşturulur. Sayaçlar yalnız dönen sayfayı sayar; diğer kayıtlar Sonraki ile gelir. Envanter kayıtları, düzeltme hedefleri ve onay akışı değişmez.

Eskiden metin araması yalnız Enter/Filtrele ile uygulanıyordu; artık 400 ms beklemeyle uygulanır ve sayfa başa döner. Beklerken önceki sonuçlar gizlenir; mevcut istek sayacı geç gelen eski yanıtları engellemeye devam eder. Kimlikler ve hata kodları Teknik ayrıntı altında tutulur.

Güvenli örnek verili önizleme: http://127.0.0.1:3320/preview/#/sources (`/tmp/admin-coverage-groups-demo.mjs`). Canlı API bağlantısı yoktur; işlemler yalnız bellektedir. Bu geçici süreç/dosyalar kapanma veya yeniden başlatma sonrası yeniden hazırlanmalıdır. 14 Ekim onayıyla bu değişiklikler yalnız admin arayüzünün yayın paketine alınır; demo paketi yayınlanmaz.

### Çalışmaya başlamadan önceki son kontrol

14 Ekim kontrolünde kaynak paneli ve ilgili sözleşmeler için 68 birim testi, giriş/rol kontrolü, dokuz sayfanın açılması, kaynak oluşturma/kaydetme/önizleme/onay, hatalı kayıtta taslağın korunması, gruplama/sayfalama ve 320–1440 px görünümü için 8 tarayıcı testi geçti. Admin TypeScript kontrolü ve üretim derlemesi geçti. Canlı admin HTML'i ve API `/health/ready` yalnız GET ile kontrol edildi; üniversite kayıtlarına test yazımı yapılmadı.

Ek tam katalog tarayıcı testi de geçti: 12 Ekim salt-okuma anlık görüntüsündeki 209 üniversite, 2.985 fakülte ve 14.966 bölüm ağaca eksiksiz işlendi ve açıldı. Bu test yerel sahte API ile anlık görüntüyü yeniden oynatır; bütün üniversite sitelerinin HTML/parser doğrulaması veya bugünkü canlı katalog taraması değildir.

Adres/kaynak düzeltme ekranında kaydedilmemiş taslakla Uyarılara geri dön seçilince artık onay istenir; iptal taslağı korur. Kaynak sayfasında kaydedilmemiş taslak varsa sayfa yenileme/kapatma için tarayıcı uyarısı da etkinleşir. Başarısız Kaydet taslağı temizlemez. Ağaçtan başka üniversite seçilince önceki metin araması temizlenir; kaynak türü gibi diğer filtreler korunur. Bu korumalar ve açılır envanter blokları 14 Ekim admin arayüz sürümünün kapsamındadır; mevcut API ve içerik worker'ı korunur.

Kaydet yanıtı başarılıysa dönen kaynak kaydı, liste yenilemesinden önce mevcut yerel kaynak listesine kimliğiyle birleştirilir. Sonraki GET 503/zaman aşımı verirse yeni kaynak kimliği ve CAS alanları kaybolmaz; kullanıcı yanlışlıkla ikinci POST oluşturmaz. Reddedilen Kaydet yanıtı yerel kayıtlara eklenmez. Ayrı liste yenileme hatası yine görünür kalır.

Gerçek iş için `https://academic-api.anssoft.com.tr/admin/#/sources` kullanılır. 3320 önizlemesindeki Kaydet işlemleri örnek verilere gider, gerçek üniversite ayarlarını güncellemez. Sağlık uyarısı ile yayımlanmış eksik envanter aynı veri değildir; bir adresi kaydetmek envanter uyarısını anında kaldırmaz. Dış üniversite sitelerinin değişmesi/zaman aşımı her kaynak için ayrıca Test Et/Önizle ile değerlendirilir.

## Boş liste / eski içerik ayrımı

Önceki mantık `0 içerik → seçici bozuk` idi. Ortak runtime artık Selçuk'un doğrulanmış boş-liste işaretini ve güncellik filtresine takılan kayıtları ayrı kodlarla bildirir. Önizleme ve günlük sağlık kontrolü bunları `degraded` bilgi/uyarı durumu olarak kaydeder; başarısızlık sayısını artırmaz, kaynağı onaylamaz, kayıtlı içerikleri silmez. Gerçek seçici/erişim/güvenlik hataları korunur. Yönetici ekranı teknik kod yerine Türkçe açıklama gösterir. Bu değişiklik yalnız arayüz yayınıyla etkinleşmez; API/runtime yayını da gerekir.

Bu düzeltme Selçuk birim liste sayfalarıyla sınırlıdır. Çalışma alanındaki ayrı parser/mobil değişiklikleri yayın paketine alınmaz; tüm kirli çalışma alanının testlerinin geçtiği iddia edilmez. Yalnız commit'e alınan kaynakların ayrı kopyası test edilir.

Timeout incelemesinde canlı API'nin güvenli HTTP istemcisiyle Selçuk sayfası iki kez yaklaşık iki saniyede açıldı; sayfa yine boştu. Önizleme için Selçuk birim liste URL'lerinde yalnız `OUTBOUND_REQUEST_TIMEOUT` hatasına bir kez, 10 saniyelik sınırla tekrar izin verilir. Diğer hatalar yeniden denenmez; güvenlik/otorite kontrolleri korunur. Admin form değişince ve yeni işlem başlayınca eski önizlemeyi temizler, test sırasında bekleme mesajı gösterir. Üstteki zaman damgalı **Son sağlık kontrolü**, aşağıdaki manuel testten ayrı kayıttır.

### API yayını: mevcut v4 üzerine dar yama

Canlı API, yerel kaynak ağacından daha yeni `device-source-runtime-v4` kullanır. Bu nedenle eski yerel API'nin tamamı yeniden derlenip yayınlanmaz. `deploy/hetzner/apply-admin-source-hotfix.mjs`, incelenmiş canlı modüllerin SHA-256 değerlerini doğrular; runtime, ingestion service, iki yardımcı modül ve iki repository modülünden oluşan altı dosyalık paket üretir. Repository dosyalarında yalnız `completeSourceApproval` metodu değiştirilir. Genel parser, v4 sürümü, sayfalama/ayrıntı okuma ve diğer özellikler korunur. Farklı canlı temel sürümde işlem durur; yama otomatik genellenmez.

Paket mevcut değişmez Docker imajının üzerine kurulur; çevrimdışı canary testi sonrası yalnız API ve içerik worker'ı yenilenir. Release klasöründeki compose override bu iki servis için yeni imajı belirtir; sonraki operasyonlarda bu override da kullanılmalıdır. Geri dönüş eski değişmez imajla yapılır. Admin paketi ayrıca aşağıdaki yöntemle yayınlanır. Kaynak kayıtları için migration veya toplu güncelleme yapılmaz.

`admin-source-hotfix.Dockerfile` yalnız doğrulanmış paketi alır. `verify-admin-source-hotfix.mjs` imaj içinde `--network none` ile parser hash'ini, v4/sayfalama davranışını, hata ayrımını ve tekrar sınırını kontrol eder. `activate-admin-source-hotfix.sh <tam-commit>` mevcut temel imajı ve servisleri doğrular, eski ayarlara dokunmadan release override oluşturur; sağlık kontrolü geçmezse yalnız iki servisi önceki imaja döndürür.

## Onaylı arayüz yayını

Üretim paketi `/admin/` tabanıyla ve `VITE_API_BASE_URL=https://academic-api.anssoft.com.tr` ile hazırlanır; demo paketi yayınlanmaz. `deploy/hetzner/admin/activate-static-admin.sh <commit>-<YYYYMMDD>` yalnız admin dosyalarını değiştirir, önceki sürümü yedekler ve kontrol hatasında geri döner. Mevcut sunucu ayarları, API ve veritabanı korunur. Yayından sonra `verify-admin.sh` ile sağlık/güvenlik ve tarayıcı yükleme kontrolü yapılır. Gerçek Kaydet/Onayla işlemleri canlı veriyi değiştirdiğinden ayrıca kontrollü test gerekir.

## Doğrulama

### 14 Ekim 2026 — eski içerikle kaynak onayı

Son temiz kopyada 91 API test dosyası / 1.254 test geçti; ayrıca 147 odaklı kontrol ve dört tarayıcı akışı geçti. TypeScript kontrolleri ve admin üretim derlemesi başarılı. Üç bağımsız bildirim/kullanıcı/şifre-kurtarma Mongo entegrasyon grubu ayrı yerel test veritabanı kurulumu gerektirdiği için geniş taramanın son çalışmasında kapsam dışıdır; yeni kaynak onayı akışı ayrıca gerçek, geçici ve ağsız MongoDB üzerinde doğrulandı.

Canlı v4 imajına uygulanan altı modüllük yama, servisler değiştirilmeden salt okunur/ağsız konteynerde test edildi. Uyarıyla onay, eski içerik ve bildirim yayımlamama, yeni içerikte normale dönüş, yanlış seçiciyi engelleme ve eski onay isteğine 409 verme doğrulandı. Test veritabanı kaldırıldı; üretim veritabanına yazılmadı. Bu test sırasında çalışan API/worker/Mongo/Caddy değişmedi. Kullanıcı 14 Ekim'de son kontrol, kişisel GitHub'a push ve canlı yayın için onay verdi; yayın sonrası ayrıca canlı sağlık ve tarayıcı kontrolü gerekir.

`SOURCE_LISTING_STALE` (okunabilen içeriklerin bir yıldan eski olması) aynı kaynak bloğunda sarı **Uyarı** olarak gösterilir; teknik hata sayısına eklenmez. Kaynak aktifliği, parser ve tarih filtresi değiştirilmez. Yeni duyuru kontrolleri devam eder; eski duyurular güncelmiş gibi yayımlanmaz. Sağlık kontrolünün gecikmesi ayrı bir durumdur. Bu ayrım `source-health-alerts.ts` içinde yapılır; görünüm `academic-source-workbench.tsx` ve `main.tsx` içinde uygulanır.

KTÜN Kimya Mühendisliği'nin `Birim/DuyuruDetay/bOlUmUmUzden_haberler_6877` adresi, adına rağmen tarihli bir haber tablosu içerir. Doğrulanmış bu adres de `isSupportedStaleListingUrl` ile eski içerik uyarısına dahildir. Tablo satırı `main#mainContent .kingster-single-article-content table.MsoTableGrid > tbody > tr`; başlık ikinci hücredeki tarihsiz paragraf, bağlantı üçüncü hücredeki `a[href]`, tarih ikinci hücredeki `strong` öğesidir. Yanlış seçiciler uyarıya dönüştürülmez; yayın filtresi ve v4 sayfalama korunur.

Eski içerikle onay yalnız doğrulanmış liste URL'sinde, tüm kayıtların tarihleri bir yıldan eski olduğu kanıtlandığında ve kontrol sonucu tam olarak `SOURCE_LISTING_STALE` olduğunda kabul edilir. Belirsiz tarih, gelecekteki etkinlik, boş sayfa, yanlış seçici ve güvenlik hatası bu istisnadan yararlanmaz. Onay eski haberleri veya bildirimleri yayımlamaz. Mongo ve bellek repository'leri aynı kaynak tanımı, onay nesli, boş snapshot ve son kontrol zamanı için atomik kontrol yapar. Yeni içerik geldiğinde normal içerik yayınına dönülür. `verify-stale-source-approval-mongo.mjs` yalnız özel olarak adlandırılmış, loopback adresindeki ayrı test veritabanını kabul eder; üretim bağlantısına geri dönmez. Bu test ayrı portsuz/ağsız Mongo konteyneriyle çalıştırılır.

```bash
npm run typecheck:admin
npx playwright test tests/e2e/admin-academic-source-tree.spec.ts -g 'all academic units'
```

Alan testleri sahte API kullanır; canlı sisteme kayıt yazmaz. Tam katalog kontrolü yalnız GET kullanır, istek sınırını gözetir ve önceki başarılı okumaları yeniden kullanır:

```bash
node scripts/verify-admin-catalog-tree.mjs
ADMIN_CATALOG_SNAPSHOT=artifacts/admin-academic-tree/live-catalog.json npx playwright test tests/e2e/admin-academic-source-tree.spec.ts -g 'every branch'
```

Tam katalog tarayıcı testi, verilen anlık görüntüdeki bütün fakültelerin ve bölümlerin ağaca eksiksiz işlendiğini kontrol eder. Bu, katalogda hiç kayıtlı olmayan birimleri keşfetmez.
