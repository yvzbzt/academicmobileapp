# Öncelikli üniversiteler — canlı mobil kaynak QA

Tarih: 15 Eylül 2026. Branch: `agent/priority-university-sources-20260915`.
API ve worker'da çalışan kod: `7689133b25098189b6b3d02e8a68faa755e1dbdf`. Sonraki mobil çekim-zamanı düzeltmesi API girdilerini değiştirmez.
Bu rapor üniversite geneli duyuru/haber/etkinlik kaynaklarını kapsar; tüm 208 üniversitenin veya fakülte/bölüm kaynaklarının tamamlandığı anlamına gelmez.

## Öncelikli altı üniversite: gerçek Android sonucu

Android API 24 emülatöründe mevcut debug uygulaması, güncel Metro paketi ve gerçek oturum kullanıldı. Backend'in kaynak manifestinden sonra cihazın doğrudan çektiği içerikler, ekran kartları ve uygulamanın özel kaynak önbelleği kontrol edildi.

| Üniversite | Duyuru | Haber | Etkinlik | Toplam |
| --- | ---: | ---: | ---: | ---: |
| Ankara | 10 | 20 | 20 | 50 |
| Kahramanmaraş Sütçü İmam | 30 | 30 | 30 | 90 |
| Yalova | 10 | 10 | 9 | 29 |
| Selçuk | 24 | 24 | 10 | 58 |
| Konya Teknik | 10 | 15 | 3 | 28 |
| Necmettin Erbakan | 21 | 21 | 5 | 47 |
| **Toplam** | **125** | **120** | **57** | **302** |

- Altı üniversitenin 18 kaynağı cihazda içerik üretti; `failedSourceIds=[]`.
- Hesabın mevcut MAKÜ takibindeki 14 içerikle gerçek önbellek 316 kayıt içeriyor; şema sürümü 5. Artık ilk 100 kayıtla sınırlı değil.
- Altı üniversitenin içerikleri uygulamada kontrol edildi. KTÜN için “Mavi Vatan” etkinlik kartının 23 Temmuz–23 Ağustos 2026 tarih aralığı ayrıca görüldü. Kış aylarına ait Teknofest kayıtlarının önbellekte bir gün geri kaymadığı doğrulandı.
- Kod değişiklikleri bittikten sonra Ankara araması ve RSS duyurusunun gerçek **Duyuru Detayı** ekranı tekrar açıldı; başlık, yayın zamanı, içerik özeti ve resmî kaynak bilgisi görüldü (`mobile-ankara-detail.png`).
- NEÜ'nün Karabük kongre duyurusundaki 15 Ekim 2026 etkinlik başlangıcı artık gelecekteki bir yayın tarihi olarak gösterilmiyor. Son gerçek cihaz önbelleğinde 21 NEÜ duyurusu korunuyor; kongre kaydının sahte yayın alanı yok.
- Test hesabının ana üniversitesi KSÜ ve mevcut MAKÜ takibi korundu. Karşılıklı kontrol için Ankara, Yalova, Selçuk, KTÜN ve NEÜ takipleri eklendi ve bırakıldı.
- QA otomasyonunun arama temizleme/geçiş zamanlaması bazı denemelerde başarısız oldu; bu denemeler başarı kanıtı sayılmadı. “Konya teknik” araması başlığında “Ostim Teknik” geçen bir NEÜ kaydını da doğru olarak eşleştirir; yalnız üniversite filtresi değildir.

## Admin paneli ve canlı durum

Üretim admin panelinde oturum açılıp altı üniversitenin her içerik türünde **Test Et / Önizle** çalıştırıldı. 18/18 önizleme `healthy`, tüm yanıtlar HTTP 201. Gerçek tarayıcıda oluşturulan önizleme metni, örnek başlıklar ve ekran görüntüleri kaydedildi.

Son 18 istekte ölçülen süre: en düşük 1.471 ms, medyan 2.249 ms, en yüksek 4.112 ms. Bunlar admin önizleme süreleridir; mobil FPS, pil tüketimi veya release cihaz performansı ölçümü değildir. Hızlı QA isteklerinde görülen 429, mevcut 10 istek/dakika sınırından kaynaklandı; test aralığı düzeltildi, koruma gevşetilmedi.

Ortak ayrıştırıcı 302 kayıt çıkardı; adminin mevcut ek içerik filtresi Yalova duyurusundan ve Selçuk haberinden birer kaydı eleyerek 300 kabul etti. Bu iki ayrı sayaç eşitmiş gibi raporlanmadı.

16:22 UTC canlı Mongo denetiminde **14 üniversite / 39 kaynak** için `active`, `trusted`, `approvalPending=false`, `healthStatus=healthy` ve sağlıklı son probe doğrulandı. Ek kapsam: Bandırma Onyedi Eylül, Bartın, Ege, Marmara, Gazi, Hacettepe, mevcut MAKÜ haber/etkinlik kaynakları ve İstanbul Üniversitesi'nin yalnız haber kaynağı. Ek üniversiteler canlı ortak ayrıştırıcı ve VPS sağlık kontrolünden geçti; hepsi için tek tek Android ekran turu yapıldığı iddia edilmiyor.

İstanbul haber kaynağı admin panelinde ayrıca test edildi: 10/10 haber, `healthy`, HTTP 201, 2.113 ms. Böylece öncelikli 18 önizlemeye ek bir gerçek panel testi yapıldı. Kullanılan kaynak, resmî İletim gazetesinin “İstanbul Üniversitesi” kategorisidir; merkez CMS'nin bütün haberlerini kapsadığı iddia edilmez. Kaynağın son haberi 22 Temmuz 2026; bugünün haberi gibi etiketlenmedi. İlk otomasyon İstanbul ile Cerrahpaşa'yı kısmi adla eşleştirdiği için durdu; tam ad seçicisiyle doğru kurumda tekrar çalıştırıldı.

Marmara 5, Bartın 32 ve Bandırma 10 etkinlikte liste tarihinin gerçekten etkinlik günü olduğu resmî detay sayfalarıyla karşılaştırıldı. 47 kaydın tamamında `keyDates` korunuyor ve sahte yayın alanı yok. Üç kaynak ayrı kapsamlarla VPS'de güncellendi. Marmara'nın ilk staging denemesi başarısız oldu; tek başına tekrar denemesi ve son canlı durum kontrolü geçti.

Geliştirme sırasında görülen yenileme göstergesi ayrıca salt okunur React/native durumuyla incelendi: yükleme tamamlandıktan sonra 15 hareketsiz örnekte tüm loading alanları kapalı, 316 kayıt ve render sayısı sabitti. Sonsuz yenileme döngüsü kanıtı bulunmadı; kaynak kod güncellemelerindeki Fast Refresh ekran geçişlerini etkiledi. Bu gözlem release performans ölçümü yerine geçmez.

API `/health/live` ve `/health/ready` başarılı; API, Mongo ve admin konteynerleri sağlıklı, worker çalışıyor. API/worker release kimliği ve backend `deployed-commit.txt` aynı kod commit'ini gösteriyor. Canlı admin JS: `index-D_AojbZj.js`.

## Düzeltilen ortak nedenler

- Yanlış/eski liste URL'leri ve seçiciler; menü, hata sayfası ve ilgisiz kategori sonuçları. Ankara için RSS/CMS, KTÜN etkinlikleri için mevcut JSON, Ege için resmî tablo bağlantıları kullanıldı.
- Admin önizleme ve kaynak onayının mobil ayrıştırmayla tutarsız olması; Mongo'da boş parser ayarının `{}`/eksik alan farkı yüzünden güncellenememesi.
- Mobilde yönlendirmeye gönderilen URL'nin gereksiz kanonikleştirilmesi sonucu Ankara RSS yönlendirme döngüsü. İstek yolu/sorgusu korunuyor; HTTPS, otorite ve yönlendirme güvenlik kontrolleri sürüyor.
- Toplam 100 kayıt sınırı ve büyük AsyncStorage satırı. Mevcut Expo dosya API'siyle hesap bazlı özel önbellek kullanıldı; kaynak başına limit, hesap izolasyonu, bildirim geçmişi ve boyut sınırları korundu.
- Etkinlik tarihi ile yayın tarihinin karıştırılması ve eski Android İstanbul saat dilimi verisinin kış tarihlerinde günü kaydırması. Yeni önbellek sürümü eski ayrıştırılmış kayıtları bir kez yeniliyor.
- Gelecekteki yayın alanı içerik silinmeden kaldırılıyor; açık etkinlik tarihleri korunuyor. Mobilde bu karşılaştırma eski backend probe zamanı yerine gerçek çekim anına göre yapılıyor; son kontrolden sonra çıkan gerçek yeni haberlerin tarihi kaybolmuyor. Kaynağın asıl güven/izin bilgileri değiştirilmedi.
- Geçici DNS `EAI_AGAIN` hatası yalnız bir kez, aynı güvenli çözümleme ve toplam istek süresi içinde tekrar deneniyor. TLS/SSRF denetimleri, özel IP engeli veya yanıt boyutu sınırı kaldırılmadı.

Yeni bağımlılık, DNS altyapısı veya ayrı bir ayrıştırma sistemi eklenmedi.

## Regresyon ve tekrar çalıştırma

- API/ortak Vitest: **129 dosya, 1.786 test**. Son genel koşuda 1.785 geçti; release metadata testi eşzamanlı yükte 5 saniyeye takıldı. Aynı dosya tek başına tekrar çalıştırıldığında 2/2 geçti; takılan assertion 195 ms sürdü. Tek koşuda sıfır hata varmış gibi raporlanmıyor.
- Native Jest: **55 suite, 557/557 test geçti**; son mobil çekim-zamanı regresyonları dahil.
- Root ve native TypeScript kontrolleri; admin üretim build'i geçti.
- Önceki yüksek eşzamanlı koşuda dört test varsayılan 5 saniyeyi aştı. O dosyalar ayrı çalıştırılınca ve o aşamadaki iki işçili koşuda geçti. Sonraki tarih regresyonu Marmara/Bartın/Bandırma etkinlik alanlarını düzeltmemizi sağladı. Ürün kodu veya test süreleri salt makine yükündeki timeout nedeniyle değiştirilmedi.
- Yerel Mongo çalışmadığı için aşağıdaki üç gerçek Mongo suite'i bu koşuya dahil edilmedi. Canlı kaynak sağlık okuması bunların yerini tutan tam veritabanı testi değildir.

```powershell
npx vitest run --maxWorkers=2 --exclude apps/api/tests/mongo-notification.repository.test.ts --exclude apps/api/tests/mongo-user-data.repository.test.ts --exclude apps/api/tests/password-recovery-mongo-concurrency.test.ts
npm --prefix apps/mobile-native run test:native -- --runInBand
npm run typecheck
npm run typecheck:mobile:native
npm run verify:curated-content-sources
```

Yerel ham kanıtlar (Git'e dahil değil): `artifacts/qa-priority-20260915/admin-live-preview.json`, `admin-istanbul-universitesi-preview.json`, `unit-final-bounded.json`, `unit-release-retry.json`, `native-final.json`, `admin-*.png`, `mobile-*.png`, `all-university-runtime-audit.json`, `event-date-semantics-marmara-bartin-bandirma.md`. Canlı içerik sayıları ve süreler sonraki koşularda değişebilir.

## Açık kapsam

14:36–14:38 UTC geniş tarama, son Gazi/Hacettepe ve DNS düzeltmelerinden **önceki başlangıç durumudur**: 208 üniversitede 392 mevcut URL test edildi; 123 kaynak sorunlu, 237 profilesiz kaynak teknik olarak içerik üretiyordu. 27 üniversitede bu üç türe ait URL yoktu; toplam 232 tür/üniversite URL yuvası eksikti. Teknik ayrıştırma başarısı tek başına doğru içerik, güven onayı veya mobil görünürlük sayılmadı; toplu güven onayı verilmedi. Bu başlangıç sayıları güncel kalan hata sayısı olarak kullanılmamalı.

İstanbul Üniversitesi'nin merkez ve öğrenci CMS duyuru/etkinlik sayfalarında sınırlı istekler hâlâ zaman aşımına düştü; haber RSS'i bu türlere kopyalanmadı. Diğer üniversitelerdeki boş sayfa, yanlış tür, erişim/TLS ve eksik URL işleri açık. **208 üniversitenin tamamı bitmedi.**

Bu turda yeni imzalı APK/AAB oluşturulmadı; Google/Apple etkileşimli giriş, OCR ve tüm PDF görüntüleyici akışı yeniden doğrulanmadı. Selçuk'un PDF bağlantılı muafiyet duyurusu mobil aramada ve resmî kaynak kartında görüldü; dokunuş sonrasında dış PDF'nin açıldığı doğrulanamadığı için bu test açık bırakıldı. Mevcut PDF kaynak bağlantıları korundu, fakat yalnız bunu görmek PDF açma testi değildir. Compose, env, imzalama ve Google/Apple anahtar dosyaları değiştirilmedi. Kullanılmayan eski backend imajı, eski admin JS varlığı, bu dağıtımın geçici VPS arşivleri ve yerel aktarım arşivleri temizlendi; koddan yeniden üretilebilirler. Başka uygulamaların konteynerlerine/imajlarına dokunulmadı.
