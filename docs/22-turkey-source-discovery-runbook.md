# Türkiye Üniversite Kaynak Keşfi — Çalıştırma Rehberi

Bu runbook, Türkiye'deki katalog üniversiteleri ile onların fakülte/yüksekokul ve bölüm/program kaynaklarını tekrar üretilebilir, kaldığı yerden devam edebilir ve kanıtlanabilir biçimde taramak için kullanılır. Araç yalnız bulduğu URL'yi kaydetmez; URL sahipliği, canlı cevap, yönlendirme, sayfa anlamı, soft-404, belge yapısı ve kanıt dosyasını birlikte doğrular.

## Nihai çalışma kaydı

> Koşuya özgü nihai değerler `summary.json`, `checkpoint.json` ve dağıtım kayıtlarından alınarak göz ardı edilen `artifacts/university-source-discovery-208-20260911-v9-fresh/FINAL-REVIEW.md` dosyasına yazılır. Commit kimliği kendi sürümlü belgesine gömülmez.

| Alan | Değer |
| --- | --- |
| Koşu tarihi | `2026-09-10` |
| Kaynak commit | `FINAL-REVIEW.md`; GitHub branch ucu ve deploy işaretçisiyle eşleştirilir |
| Çıktı dizini | `artifacts/university-source-discovery-208-20260911-v9-fresh` |
| Hedef üniversite | 208 |
| Katalog akademik birimi | 17.360 |
| Doğrulanmış / karantina otoritesi | 207 / 1 |
| Terminal üniversite ve doğrulanmış URL | `summary.json` ve `FINAL-REVIEW.md` |
| Son revalidation passed / failed | `summary.json` ve `FINAL-REVIEW.md`; release için `failed=0` zorunlu |
| Akademik takvim ile bölüm ders/sınav programı | İlgili JSONL haritaları ve `summary.json` |
| Çözülemeyen toplam | `unresolved-and-not-found.jsonl` ve `FINAL-REVIEW.md` |
| Kalite kapıları | Üç kapının gerçek boolean değerleri `summary.json` ve `FINAL-REVIEW.md` içinde |

## Girdiler ve fail-closed otorite modeli

Araç şu checked-in girdileri birlikte okur:

- `apps/api/src/bootstrap/turkiye-catalog-seed.json`
- `apps/api/src/bootstrap/verified-source-authorities.json`
- `apps/api/src/bootstrap/verified-university-sources.json`
- `apps/api/src/bootstrap/verified-academic-unit-sources.json`

The per-unit aggregate, evidence-backed absence file, and full-coverage rules are specified in [the academic-unit source coverage contract](./23-academic-unit-source-coverage.md).

Hedef manifest katalogdan oluşturulur; bir üniversite yalnız `verified-source-authorities.json` içindeki kendisine ait doğrulanmış alan adları üzerinden doğrulanabilir. Hem ilk URL hem yönlendirme sonrası son URL aynı üniversitenin otorite sınırında olmalıdır. Otoritesi karantinada olan veya katalogla eşleşmeyen kayıt verified veri setine yazılmaz.

Mevcut katalog tabanı 208 kurumu, 2.932 fakülte/yüksekokulu ve 14.428 bölüm/programı, toplam 17.360 akademik birimi hedefler. Bu sayılar kod tabanının başlangıç sözleşmesidir; canlı koşunun gerçek sayıları her zaman `target-universities.json` ve `summary.json` üzerinden doğrulanmalıdır.

Eksik akademik birim sitesi, duyuru, haber, etkinlik, akademik takvim, ders veya sınav programı tahmin edilmez. Eksiklik terminal/açık durum olarak rapora girer.

## Ön koşullar

- Komutlar repository kökünden çalıştırılmalıdır.
- `npm ci` ile kilitli bağımlılıklar kurulmuş olmalıdır.
- Playwright/Chromium çalışabilir durumda ve dış ağa erişebilir olmalıdır.
- Girdi JSON dosyaları typecheck ve unit testlerden geçmelidir.
- Çıktı için yeni veya mevcut checkpoint'e ait, repository içindeki bir `artifacts/...` dizini seçilmelidir.
- Uzun koşularda yeterli disk ve bellek bırakılmalıdır. Kanıt HTML'leri gzip'lidir ancak ekran görüntüsü ve belgeler büyüyebilir.
- Aynı çıktı dizininde iki yazıcı aynı anda çalıştırılmamalıdır.

Başlangıç kapıları:

```powershell
npm.cmd run typecheck:discovery
npm.cmd run test:discovery
npm.cmd run verify:source-authorities
```

### Yerel kod ve doküman review araçları

Teslim iş istasyonunda Ponytail `4.9.0` ve 10 Eylül 2026 tarihinde `@latest` etiketinden çözülen Context7 `4.0.7` kurulumu doğrulanmıştır. Bunlar opsiyonel, yerel review yardımcılarıdır; keşif aracının ağ, tarayıcı, kanıt, otorite veya kalite kapılarından biri değildir ve VPS'e kurulmaz. Kurulum, hook incelemesi, doğrulama komutları ve gizli veri sınırı için [içerik sistemi devir belgesindeki ilgili bölümü](./21-university-content-review-handoff.md#yerel-geliştirme-ve-review-yardımcıları) izleyin.

- Koşudan önce Context7 yalnız Playwright/Node gibi kullanılan bağımlılıkların güncel resmî davranışını kontrol etmek için kullanılabilir; bulunan doküman bir üniversite URL'sini `verified` veya `trusted` yapmaz.
- Kod değişikliği sonrasında `@ponytail-review` ile diff salt okunur incelenebilir; araç önerileri test, typecheck, canlı kanıt ve insan review kapılarını atlayamaz.
- Kanıt HTML'i, kullanıcı/üretim verisi, SSH veya API anahtarı ve `.env` içeriği üçüncü taraf araca gönderilmez. Review notuna yalnız secretsiz bulgu özeti yazılır.

## Kipler

| Kip | Ne yapar | Ağ/tarayıcı |
| --- | --- | --- |
| `prepare` | Hedef manifesti, otorite girdi denetimini, başlangıç checkpoint'ini ve raporu üretir | Canlı tarama yapmaz |
| `pilot` | Seçilen/kısıtlı hedefleri tarar; davranışı ve kaynak tüketimini ölçmek içindir | Kullanır |
| `run` | Terminal olmayan hedefleri checkpoint'ten sürdürür; bütün hedefler terminal olunca final revalidation başlatır | Kullanır |
| `revalidate` | Sonuç dosyalarındaki verified adayları canlı olarak tekrar kontrol eder | Kullanır |
| `report` | Mevcut checkpoint ve sonuçlardan aggregate dosyaları yeniden üretir | Canlı tarama yapmaz |

## Önerilen çalışma sırası

Her koşu için sabit bir çıktı dizini belirleyin:

```powershell
$discoveryOutput = "artifacts/university-source-discovery-208-20260911-v9-fresh"
```

### 1. Hazırlık

```powershell
npm.cmd run discover:universities -- prepare --output=$discoveryOutput --max-attempts=2 --university-concurrency=6 --candidate-concurrency=4 --max-candidates=700 --timeout-ms=12000 --screenshots=representative
```

Kontrol edin:

- `target-universities.json` katalogdaki tüm hedefleri içeriyor;
- `authority-input-audit.json` katalog, source seed ve otorite kayıtları arasındaki farkları açıklıyor;
- `checkpoint.json` hedeflerin tamamını içeriyor;
- `summary.json` başlangıçta koşunun devam edebilir olduğunu gösteriyor.

### 2. Pilot

Önce az sayıda veya bilinen farklı site yapılarına sahip hedefle deneyin:

```powershell
npm.cmd run discover:universities -- pilot --output=$discoveryOutput --limit=3 --max-attempts=2 --university-concurrency=1 --candidate-concurrency=3 --max-candidates=700 --timeout-ms=12000 --screenshots=representative
```

Belirli slug'lar için `--only=id1,id2` kullanılabilir. Pilot sırasında `run.log`, browser readiness, bellek kullanımı, örnek HTML hash'leri ve screenshot'lar incelenmelidir. Pilot çıktısı aynı manifest/checkpoint dizinini kullanıyorsa daha sonraki `run` terminal olmayan hedeflerden devam eder.

### 3. Tam koşu

```powershell
npm.cmd run discover:universities -- run --output=$discoveryOutput --max-attempts=2 --university-concurrency=6 --candidate-concurrency=4 --max-candidates=700 --timeout-ms=12000 --screenshots=representative
```

Bu eşzamanlılık değerleri referans koşu içindir; makine baskı altındaysa artırmayın. Daha düşük değerle devam etmek güvenlidir. `--screenshots` değerleri `representative`, `all` veya `none` olabilir; ham HTML/belge kanıtı screenshot alınamasa da otoritatif kanıt olarak tutulur.

Komut kesilirse çıktı dizinini silmeyin. Her hedefin sonucu `state/universities`, kısmi ilerlemesi `state/progress`, genel durumu `checkpoint.json` içindedir. Aynı komutu yeniden çalıştırmak terminal olmayan ve devam gerektiren hedeflerden sürer.

## Devam ettirme ve retry

Öncelikle `summary.json` içindeki `resumeCommand` alanını kullanın. Komut, son çalışma ayarlarını ve aynı çıktı dizinini taşır. `resumeSelectedScopeCommand`, ilk koşu `--only` ile sınırlandıysa aynı seçili kapsamı korur.

```powershell
npm.cmd run discover:universities -- report --output=$discoveryOutput
```

Ardından raporda üretilen `resumeCommand` değerini aynen çalıştırın. Sabit elle yazılan örnek yalnız fallback'tir:

```powershell
npm.cmd run discover:universities -- run --output=$discoveryOutput --max-attempts=2 --university-concurrency=6 --candidate-concurrency=4 --max-candidates=700 --timeout-ms=12000 --screenshots=representative
```

Durum davranışı:

- `BLOCKED_RETRYABLE`: geçici hata veya aday geçiş sınırı nedeniyle tekrar çalışmalıdır.
- `continuationRequired=true`: `max-candidates` sınırına gelmiştir; kaldığı aday indeksinden devam eder.
- `attempts >= maxAttempts` ve devam zorunluluğu yoksa kalıcı `BLOCKED_FINAL` olur.
- Terminal hedefler normal `run` tekrarında baştan taranmaz.

Bir site geçici olarak çalışmıyorsa kanıt olmadan durumu elle `VERIFIED_COMPLETE` yapmayın. Gerekirse daha sonra aynı checkpoint üzerinde yeniden koşun veya açık kaydı insan incelemesine bırakın.

## Final revalidation

Standart tam `run`, bütün hedefler terminal olduğunda verified adayların tamamını canlı olarak yeniden açar. Her başarılı kayıt yeni `finalRevalidatedAt` alır. Herhangi bir aday başarısız olursa ilgili üniversite `NEEDS_REVIEW` durumuna iner ve `finalRevalidation.failed` artar.

Elle revalidation yalnız istenen koşu kapsamı terminal olduğunda yapılmalıdır:

```powershell
npm.cmd run discover:universities -- revalidate --output=$discoveryOutput --candidate-concurrency=4 --timeout-ms=12000 --screenshots=representative
```

Önemli fail-closed davranış:

- final revalidation tamamlanmamışsa veya `failed > 0` ise çalışma zamanı registry JSON güncellemesi atlanır;
- yalnız `status=verified` ve `finalRevalidatedAt` taşıyan kayıtlar güncelleme adayıdır;
- kaynak ve son URL otorite dışında ise işlem hata verir;
- geçersiz, self-signed veya doğrulanamayan TLS sertifikası kabul edilmez; kayıt `tls_validation_failed` nedeni ile review/blocked kalır;
- HTTP başlangıç URL'si, redirect hop'u veya browser/raw final URL'si trusted kabul edilmez; HTTP→HTTPS redirect bile ilk hop bütünlüğü kanıtlanamadığı için `insecure_transport_evidence` ile review'da kalır;
- güncelleme sonucu `runtime-update-audit.json` içinde sayılır;
- başarısız kaydı zorla registry'ye yazmak veya kanıt dosyasını elle uydurmak yasaktır.

DNS güvenlik notu: crawler her browser/raw ana istek, redirect ve izin verilen alt kaynak öncesinde hostu yeniden çözer; private, loopback, link-local veya karışık public/private cevaplardan herhangi biri görülürse isteği fail-closed engeller. Raw kanal çözülmüş sayısal IP'ye pinlenir, bağlı socket'in uzak adresi tekrar karşılaştırılır ve response 25 MiB ile sınırlandırılır. Browser kanalı yalnız `127.0.0.1` üzerinde çalışan, koşuya özel rastgele kimlik bilgili CONNECT proxy üzerinden çıkar; route preflight'ın kısa ömürlü olarak yetkilendirdiği sayısal IP dışında DNS çözmez ve peer IP eşleşmeden Chromium'a tünel açmaz. QUIC kapalıdır; HTTP, 443 dışı port, proofsuz CONNECT, WebSocket/service worker ve resmî otorite dışındaki alt kaynaklar engellenir. TLS/SNI ve sertifika doğrulaması gerçek üniversite hostname'i ile uçtan uca Chromium'da kalır. Verified kabulü aynı official authority içinde kalan, ayrı browser ve raw kanallarının ikisinin de başarısına bağlıdır.

Revalidation sonrası yalnız aggregate dosyaları tekrar üretmek için:

```powershell
npm.cmd run discover:universities -- report --output=$discoveryOutput
```

## Doğrulama sözleşmesi

Bir kaydın `verified-sources.jsonl` içinde verified sayılabilmesi için en az şu koşullar sağlanır:

- URL geçerli HTTP(S) URL'sidir ve üniversitenin doğrulanmış otoritesindedir;
- gerçek Chromium sayfayı açmıştır (`browserOpened=true`);
- browser isteği DNS kanıtından üretilmiş kısa ömürlü IP izniyle yerel CONNECT proxy üzerinden pinlenmiştir (`browserNetworkProofs`);
- yönlendirme zinciri kaydedilmiş, son URL tekrar otorite kontrolünden geçmiştir;
- HTTP sonucu ve response boyutu kaydedilmiştir;
- anlamlı metin eşiği ve kaynak türüne özgü semantik kurallar geçmiştir;
- soft-404 tespit edilmemiştir;
- listing türlerinde kategori sinyali ve en az bir liste öğesi bulunmuştur;
- mümkünse örnek detay bağlantıları ayrıca açılmıştır;
- akademik takvimde anahtar kelime ve en az iki tarih sinyali vardır;
- ders programında kapsam adı ile gün/saat veya ders yapısı doğrulanmıştır;
- doğrudan belge için uzantıya güvenmek yerine dosya imzası kontrol edilmiş, destekleniyorsa metin çıkarılmıştır;
- tarayıcı DOM kanıtının SHA-256 değeri ve repository'ye göre göreli `evidencePath` alanı vardır; production parser farklı ham baytları kullandıysa ayrıca `parserInputSha256` ve `parserEvidencePath` zorunludur.

Temsili mod her üniversite için homepage kanıtı, başarısız durumlar için ek screenshot üretmeye çalışır. Screenshot başarısızlığı ham HTML/response kanıtını geçersiz kılmaz; `evidencePath` ve hash zorunludur.

## Çıktı dizini sözleşmesi

| Dosya/dizin | İçerik ve review amacı |
| --- | --- |
| `target-universities.json` | Canonical hedef manifesti, otorite ve katalog kapsamı |
| `authority-input-audit.json` | Eksik/fazla source seed ve otorite farkları |
| `browser-readiness.json` | Koşuda kullanılan tarayıcının açılabildiğine dair kanıt |
| `browser-network-audit.json` | Kimlik doğrulamalı proxy lease/tünel/peer-IP denetim özeti; hiçbir proxy kimlik bilgisi içermez |
| `checkpoint.json` | Atomik, devam edilebilir hedef durumu ve son koşu ayarları |
| `state/progress/*.json` | Üniversite başına kısmi aday/verification ilerlemesi |
| `state/universities/*.json` | Üniversite başına terminal sonuç |
| `evidence/html/*.html.gz` | Hash isimli sıkıştırılmış ham HTML |
| `evidence/documents/*` | Hash isimli indirilen belge kanıtı |
| `evidence/screenshots/*.png` | Temsili veya hata ekran görüntüleri |
| `verified-sources.jsonl` | Dedupe edilmiş verified kaynak atamaları |
| `verified-sources.csv` | İnsan review için aynı veri setinin tablo görünümü |
| `academic-units.jsonl` | Her katalog biriminin URL ve çalışma durumu |
| `course-schedule-map.jsonl` | Bölüm/program ders programı eşlemesi |
| `exam-schedule-map.jsonl` | Bölüm/program sınav programı eşlemesi |
| `academic-calendars.jsonl` | Üniversite akademik takvim eşlemesi |
| `unresolved-and-not-found.jsonl` | Eksik, blocked, rejected ve insan incelemesi gereken kayıtlar |
| `verification-manifest.jsonl` | Başarılı ve başarısız bütün aday kontrolleri |
| `runtime-update-audit.json` | Final revalidation sonrasında registry'ye uygulanan alan sayıları |
| `summary.json` | Sayılar, audit, kalite kapıları ve resume komutu |
| `university-source-coverage-final.md` | İnsan tarafından okunabilir nihai rapor |
| `run.log` | Zaman damgalı ilerleme ve revalidation kaydı |

Kanıt dosyaları commit'e eklenmez. Nihai registry kanıt içeriyorsa release paketi `scripts/package-vps-audit-release.sh <commit> <output> <discovery-output>` ile üretilmelidir. Paketleyici yalnız registry'de referans verilen content-addressed `evidence/html` ve `evidence/documents` dosyalarını kopyalar; DOM ve ayrı ham-parser kanıt çiftlerinin tamamını doğrular, screenshot'ları ve ilişkisiz dosyaları dışarıda bırakır. Schema-v4/verifier-v9 kanıt; tam 208 hedef ve 17.360 akademik birim kimliği, güncel tam final revalidation, HTTPS, 2xx, resmî alan, sahiplik kapsamı, semantik ve uygulanabilir parser kontrolleri başarılı olmadıkça; her SHA-256 kendi dosya adına bağlanmadıkça pakete giremez. Tekil dosya üst sınırı 25 MiB, toplam bundle üst sınırı 1 GiB ve artifact üst sınırı 120.000'dir.

Bundle manifesti registry dosyalarının hash'lerini, saklanan dosya hash/boyutlarını, canonical içerik hash/boyutlarını ve release commit'ini taşır. `target-universities.json` hash'i yeniden hesaplanır; `summary.json` ile `checkpoint.json` paketleme anında doğrulanır ve hash'leri provenance olarak manifestte tutulur. Bu çalışma dosyaları runtime image'a kopyalanmaz; hash doğrulaması paketleme trust boundary'sidir. Kaynak arşiv SHA-256 kontrolü, deploy'daki `releaseCommit` karşılaştırması, Docker build arg/OCI revision etiketi ve runtime `APP_RELEASE_COMMIT` kontrolü bu boundary'yi dağıtılan immutable commit'e bağlar. `verified-sources.jsonl` veya registry JSON'u tek başına ham kanıtın yerine geçmez.

## Durumların anlamı

| Durum | Anlamı | Yapılacak işlem |
| --- | --- | --- |
| `NOT_STARTED` | Henüz işlenmedi | `run` ile devam |
| `DISCOVERING` | Link keşfi sürüyor/kesildi | Aynı checkpoint ile devam |
| `VERIFYING` | Aday doğrulaması sürüyor/kesildi | Aynı checkpoint ile devam |
| `BLOCKED_RETRYABLE` | Geçici hata veya aday limiti | Resume komutunu çalıştır |
| `VERIFIED_COMPLETE` | Gereken kapsam doğrulandı | Kanıt örneklemi ve final revalidation kontrolü |
| `NOT_FOUND_VERIFIED` | Arandı, kaynak bulunamadığı doğrulandı | Uydurma URL ekleme; periyodik insan review |
| `BLOCKED_FINAL` | Deneme sınırı sonunda erişim engeli/hata | Manuel tarayıcı ve kurumla doğrulama |
| `NEEDS_REVIEW` | Eksik URL, semantik uyuşmazlık veya son kontrol kaybı | İnsan incelemesi ve gerekirse yeni koşu |

`NOT_FOUND_VERIFIED` olumlu kaynak bulma sonucu değildir. `BLOCKED_FINAL` ile `NEEDS_REVIEW` kayıtları trusted listesine alınmamalıdır.

## Kalite kapıları

`summary.json` üç ayrı kapı üretir:

- `CRAWL_COMPLETE`: 208 checkpoint hedefinin her birinde güncel sonuç artifact'i var, tüm 17.360 akademik birim terminal ve aynı tam kapsam üzerinde final revalidation tamamlanmış;
- `VERIFIED_DATA_GREEN`: crawl complete, tüm verified kayıtlar final revalidated, revalidation hatası/otorite sızıntısı/orphan/duplicate/geçersiz verified kayıt yok;
- `FULL_COVERAGE_GREEN`: verified data green'e ek olarak bütün zorunlu üniversite kaynakları, bütün akademik takvimler ile bütün bölüm ders ve sınav programları bulunmuş, unresolved kayıt kalmamış.

Ülke çapında gerçek siteler eksik veya erişilemez olabileceği için `FULL_COVERAGE_GREEN=false` beklenebilir. Bu, verified kayıtları çöpe atmak için değil, kapsama dair doğru bir açık iş listesi üretmek içindir. Üretim provision/trust kararı verirken en az `VERIFIED_DATA_GREEN`, kayıt düzeyinde `finalRevalidatedAt`, sıfır authority leak ve mevcut kanıt kontrol edilmelidir.

## İnsan review örneklemi

Koşu sonunda en az şu örnekler tarayıcıda ve ham kanıtta karşılaştırılmalıdır:

- farklı CMS kullanan en az beş üniversite;
- HTTP'den HTTPS'e yönlenen en az bir kayıt;
- alt alan adındaki fakülte ve bölüm kaynağı;
- duyuru, haber, etkinlik ve akademik takvimden ayrı örnekler;
- PDF/Office türünde akademik takvim veya program;
- `soft404`, `blocked`, `request_failed` ve `rejected` örnekleri;
- aynı URL'nin iki kapsama aday olduğu ve canonical seçimin dedupe edildiği bir örnek;
- otoritesi karantinadaki kurumun verified çıktıya girmediği kontrolü.

Review sırasında `universityId`, `unitType`, `scopeId`, `sourceUrl`, `browserFinalUrl`, `rawFinalUrl`, `redirectChain`, `officialDomain`, `semanticReasons`, `sampleDetails`, `sha256`, `evidencePath`, varsa `parserInputSha256`/`parserEvidencePath` ve `finalRevalidatedAt` birlikte değerlendirilmelidir.

## Üretime aktarım kontrol listesi

- [ ] Kaynak commit immutable ve uzak repoda mevcut.
- [ ] `typecheck:discovery` ve `test:discovery` geçti.
- [ ] Checkpoint ve manifest aynı schema/hash kapsamına ait.
- [ ] `summary.json.progress.universities.remainingToTerminal=0` ve `summary.json.progress.academicUnits.remainingToTerminal=0`; kalan hedef bulunan koşu üretim release'i olarak paketlenmedi.
- [ ] `finalRevalidation.completedAt` mevcut.
- [ ] `finalRevalidation.failed=0` olduğu doğrulandı; sıfır değilse release paketlenmedi.
- [ ] `authorityBoundaryLeaks=0`.
- [ ] `orphanVerifiedRecords=0`.
- [ ] `duplicateVerifiedAssignments=0`.
- [ ] `invalidVerifiedRecords=0`.
- [ ] `runtime-update-audit.json` aynı run kimliğini, iki registry'nin kesin SHA-256 değerlerini ve yalnız otorite içi URL'leri gösteriyor; yarım kalmış registry publication journal'ı yok.
- [ ] `unresolved-and-not-found.jsonl` admin/handoff açık iş listesine eklendi.
- [ ] Registry provision yeni kayıtları `inactive + quarantined` oluşturdu.
- [ ] `POST /admin/catalog/sync-verified-sources` yalnız boş katalog alanlarını final kanıtlı URL'lerle doldurdu; insan düzeltmelerini ezmedi.
- [ ] Ders/sınav programı provision'ı yalnız exact-field final kanıtlı department kaynaklarını oluşturdu; kanıtsız legacy URL'leri `skipped` bıraktı.
- [ ] Trusted yapılacak her kaynak için son canlı kanıt insan tarafından incelendi.
- [ ] Canlı worker yalnız `active + trusted` kaynakları işliyor.
- [ ] Çekilen içerik `pending_review`; insan `approved` olmadan mobil akış/bildirim yok.
- [ ] Koşu, commit ve dağıtım değerleri yalnız göz ardı edilen `artifacts/university-source-discovery-208-20260911-v9-fresh/FINAL-REVIEW.md` dosyasına işlendi; commit-bağlı sürümlü belgeler koşu sonucu eklemek için değiştirilmedi.

## Sorun giderme

### Tarayıcı hazır değil

`browser-readiness.json` oluşmuyorsa Playwright tarayıcı kurulumu, çalıştırılabilir dosya ve işletim sistemi bağımlılıklarını düzeltin. Browser kontrolünü devre dışı bırakarak verified kayıt üretmeyin.

### Koşu çıktı vermeden uzun sürüyor

İlerleme stdout yerine `run.log` ve `checkpoint.json` üzerinden izlenebilir. Aynı anda test/build çalıştırmak Chromium kaynaklarını tüketebilir. Eşzamanlılığı yükseltmeden önce bellek ve disk baskısını kontrol edin.

### Manifest değişti

Girdi katalog/otorite dosyaları değiştiğinde araç manifest hash'ini yeniler ve uyumsuz hedefleri tekrar işlenebilir duruma getirir. Eski bir result dosyasını yeni manifest için doğrulanmış saymayın; report/checkpoint uzlaşmasını çalıştırın ve gereken hedefleri yeniden tarayın.

### Final revalidation başarısız

Önce `verification-manifest.jsonl` ve ilgili `state/universities/*.json` kaydını inceleyin. Başarısız final kontrolü kaydı artık `verified` olmadığı için aynı `revalidate` komutunu hemen yeniden çalıştırmak o adayı retry etmez. Geçici ağ sorunuysa etkilenen kurumu aynı output üzerinde `run --only=<university-id>` ile açıkça yeniden açın; aday kuyruğu tükenip sitemap taraması tamamlanana ve hedef tekrar terminal olana kadar `run` komutunu sürdürün. Bütün 208 hedef terminal olduktan sonra tam `revalidate` komutunu yeniden çalıştırın. Semantik, soft-404 veya authority hatasıysa URL'yi trusted yapmayın; registry güncellemesinin atlandığını `run.log` ve `runtime-update-audit.json` durumu üzerinden doğrulayın.

### Tam kapsama yeşil değil

`FULL_COVERAGE_GREEN` bütün kurumların gerçekten yayınladığı sayfalar bulunmadan true olmaz. `unresolved-and-not-found.jsonl` dosyasını kapsam/tür bazında inceleyin; kurumun resmî sitesinde sayfa yoksa `NOT_FOUND_VERIFIED` kaydını koruyun. Üçüncü taraf bir URL ile boşluğu kapatmayın.
