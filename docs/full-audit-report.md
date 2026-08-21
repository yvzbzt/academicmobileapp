# Akademik Takvim tam denetim raporu

Tarih: 2026-08-21

## Sonuc

Uygulama, yerel otomasyon ve Android emulasyon matrisinde ana kullanici akislari icin calisiyor. Denetim "tamamen basarili" olarak kapatilmadi; canliya alinmamis API guvenlik duzeltmeleri, native bagimlilik aciklari, Windows uzun-yol release sorunu ve gercek admin/Google/FCM/iOS dogrulama bosluklari asagida acikca listelendi.

## Test ortamlari

- Android API 24 x86_64 emulator, normal profil: 1080x2340, 420 dpi, font 1.0.
- Dar ekran matrisi: 320 dp ve font 2.0.
- Yatay telefon matrisi.
- Tablet matrisi: 1344x1920, 240 dpi.
- Release performans profili: 720x1280, 320 dpi, API 24, host GPU.
- Canli API: `https://academic-api.anssoft.com.tr`.
- Canli admin kabugu ve yerel/mock admin paneli.
- Fiziksel Android telefon ve iOS cihazi mevcut degildi; bunlar icin basari iddiasi yoktur.

## Tek tek denenen mobil akislari

- Uc onboarding sayfasi, atlama/ileri/baslayalim, sayfa gostergeleri ve guven mesaji.
- Giris: e-posta, sifre, sifreyi goster/gizle, hatali bilgiler, basarili giris, Google iptal yolu, sifremi unuttum ve kayit gecisi.
- Cikis sonrasi giris ekrani: temiz acilis, log/Metro kutusu yok, tasma yok, logcat fatal/ANR/Unhandled JS/Metro hatasi yok.
- Kayit: ad soyad, e-posta, sifre, sifre tekrar, KVKK onayi ve buton durumlari.
- Sifre bosken guc alani tamamen gizli; ilk karakterle aciliyor; temizlenince kapaniyor; zayif/orta/iyi/guclu durumlari ve kurallar test edildi.
- E-posta dogrulama, kod tekrar gonderme, sifre kurtarma API ve ekran durumlari.
- Oturum yenileme, refresh-token rotasyonu, eszamanli yenileme ve eski token reddi.
- Oturum suresi dolunca guvenli cikis ve kullaniciya kontrollu bildirim.
- Ana sayfa: sonraki etkinlik, haftalik gun seridi, haftalik dogrulanabilir ozet, duyuru ozeti, kategori filtreleri, kart gecisleri ve kisisel etkinlik ekleme.
- Duyurular: arama, kapsam/kaynak filtreleri, bos/hata/yukleme durumlari, detay ve kaydetme sozlesmeleri.
- Takvim: tarih gezintisi, akademik/kisisel kayit ayrimi, detay, kisisel sinav/etkinlik olusturma, duzenleme, iptal/silme ve alarm sozlesmeleri.
- Ayarlar: akademik bilgiler, takip edilen universiteler, bildirim tercihleri, Google Takvim baglanti durumlari, profil ve yikici islem onaylari.
- Hesap/veri silme icin parola ile yakin kimlik dogrulama, amaca bagli tek kullanimlik proof ve replay reddi otomasyonla test edildi. Canli gecici hesabin kalici silinmesi acik kullanici onayi olmadigi icin uygulanmadi.
- Alt navigasyonun dort sekmesi ve avatar tabanli hesap erisimi; hamburger menuler kaldirildi.

## Tasarim ve cihaz bulgulari

- Ana sayfadaki ust `Ana Sayfa` metni kaldirildi.
- `Merhaba, ...` altindaki aciklama kaldirildi ve baslik kucultuldu.
- Ust odak/slider alani sabit olculerle yeniden duzenlendi.
- Hamburger Duyurular, Takvim ve Ayarlar ekranlarindan kaldirildi.
- Tablet yan navigasyon rayi 128 px'e sabitlendi; sekmeler artik tum yukseklige yayilmiyor.
- 320 dp + font 2.0 icin duyuru basligi, arama alani, chip'ler, banner ve bos/hata durumlari kirpilmadan gorunuyor.
- Yatay ve tablet ekranlarda Home, Duyurular, Takvim ve Ayarlar icin tasma/ust uste binme bulunmadi.
- `Bugun` listesindeki yesil tarih basliklari basari veya katilim gostergesi degildir; kronolojik gun gruplamasidir. Eski genis kategori eslestirmesi bircok kaydi ayni yesile dusuruyordu. Kategoriler ayrildi: kayit turuncu, sinav mavi, basvuru/akademik ve kisisel turler ayri vurgular kullaniyor.

## Admin ve veri yayilimi

- 8 Playwright senaryosu gecti: auth/logout/session, rol yonlendirmesi, dokuz admin rotasi, CRUD, kaynak zamanlamasi, ders programi, PDF inceleme/yayin, bildirim, audit export, kullanici yonetimi, native validasyon ve 320-1440 px tasma.
- 2 canli VPS admin smoke senaryosu gecti: admin login kabugu ve mobil viewport.
- Yerel gercek entegrasyon testleri universite/fakulte/bolum, takvim/etkinlik/ders programi ve duyuru yayinlarinin mobil okuma modellerine gecisini dogruladi.
- Canli VPS'de admin yetkisi verilmedi. Bu nedenle production admin CRUD -> production mobil gorunurluk zinciri uctan uca denenmis sayilmadi.

## API ve siber guvenlik

- Endpoint katalogundaki 103/103 rota canliya karsi probelandi; auth, rol, bozuk girdi ve rate-limit matrisleri uygulandi.
- Login'de 10 basarisiz denemeden sonra 429 goruldu. Mevcut memory store/queue yapisi nedeniyle limit process bazlidir; coklu instance dagitiminda ortak store gerekir.
- Admin BOLA/kapsam yetkilendirmesi, DTO boyut sinirlari, refresh CAS, tek kullanimlik recent-auth ve guvenli kategori siniflandirma duzeltmeleri yerelde test edildi.
- Android release guvenlik sozlesmesi 5/5 gecti: cleartext, backup/extraction ve riskli izinler kapali; deep-link allowlist; release minify/shrink; debug/missing signing fail-closed.
- Kaynak secret taramasinda gercek private key/API key bulunmadi. Tek eslesme `.example.test` kullanan sahte Mongo test girdisiydi.
- Kok `npm audit --omit=dev`: 0 acik.
- Native `npm audit --omit=dev`: 17 transitif acik, 9 high ve 8 moderate. Zincir Expo/Metro/prebuild altinda; otomatik tam cozum Expo 57 kirici yukseltmesi istiyor.
- Native lock `postcss 8.4.49`, kurulu agac `8.5.26`; Metro `~8.4.32` bekledigi icin `npm ls` ELSPROBLEMS ile bitiyor. Temiz `npm ci` ve mevcut makine ayni agaci uretmiyor.

## Canliya alinmamis VPS farklari

- Canli `/health` dependency/job ayrintisi sizdiriyor; yerel kod yalniz sinirli durum dondurecek sekilde duzeltildi.
- Canli malformed logout body 500 veriyor; yerel kod 400 veriyor.
- Canli nested notification category 500 veriyor; yerel kod 400 veriyor.
- Canli bozuk `%` ICS token 500 veriyor; yerel kod 401 veriyor.
- Canli calendar-event alarm eslemesi eski davranista; yerel kod ve regresyon testi duzeltildi.
- Canli admin HSTS eksik; yerel Caddy ayari eklendi.
- Bu maddeler deploy edilmeden production duzelmis sayilmaz.

## Performans

- Canli API iki ornek: `/me` 175/199 ms; `/calendar/my` 294/222 ms ve 29 KB; upcoming 158/213 ms; announcements 148/129 ms; preferences 122/117 ms; alarms 118/149 ms. Tum cevaplar 200.
- Gercek non-debuggable release APK, Hermes + Fabric, tek x86_64 ABI, Metro bagimsiz ve 100 kayitli feed ile olculdu.
- Cold activity start: This/Total 1054 ms, Wait 1077 ms.
- 5 deneme x 120 kare = 600 kare.
- Aggregate p90: 20.829 ms (esik 32 ms).
- Aggregate p95: 21.471 ms (esik 50 ms).
- 700 ms ve uzeri donmus kare: 0 (esik 0).
- Release performans kabul sonucu: PASS.
- Normal uzun workspace yolundan Windows release build, Firebase Messaging generated C++ yolunun 260 karakteri asmasi nedeniyle FAIL. Olcum, stale autolinking temizlenmis fiziksel `C:\r` gecici kopyasinda tamamlandi. Windows release hatti kisa checkout veya Linux CI kullanmadan guvenilir degil.

## Otomasyon sonucu

- Native Jest: 37/37 suite, 324/324 test PASS.
- Kok Vitest (Mongo gerektiren 3 suite haric): 87 dosya, 1103/1103 test PASS.
- Mongo repository/concurrency icin 3 suite, `MONGODB_TEST_URI`/lokal Mongo olmadigi icin calistirilamadi.
- Admin Playwright mock: 8/8 PASS.
- VPS Playwright smoke: 2/2 PASS.
- Root ve native TypeScript typecheck: PASS.
- Admin production web build: 269.47 KB, gzip 77.77 KB, PASS.
- Mobile web build: 349.76 KB, gzip 104.37 KB, PASS.
- Expo dependency compatibility check: direct Expo bagimliliklari up to date.
- `git diff --check`: whitespace/conflict marker hatasi yok.

## Tasarim gorselinde olup tam dogrulanmayan/uygulanmayanlar

- Onboarding gorselindeki `%72 ilerleme`, urun karari geregi olcum ozelligi degildir ve uygulanmadi.
- Spinner icin 5 karelik storyboard asset/referans olarak var; tum 1.35-1.55 sn koreografinin release runtime animasyonu uctan uca olculmedi.
- Google girisi ve Google Takvim icin gercek production OAuth hesabi/anahtar kisitlariyla uctan uca test yapilmadi.
- FCM icin gercek uzak push teslimi ve OEM arka-plan davranisi test edilmedi.
- Login altindaki sosyal hedeflerin gercek production URL/analytics davranisi dogrulanmadi.
- Sifre kurtarma/dogrulama mailinin gercek SMTP inbox teslimi bu ortamda dogrulanmadi.
- Production admin CRUD -> production mobil zinciri admin credential olmadigi icin dogrulanmadi.
- Fiziksel Android, iPhone/iPad, TalkBack/VoiceOver ve gercek OEM klavye/inset farklari test edilmedi.

## Ekran kanitlari

- `artifacts/final-login-normal.png`
- `artifacts/current-home-320-font2.png`
- `artifacts/current-announcements-320-font2.png`
- `artifacts/matrix-home-landscape.png`
- `artifacts/matrix-announcements-landscape-final.png`
- `artifacts/matrix-calendar-landscape-final.png`
- `artifacts/matrix-settings-landscape-final.png`
- `artifacts/matrix-home-tablet-final3.png`
- `artifacts/matrix-announcements-tablet-final.png`
- `artifacts/matrix-calendar-tablet-final.png`
- `artifacts/matrix-settings-tablet-final.png`

## Kapanis onceligi

1. Yerel API/Caddy duzeltmelerini VPS'ye deploy edip ayni canli kotu-girdi matrisini yeniden calistir.
2. Native lock/node_modules farkini temiz `npm ci` ile kapat; Expo 57 gecisini ayri dalda test ederek 17 acigi gider.
3. Android release'i kisa checkout veya Linux CI'da AAB/APK olarak surekli uret; Play signing ve key restriction kontrollerini ekle.
4. Production admin credential ile gercek CRUD -> mobil gorunurluk testini calistir.
5. Mongo test veritabani, gercek Google/FCM hesaplari, fiziksel Android ve iOS cihaz matrisi ekle.
6. Acik onay verilirse denetim icin olusturulan gecici canli hesabi kalici sil ve yerel ignored kimlik dosyasini kaldir.
