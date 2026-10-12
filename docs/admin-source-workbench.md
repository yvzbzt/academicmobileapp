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
