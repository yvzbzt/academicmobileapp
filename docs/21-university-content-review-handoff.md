# Türkiye Üniversite İçeriği İnceleme Sistemi — Devir Belgesi

Bu belge, mobil uygulamanın içerik yönetimi için eklenen kaynak güveni, içerik inceleme, sınıflandırma ve LLM destekli kontrol akışını devralacak geliştirici ve içerik yöneticileri içindir. Buradaki panel **tenant yönetim paneli değildir**; mobil uygulamada gösterilecek üniversite içeriğinin yönetildiği paneldir.

## Nihai teslim özeti

> Commit kimliği kendi dosyasına yazılarak değiştirilemeyeceği için koşuya özgü nihai değerler, dağıtımdan sonra göz ardı edilen `artifacts/university-source-discovery-208-20260911-v9-fresh/FINAL-REVIEW.md` dosyasına yazılır. Bu belge kalıcı sözleşmeyi ve sabit kapsamı taşır.

| Alan | Nihai değer |
| --- | --- |
| Git branch | `agent/university-content-review-20260909` |
| Git commit ve uzak push | `FINAL-REVIEW.md`; GitHub branch ucu ile eşleştirilir |
| VPS'e dağıtılan commit | `FINAL-REVIEW.md` ve `/opt/anssoft-academicmobilapp-backend/deployed-commit.txt` |
| API/admin dağıtım zamanı | `FINAL-REVIEW.md` ve canlı dağıtım işaretçileri |
| Canlı keşif çıktı dizini | `artifacts/university-source-discovery-208-20260911-v9-fresh` |
| Üniversite kapsamı | 208 hedef; terminal sonuç `summary.json` ve `FINAL-REVIEW.md` içinde |
| Akademik birim kapsamı | 17.360 hedef; sonuç `academic-unit-source-coverage.jsonl` içinde |
| Doğrulanmış ve son kontrolden geçmiş URL | `summary.json` ile `verified-sources.jsonl` |
| Çözülemeyen kayıt | `unresolved-and-not-found.jsonl` ve `FINAL-REVIEW.md` |
| Üretim provision/trust sayıları | Secretsiz aggregate değerler yalnız `FINAL-REVIEW.md` içinde |
| Test ve API/admin smoke sonucu | Tam komut ve sonuçlar `FINAL-REVIEW.md` içinde |

Canlı adresler:

- API: `https://academic-api.anssoft.com.tr`
- Mobil içerik admini: `https://academic-api.anssoft.com.tr/admin/`

## Mimari ve yayın sınırı

```text
YÖK tabanlı katalog + doğrulanmış alan adı otoriteleri
                         │
                         ▼
Tarayıcıyla keşif ve kanıt üretimi ──► doğrulanmış kayıt JSON/JSONL dosyaları
                         │
                         ▼
Kaynak adayı (inactive + quarantined)
                         │ insan kaynak onayı
                         ▼
Aktif + trusted kaynak ──► içerik worker'ı ──► ayrıştırma/temizleme
                                                 │
                                                 ▼
                                    deterministik sınıflandırma
                                                 │
                                                 ▼
                                      pending_review içerik
                                                 │
                              isteğe bağlı LLM önerisi
                                                 │
                                      insan düzeltmesi/onayı
                                                 ▼
                         yalnız trusted kaynak + approved içerik
                                  mobil akış / kayıt / bildirim
```

Temel güvenlik ve doğruluk kuralı iki ayrı kapıdır:

1. Kaynak, doğru üniversite veya akademik birime ait resmî otorite sınırından geçip bir insan tarafından `trusted` yapılmalıdır.
2. Bu kaynaktan çekilen her içerik ayrıca bir insan tarafından `approved` yapılmalıdır.

LLM hiçbir aşamada kaynağı güvenilir yapmaz, içeriği otomatik yayımlamaz veya insan onayının yerine geçmez. Kaynak `active + trusted` değilse worker alım yapmaz. İçerik `reviewStatus=approved` değilse öğrenci akışında, kaydedilen duyuru işlevinde ve bildirim üretiminde görünmez.

## Veri kaynakları ve sorumlulukları

| Dosya/bileşen | Sorumluluk |
| --- | --- |
| `apps/api/src/bootstrap/turkiye-catalog-seed.json` | Üniversite, fakülte/yüksekokul ve bölüm/program kataloğu |
| `apps/api/src/bootstrap/verified-source-authorities.json` | Her üniversite için doğrulanmış veya karantinadaki alan adı otoritesi |
| `apps/api/src/bootstrap/verified-university-sources.json` | Üniversite düzeyi site, duyuru, haber, etkinlik ve takvim URL'leri |
| `apps/api/src/bootstrap/verified-academic-unit-sources.json` | Fakülte ve bölüm düzeyi site/içerik/program URL'leri |
| `scripts/university-source-discovery/` | Tüm hedefleri checkpoint ile tarayan, kanıtlayan ve raporlayan keşif aracı |
| `announcement_sources` | Çalışma zamanı kaynak kaydı, güven kararı, sağlık ve aktif snapshot işaretçisi |
| `announcement_snapshots` | Bir kaynağın atomik içerik snapshot'ları |
| `announcement_items` | Legacy içerik deposu ve eski kaynaklar için geriye uyumluluk |
| `content_llm_settings` | Şifreli LLM anahtarı ve güvenli ayar görünümü |
| `academic_unit_schedule_sources` | Final kanıtlı bölüm ders/sınav programı kaynakları, fetch provenance ve insan inceleme adayları |

Kontrollü katalog tabanı 208 kurumu temsil eder. Katalog ve otorite sayılarının canlı tarama sonunda tekrar doğrulanması gerekir; tarama sonucu için `summary.json` ve `FINAL-REVIEW.md` esas alınmalıdır. Bulunamayan bir fakülte, bölüm, program veya kaynak URL'si tahmin edilmez; `NEEDS_REVIEW`, `NOT_FOUND_VERIFIED` ya da `BLOCKED_FINAL` olarak görünür.

## Mobil içerik admini iş akışı

### 1. Kaynak adaylarını oluşturma

Super admin, **Duyuru Kaynakları** ekranındaki **Resmî Kayıt Kaynaklarını Kuyruğa Al** işlemini kullanır. Bu işlem `POST /admin/announcements/sources/provision-registry` çağrısıdır ve idempotenttir.

Registry girdileri doğrudan trusted yapılmaz. Yeni adaylar güvenli varsayılanla:

- `status=inactive`
- `trustStatus=quarantined`

olarak oluşturulur. API başlangıcı, normal okuma yolu veya worker bu provision işlemini kendiliğinden çağırmaz.

Panelin üstündeki kapsam görünümü, deploy ile paketlenen katalog ve registry üzerinden 208 üniversite, 17.360 akademik birim ve 115.656 içerik/takvim/program kaynak yuvasını sunucu tarafında filtreler. Her akademik birim için üniversite geneli kanıtından devralınan ayrı bir akademik-takvim yuvası bulunur. `missing`, `quarantined`, `legacy_unverified` ve `verified` durumları birbirinden ayrıdır. Kaynak listesi de ad/URL/kapsam araması, güven durumu, içerik türü ve kapsam türüyle sunucuda filtrelenir; her sayfa 100 kayıt gösterir.

### 2. Kaynak kanıtını inceleme

Kaynak kartında en az şu alanlar kontrol edilmelidir:

- kapsam türü ve kapsam ID'si;
- kaynak türü: duyuru, haber veya etkinlik;
- istenen URL, canonical/son URL ve resmî alan adı;
- keşif yöntemi, HTTP sonucu, semantic gerekçeler, liste öğesi sayısı;
- varsa örnek içerik bağlantıları ve son kontrol zamanı;
- karantina ya da ret gerekçe kodları.

**Güvenilir Olarak Onayla** işlemi otorite kontrolünü sunucuda yeniden yapar. Kontrol geçerse kaynak `active + trusted` olur ve ilk alım çalışır. Kontrol geçmezse kayıt karantinada kalır ve API doğrulama gerekçesiyle işlemi reddeder. **Kaynağı Reddet** kaynağı `inactive + rejected` yapar ve o kaynağın bildirim işlerini emekliye ayırır.

Kaynak URL'si, parser'ı veya içerik türü değiştirilirse mevcut güven kararı korunmaz; kaynak yeniden karantinaya düşer. Bu davranış, güvenilmiş bir tanımın sonradan başka bir hedefe çevrilmesini engeller.

### 3. İçerik ve sınıflandırma inceleme

**İçerik ve Sınıflandırma İncelemesi** ekranı sunucu tarafında durum ve içerik türüne göre sayfalanır. Başlık/kaynak araması yüklü sayfa üzerinde yardımcı filtredir. Kart açıldığında yönetici:

- resmî içerik bağlantısını açabilir;
- çekilen başlık, özet ve gövdeyi düzeltebilir;
- öğrenci ilgisi, konu grubu, hedef kitle, eylem, son tarih ve aciliyeti düzenleyebilir;
- kaydı `pending_review`, `approved` veya `rejected` yapabilir;
- varsa LLM önerisinin modelini, güven puanını ve gerekçesini görebilir.

Deterministik sınıflandırma `student-relevance-rules-v2` ile LLM'den önce çalışır. Personel alımı, ihale ve kurum içi işlemler gibi öğrenci dışı içerikleri ayırır; kayıt, sınav, burs, staj, değişim, akademik takvim ve benzeri grupları kanıt aralıklarıyla işaretler. Kurallar URL güvenini veya yayın kararını değiştirmez.

İnsan tarafından değiştirilen alanlar `humanOverride` olarak saklanır. Kaynak aynı içeriği tekrar getirirse maddi içerik değişmemiş olduğu sürece insan düzeltmeleri ve inceleme kararı taşınır. Maddi içerik değişirse içerik tekrar `pending_review` olur.

### 4. CAS ile eski ekran yazmasını engelleme

Her içerik güncellemesi ve tekil LLM incelemesi şu üç beklenen değeri gönderir:

- `expectedSnapshotId` — aktif snapshot kimliği; yalnız legacy kayıtta bulunmayabilir;
- `expectedContentFingerprint` — içeriğin 64 karakterlik SHA-256 parmak izi;
- `expectedReviewRevision` — son insan/LLM yazısında dönen opak revizyon; eski kayıtta bulunmayabilir.

Sunucu yazmadan önce üçünü karşılaştırır. LLM çağrısından sonra da aynı sınır repository güncellemesinde tekrar uygulanır. Başka bir yönetici veya yeni ingestion snapshot'ı kaydı değiştirdiyse API `409 Conflict` döndürür. Panelde doğru işlem, kuyruğu yenileyip güncel kaydı tekrar incelemektir; eski değerlerle zorla yazma yapılmamalıdır.

Snapshot tabanlı kaynaklarda inceleme yazısı yeni bir snapshot oluşturup kaynak işaretçisini atomik olarak taşır. Legacy fallback yalnız `activeSnapshotId` bulunmayan eski kaynaklarda kullanılır. Global inceleme kuyruğu bütün kaynak listesini önce belleğe yüklemeden repository üzerinden sayfalanır.

### 5. LLM API ayarları

LLM ayarları ve çalıştırma işlemleri yalnız `super_admin` rolüne açıktır. Panelden:

1. Sağlayıcı olarak yalnız `openai` seçilir.
2. Model adı girilir; varsayılan `gpt-5-mini`dir.
3. API anahtarı parola alanına girilip kaydedilir.
4. **Bağlantıyı Test Et** ile doğrulanır.
5. Ardından LLM incelemesi etkinleştirilir ve tekil ya da en fazla 50 kayıtlık bekleyen kuyruk çalıştırılır.

API anahtarı için güvenlik sözleşmesi:

- anahtar tarayıcıda veya oturum depolamasında tutulmaz;
- sunucu anahtarı mevcut veri koruma sistemiyle amaç bağlı şifreleyerek MongoDB'de saklar;
- GET cevabı anahtarı hiçbir zaman döndürmez, yalnız `apiKeyConfigured` ve son dört karakteri döndürür;
- silme işlemi anahtarı kaldırır ve LLM incelemesini kapatır;
- audit kaydı yalnız ayar/rotasyon/test bilgisi taşır, anahtarı taşımaz;
- çağrı sabit OpenAI Responses API hedefine yalnız `POST` ile gider, redirect kabul etmez;
- DNS çözümü ve IP hedefi doğrulanır; özel, loopback ve link-local hedefler reddedilir;
- istek 128 KiB, cevap 1 MiB ile sınırlandırılır; varsayılan zaman aşımı 20 saniyedir;
- `store=false` ve strict JSON Schema kullanılır;
- modelin Responses çıktısındaki açık `refusal` kararı, sağlayıcı metni veya cevap gövdesi ifşa edilmeden sabit mesajlı `422 Unprocessable Entity` olarak döner;
- sağlayıcıya erişim/ağ/zaman aşımı, başarılı olmayan HTTP cevabı, JSON parse, eksik çıktı veya geçersiz structured output hataları; cevap gövdesi, header ve anahtar loga/API cevabına sızdırılmadan sabit mesajlı `503 Service Unavailable` olarak döner;
- model çıktısındaki enum, güven aralığı ve gerçek takvim tarihi sunucuda tekrar doğrulanır.

LLM sonucu yalnız `llmClassification` önerisidir. `reviewStatus` tekrar `pending_review` olur; yönetici öneriyi gözden geçirip nihai alanları ve kararı kaydeder.

## Yerel geliştirme ve review yardımcıları

Ponytail ve Context7 yalnız geliştirici iş istasyonunda kullanılan review araçlarıdır. Uygulamanın, crawler'ın, API'nin veya VPS dağıtımının çalışma zamanı bağımlılığı değildir; `package.json`, container image veya üretim ortamına eklenmemelidir.

Kaynak ve sürüm dayanağı:

- Ponytail, [resmî upstream repository](https://github.com/DietrichGebert/ponytail) üzerinden Codex plugin marketplace olarak kurulur. Teslim doğrulamasında [plugin manifestindeki](https://github.com/DietrichGebert/ponytail/blob/main/plugin.yaml) `4.9.0` sürümü `installed, enabled` görüldü.
- Context7, [resmî Upstash repository](https://github.com/upstash/context7) paket adıyla ve güvenlik güncellemelerini izleyen `@latest` etiketiyle yerel MCP sunucusu olarak kurulur; 10 Eylül 2026 doğrulamasında bu etiket `4.0.7` sürümünü çözdü. Codex MCP yönetiminin genel sözleşmesi [resmî OpenAI dokümantasyonundadır](https://developers.openai.com/codex/extend/mcp).

İlk kurulum komutları:

```powershell
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
codex mcp add context7 -- npx -y @upstash/context7-mcp@latest
```

Aynı adla kurulum zaten varsa yeniden eklemeyin. Salt okunur doğrulama:

```powershell
codex plugin list | Select-String "ponytail@ponytail"
codex mcp get context7
```

Beklenen minimum sonuç Ponytail için `installed, enabled` ve `4.9.0`; Context7 için `enabled: true`, `command: npx`, `args: -y @upstash/context7-mcp@latest` ve bu teslimde çözülen `4.0.7` paketidir. Ponytail kurulunca yeni Codex oturumunda `/hooks` ekranından iki lifecycle hook'u inceleyip yalnız kaynak/hedef beklenen değerlerle eşleşiyorsa güvenin; Codex masaüstü uygulamasını yeniden başlatıp yeni bir thread açın.

Kullanım sınırı:

- Kod değişikliği sonunda `@ponytail-review` ile mevcut diff'in gereksiz karmaşıklık, tekrar ve daha küçük güvenli çözüm açısından salt okunur incelenmesi istenir. Öneri otomatik kabul edilmez; güvenlik, doğrulama, hata yönetimi ve erişilebilirlik korunur.
- Context7 yalnız kullanılan kütüphane veya framework'ün güncel resmî API dokümanını doğrulamak için çağrılır. Dönen metin proje sözleşmesi, test veya kaynak otoritesi kanıtının yerine geçmez.
- SSH özel anahtarı, LLM/API anahtarı, token, `.env` içeriği, kullanıcı verisi veya üretim cevabı bu araçların prompt'una ya da review çıktısına konmaz. Opsiyonel Context7 anahtarı gerekirse repository/komut satırı yerine işletim sisteminin gizli değişken yönetiminde tutulur; değeri doğrulama çıktısına kopyalanmaz.
- Review kaydında yalnız araç adı, doğrulanan sürüm/durum, incelenen commit ve secretsiz bulgu özeti tutulur.

## Yetki ve API özeti

| İşlem | Roller | Uç |
| --- | --- | --- |
| Kaynak listele/oluştur/düzenle/pasife al | `content_editor`, `university_admin`, `super_admin` | `/admin/announcements/sources*` |
| Registry adaylarını oluştur | `super_admin` | `POST /admin/announcements/sources/provision-registry` |
| Katalogdaki final kanıtlı URL'leri yalnız boş alanlara eşitle | `super_admin` | `POST /admin/catalog/sync-verified-sources` |
| Eksik/karantina/final kanıt kapsamını listele | içerik rolleri; üniversite admini yalnız kendi kapsamı | `GET /admin/source-coverage` |
| Kaynak onayla/reddet | içerik rolleri; üniversite admini yalnız kendi kapsamı | `POST .../sources/:id/approve` veya `/reject` |
| İnceleme kuyruğunu oku/düzelt | içerik rolleri; kapsam yetkisi uygulanır | `GET/PATCH /admin/announcements/review-items*` |
| Tekil/senkron LLM incelemesi | `super_admin` | `POST /admin/announcements/review-items/:id/llm-review`, tek öğeyle sınırlı uyumluluk ucu `POST /admin/announcements/review-items/llm-review` |
| LLM ayarı/testi/anahtar silme | `super_admin` | `/admin/announcements/llm-settings*` |
| Ders/sınav programı kaynaklarını listele; aday satırları düzelt ve insan kararını ver | içerik rolleri; üniversite admini yalnız kendi kapsamı | `GET /admin/calendars/schedule-sources`, `PATCH .../:id/candidates/:rowNumber`, `POST .../:id/review` |
| Final kanıtlı ders/sınav programlarını provision et ve alımı çalıştır | `super_admin` | `POST /admin/calendars/schedule-sources/provision-registry`, `POST .../:id/ingest` |
| Program incelemesini yeniden aç veya sahnelenen programı yayınla | `super_admin` | `POST .../:id/reopen-review`, `POST .../:id/publish` |
| Öğrenci güvenilir akışı | `student` | `/announcements/my/trusted*` |

Akademik takvim ve program kaynakları keşif raporunda ayrı haritalanır. Takvim yayınlama akışı `/admin/calendars*`, PDF çıkarım incelemesi `/admin/pdf-sources*` ve `/admin/extracted-events*` üzerinden yürür. Bölüm ders/sınav programı alımı yalnız final `verificationByField` kanıtlı registry URL'lerinden provision edilir; PDF/XLSX/HTML sonucu önce `review_required` olur, görsel/OCR ihtiyacı ve sıfır satır da dürüst bir inceleme sonucu üretir. İnsan onayı seçilen satırları `materializing` üzerinden `staged` durumuna getirir; bu onay tek başına öğrenci yayını değildir. Bağlı standart takvim önce normal `super_admin` takvim yayın eylemiyle yayınlanmış olmalıdır; ardından yalnız `super_admin` sahnelenen programı ayrıca yayınlayabilir. Yalnız `materializing` veya `staged` durumundaki inceleme `super_admin` tarafından yeniden açılabilir; bu işlem sahnelenen review event'lerini arşivleyip kaynağı `review_required` durumuna döndürür. Yayınlanmış program incelemesi immutable'dır ve yeniden açılamaz. Otomatik takvim alımı üretim compose dosyasında varsayılan olarak kapalıdır; insan kontrollü takvim yayın süreci atlanmamalıdır.

Admin panelindeki toplu LLM düğmesi tek öğeyle sınırlı senkron uyumluluk ucunu en fazla 20 kez çağırır. Her çağrı sunucuda `requiresLlmReview` filtresiyle yeni bir uygun kayıt ve güncel CAS görüntüsü seçer; uzun kuyruklar tek HTTP yanıt süresine bağlanmaz.

## Dağıtım devir listesi

### Dağıtımdan önce

- Uzak branch'leri tekrar fetch edin ve dağıtılacak commit'in en güncel hedef branch ile ilişkisini doğrulayın.
- Çalışma ağacında kullanıcıya ait ilgisiz değişiklik veya stash varsa koruyun; zorlayıcı reset kullanmayın.
- `git diff --check` ve sır taraması yapın. SSH anahtarı, API anahtarı, token, `.env` değeri veya MongoDB kimlik bilgisi commit'e girmemelidir.
- Aşağıdaki doğrulama kapılarını çalıştırın ve sonuçlarını nihai özet alanına yazın.
- Admin build'ini `/admin/` tabanıyla yerel doğrulama için en son çalıştırın. Dağıtılacak admin bundle'ını ise commit oluşturulduktan sonra aşağıdaki commit-bağlı paketleyiciyle yeniden üretin.

Önerilen yerel kapılar:

```powershell
npm.cmd run typecheck
npm.cmd run typecheck:discovery
npm.cmd run test:discovery
npm.cmd test -- --configLoader runner --testTimeout=15000
npm.cmd run typecheck:mobile:native
npm.cmd run test:mobile:native
npm.cmd run build:mobile
npm.cmd run build:admin -- --base=/admin/
```

### API ve worker dağıtımı

1. İmmutable release commit'ini oluşturup push edin.
2. Başarıyla tamamlanmış v8 discovery çıktısını zorunlu üçüncü argüman olarak verip `scripts/package-vps-audit-release.sh <commit> .release-evidence/vps <discovery-output>` çalıştırın. Paketleme; tam 208/17.360 kimlik ve final revalidation kapıları geçmemişse, registry çiftinin işlem kaydı/hash'leri uyuşmuyorsa, registry kanıtı boşsa veya kanıt release commit'iyle eşleşmiyorsa fail-closed durur.
3. Yalnız bu release dosyalarını VPS'te `/opt/anssoft-academicmobilapp-backend/releases/<commit>/` altına aktarın.
4. VPS'te önce `source.archive.sha256` dosyasını doğrulayın. Doğrulanan arşivdeki `source/deploy/hetzner/deploy-audit-remediation.sh` girdisini `tar --to-stdout` ile `mktemp` tarafından oluşturulan, yalnız root'un okuyabildiği geçici bir dosyaya çıkarıp `bash <geçici-dosya> <commit>` olarak çalıştırın; daha eski canlı source kopyasındaki launcher'ı kullanmayın. Geçici dosyayı `trap` ile silin.
5. Script'in canary, API health, worker çalışma durumu, kritik log, Caddy doğrulama ve rollback kontrollerinin tamamlandığını doğrulayın.

Dağıtım script'i MongoDB ile paylaşılan Caddy container kimliğini, başlangıç zamanını, restart sayısını ve sağlığını kaydeder; marker yayınlanana kadar değişmediklerini doğrular. Çalışan MongoDB image ID'si release Compose dosyasındaki digest-pinned image ID'siyle birebir eşleşmezse deployment veri tabanını sessizce yükseltmez ve fail-closed durur. API ve `anssoft-content-worker` yeniden oluşturulur. Her iki runtime'ın image ID'sine ek olarak OCI revision etiketi ve `APP_RELEASE_COMMIT` değeri immutable release commit'iyle eşleşmelidir; hem kapalı worker canary'si hem canlı worker, varsayılan 300 saniye olan ve `CONTENT_WORKER_READY_TIMEOUT_SECONDS` ile 30–900 saniye arasında ayarlanabilen pencere içinde application context tamamlandıktan sonra yazılan `CONTENT_INGESTION_WORKER_READY` kanıtından geçer. Bu bekleme boyunca durum, image ve kritik loglar sürekli denetlenir. Caddy route değişiminden sonra rollback sınırından önce admin HTML kabuğu, hash'li asset ve SPA'ya düşmeyen JSON `401` admin API yanıtı da doğrulanır. Bütün log kapıları `CONTENT_INGESTION_ANNOUNCEMENT_CYCLE_FAILED`, `CONTENT_INGESTION_CALENDAR_CYCLE_FAILED` ve `CONTENT_INGESTION_CALENDAR_NOTIFICATION_RECONCILIATION_FAILED` olaylarını da kritik sayar. Checksum-doğrulanmış release kaynak ağacı aynı dosya sistemi içinde ikinci bir tam kanıt kopyası oluşturmadan atomik olarak canlı `source` yoluna taşınır; bu taşımanın iki adımı arasındaki hata da önceki ağacı backup'tan geri yükler. Forward-only sınır geçilmeden hemen önce mevcut yazma yetkili worker'ın container ID, image ID, durum, başlangıç zamanı, restart sayısı ve restart policy parmak izi tekrar doğrulanır. Sınır geçildiğinde aynı container ID, 30 saniyelik üst sınırla durdurulur; migration'lardan önce ve yeni API aktivasyonundan önce aynı container'ın `exited` kaldığı, yeniden başlamadığı kanıtlanır. Bu stop işlemi dahil sınırdan sonraki her hata, veri yazımlarını geri alınmış saymadan açıkça forward repair gerektirir; rollback eski worker'ı yeniden başlatmaz. `ANNOUNCEMENT_AUTO_INGEST_ENABLED` worker'da bu release için zorunlu açık ve canlı container'da doğrulanır, API container'ında kapalıdır; `CALENDAR_AUTO_INGEST_ENABLED` varsayılan kapalıdır.

Forward-only sınırda hem eski API/auth-device yazarı hem content worker exact fingerprint ile durdurulur ve migration boyunca aynı, yeniden başlatılmamış container olarak kaldıkları kanıtlanır. Migration seti, announcement source/snapshot ve akademik program indexlerinin yanında aktif legacy oturumları atomik refresh-token-family durumuna taşıyan backfill'i de içerir. Backfill başarı kanıtı alınmadan yeni API etkinleştirilmez.

### Admin dağıtımı ve üretim provision

1. Commit ve ilgili admin build girdileri eşleşirken `bash scripts/package-vps-admin-release.sh <commit> .release-evidence/admin` çalıştırın. Paketleyici global çalışma ağacının temiz olmasını istemez; yalnız admin build girdilerinin ve `HEAD` değerinin istenen commit'le eşleşmesini zorunlu tutar, üretim API origin'ini sabitler ve `release.commit` ile eksiksiz `admin.bundle.sha256` üretir.
2. `.release-evidence/admin/<commit>/` içeriğini VPS'te yalnız bu release için hazırlanmış `/opt/anssoft-admin/staging` yoluna aktarın. Yerel `MANIFEST_SHA256` değerini aktarım kanalından bağımsız kaydedip VPS'teki `admin.bundle.sha256` hash'iyle karşılaştırın.
3. API deploy marker'ı aynı commit'i gösterdikten sonra, API deploy'un kurduğu commit-bağlı kaynak ağacından `bash /opt/anssoft-academicmobilapp-backend/source/deploy/hetzner/admin/activate-admin.sh` çalıştırın; VPS'te başka konuma kopyalanmış eski bir launcher kullanmayın. Aktivasyon bütün staged dosyaları manifestle doğrular, API/admin commit eşitliğini fail-closed uygular, swap'ın iki `mv` adımı arasındaki hata ile `INT`/`TERM` sinyallerinde önceki live/route durumunu geri yükler ve rollback sağlık doğrulaması başarısızsa ayrı hata koduyla durur. Canlı admin ve route smoke kontrollerinden sonraki marker yayını forward-only sınırdır; marker yazma hatası rollback değil forward repair gerektirir.
4. Aynı commit-bağlı kaynak ağacından `bash /opt/anssoft-academicmobilapp-backend/source/deploy/hetzner/admin/verify-admin.sh` çalıştırın; canlı bundle manifesti ile API/admin commit marker'larının eşitliğini de doğrulayın.
5. VPS hostunda commit-bağlı kaynak ağacından `bash /opt/anssoft-academicmobilapp-backend/source/deploy/hetzner/provision-announcement-source-registry.sh` çalıştırın. Wrapper canlı API kimliğini doğruladıktan sonra tek-seferlik compiled işlemi sağlıklı release container'ı içinde çalıştırır. İşlem release'e bağlı, pozitif sayıda bundled kanıtı Mongo bağlantısından önce doğrular; katalog, announcement ve schedule registry işlemlerini iki kez çalıştırarak idempotency'yi kanıtlar ve yalnız toplu sayıları yazdırır.
6. Karantinadaki kaynakları otomatik olarak topluca trusted yapmayın. Her trusted kararı son canlı URL, kapsam ve kanıt eşleşmesine dayanmalıdır.

### Dağıtımdan sonra zorunlu kontroller

- `/health/live` ve `/health/ready` başarılı;
- `/admin` isteği `/admin/` adresine 308 yönleniyor;
- admin HTML ve hash'li asset'ler açılıyor, CSP/nosniff/frame korumaları mevcut;
- `/universities` beklenen katalog kapsamını döndürüyor;
- kimlik doğrulamasız admin çağrısı 401;
- `anssoft-backend`, `anssoft-content-worker`, `anssoft-mongodb`, `anssoft-academic-admin` ve paylaşılan Caddy beklenen durumda;
- MongoDB ve Caddy container kimliği/başlangıç zamanı dağıtım tarafından istenmeden değişmemiş;
- API ve worker'ın son loglarında `uncaught`, `unhandled`, `fatal`, `ENVIRONMENT_INVALID` veya üç `CONTENT_INGESTION_*_FAILED` olayından biri yok;
- `/opt/anssoft-academicmobilapp-backend/deployed-commit.txt` dağıtılan commit ile aynı;
- `/opt/anssoft-admin/deployed-commit.txt`, canlı admin `release.commit` ve API deploy marker'ı aynı; canlı `admin.bundle.sha256` doğrulaması başarılı;
- provision tekrar çalıştırıldığında duplicate üretmiyor;
- bir karantina kaynağı öğrenci akışına girmiyor;
- bir trusted kaynaktan gelen `pending_review` kayıt öğrenci akışına veya bildirime girmiyor;
- insan onaylı kayıt görünür oluyor, reddedildiğinde veya kaynağı pasife alındığında ilgili bildirim işi emekliye ayrılıyor;
- gerçek bir LLM anahtarı girilmeden canlı LLM başarısı iddia edilmiyor.

## Review edilmesi gereken başlıca dosyalar

- Admin UI: `apps/admin/src/main.tsx`, `apps/admin/src/styles.css`
- İnceleme ve LLM: `apps/api/src/modules/announcements/announcement-review.service.ts`, `content-llm-settings.service.ts`
- Kaynak/ingestion/persistence: `announcement-ingestion.service.ts`, `announcement-persistence.ts`, `mongo-announcement.repository.ts`
- Eksik kaynak read-model'i: `apps/api/src/modules/source-discovery/verified-source-coverage.service.ts`, `admin-verified-source-coverage.controller.ts`
- Bölüm ders/sınav programı alımı: `apps/api/src/modules/calendars/academic-unit-schedule-ingestion.service.ts`, `mongo-academic-unit-schedule.repository.ts`
- Güvenli dış istek: `apps/api/src/common/network/safe-outbound-request.ts`
- Yetki ve DTO sözleşmesi: `announcements.controller.ts`, `announcements.dto.ts`, `apps/api/src/contracts/endpoint-catalog.ts`
- Katalog ve otorite: `apps/api/src/bootstrap/turkiye-catalog-seed.json`, `verified-source-authorities.json`, `verified-university-sources.json`, `verified-academic-unit-sources.json`
- Keşif: `scripts/university-source-discovery/core.ts`, `run.ts`
- VPS: `deploy/hetzner/compose.yaml`, `deploy-audit-remediation.sh`, `deploy/hetzner/admin/activate-admin.sh`
- Testler: `apps/api/tests/announcement-review.test.ts`, `safe-outbound-request.test.ts`, `tests/unit/university-source-discovery.test.ts`

## Nihai insan review kararı

Teslimi kapatmadan önce `FINAL-REVIEW.md` içinde aşağıdaki secretsiz değerler kaydedilmelidir:

- `CRAWL_COMPLETE`, `VERIFIED_DATA_GREEN` ve `FULL_COVERAGE_GREEN` kalite kapıları;
- final canlı kontrolün `passed` ve `failed` sayıları;
- `unresolved-and-not-found.jsonl` yolu ve açık kayıt sayısı;
- insan tarafından trusted/quarantined/rejected yapılan kaynakların aggregate sayıları;
- LLM anahtarının yalnız yapılandırılmış/yapılandırılmamış durumu; anahtarın kendisi veya son dört karakteri değil;
- review eden aktör, tarih, test komutları, GitHub push ve canlı smoke sonuçları.

`FULL_COVERAGE_GREEN=false` olması doğrulanmış veriyi geçersiz kılmaz; yalnız tüm üniversite, akademik takvim ve bölüm ders/sınav programlarının eksiksiz bulunamadığını gösterir. Çözülemeyen kayıtlar sessizce düşürülmemeli veya uydurma URL ile kapatılmamalıdır.
