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

## Onaylı arayüz yayını

Üretim paketi `/admin/` tabanıyla ve `VITE_API_BASE_URL=https://academic-api.anssoft.com.tr` ile hazırlanır; demo paketi yayınlanmaz. `deploy/hetzner/admin/activate-static-admin.sh <commit>-<YYYYMMDD>` yalnız admin dosyalarını değiştirir, önceki sürümü yedekler ve kontrol hatasında geri döner. Mevcut sunucu ayarları, API ve veritabanı korunur. Yayından sonra `verify-admin.sh` ile sağlık/güvenlik ve tarayıcı yükleme kontrolü yapılır. Gerçek Kaydet/Onayla işlemleri canlı veriyi değiştirdiğinden ayrıca kontrollü test gerekir.

## Doğrulama

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
