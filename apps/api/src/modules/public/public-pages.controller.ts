import { Body, Controller, Get, Header, Inject, Post } from "@nestjs/common";
import { AccountDeletionConfirmDto, AccountDeletionRequestCodeDto } from "./account-deletion.dto.js";
import { AccountDeletionService } from "./account-deletion.service.js";

@Controller()
export class PublicPagesController {
  constructor(@Inject(AccountDeletionService) private readonly accountDeletionService: AccountDeletionService) {}

  @Get("account-deletion")
  @Header("Content-Type", "text/html; charset=utf-8")
  accountDeletion(): string {
    return accountDeletionHtml;
  }

  @Post("account-deletion/request-code")
  requestAccountDeletionCode(@Body() body: AccountDeletionRequestCodeDto) {
    return this.accountDeletionService.requestCode(body);
  }

  @Post("account-deletion/confirm")
  confirmAccountDeletion(@Body() body: AccountDeletionConfirmDto) {
    return this.accountDeletionService.confirm(body);
  }
}

export const accountDeletionHtml = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Akademik Takvim - Hesap ve Veri Silme</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #102033;
      background: #f5f7fb;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 28px 16px;
    }

    main {
      max-width: 880px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #dbe3ef;
      border-radius: 18px;
      padding: clamp(22px, 5vw, 36px);
      box-shadow: 0 18px 48px rgba(15, 23, 42, .08);
    }

    h1 {
      margin: 0 0 10px;
      font-size: clamp(30px, 5vw, 44px);
      line-height: 1.08;
    }

    h2 {
      margin: 32px 0 12px;
      font-size: 21px;
    }

    p,
    li {
      color: #475569;
      font-size: 16px;
      line-height: 1.7;
    }

    a {
      color: #2563eb;
      font-weight: 700;
    }

    ol,
    ul {
      padding-left: 22px;
    }

    .brand {
      display: inline-flex;
      margin-bottom: 18px;
      padding: 8px 12px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #075985;
      font-weight: 800;
    }

    .form-panel {
      margin: 26px 0 8px;
      padding: 18px;
      border: 1px solid #dbe3ef;
      border-radius: 14px;
      background: #f8fafc;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    label {
      display: grid;
      gap: 7px;
      color: #172033;
      font-weight: 700;
    }

    input,
    select {
      width: 100%;
      min-height: 46px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px 12px;
      color: #172033;
      font: inherit;
      background: #fff;
    }

    button {
      min-height: 46px;
      border: 0;
      border-radius: 10px;
      padding: 10px 18px;
      color: #fff;
      background: #2563eb;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: .65;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
      flex-wrap: wrap;
    }

    .note {
      border-left: 4px solid #2563eb;
      background: #eff6ff;
      border-radius: 12px;
      padding: 14px 16px;
    }

    .status {
      margin: 14px 0 0;
      padding: 12px 14px;
      border-radius: 10px;
      display: none;
      font-weight: 700;
    }

    .status.info {
      display: block;
      color: #075985;
      background: #e0f2fe;
    }

    .status.success {
      display: block;
      color: #166534;
      background: #dcfce7;
    }

    .status.error {
      display: block;
      color: #991b1b;
      background: #fee2e2;
    }

    .hidden {
      display: none;
    }

    footer {
      margin-top: 32px;
      color: #64748b;
      font-size: 14px;
    }

    @media (max-width: 680px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <span class="brand">Akademik Takvim</span>
    <h1>Hesap ve Veri Silme</h1>
    <p>Akademik Takvim hesab&#305;n&#305; ve hesab&#305;na ba&#287;l&#305; uygulama verilerini istedi&#287;in zaman silebilirsin.</p>

    <section class="form-panel" aria-labelledby="online-request-title">
      <h2 id="online-request-title">Online silme talebi</h2>
      <p>Uygulamaya eri&#351;emiyorsan e-posta adresin ve &#351;ifrenle do&#287;rulama kodu alabilir, ard&#305;ndan yaln&#305;zca verilerini veya hesab&#305;n&#305; silebilirsin.</p>

      <form id="request-form">
        <div class="grid">
          <label>
            E-posta adresi
            <input id="email" name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            &#350;ifre
            <input id="password" name="password" type="password" autocomplete="current-password" required>
          </label>
        </div>
        <div class="actions">
          <button id="request-button" type="submit">Do&#287;rulama Kodu G&#246;nder</button>
        </div>
      </form>

      <form id="confirm-form" class="hidden">
        <div class="grid">
          <label>
            E-postana gelen kod
            <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" required>
          </label>
          <label>
            Silme tercihi
            <select id="deletion-type" name="deletionType" required>
              <option value="data">Yaln&#305;zca uygulama verilerimi sil</option>
              <option value="account">Hesab&#305;m&#305; tamamen sil</option>
            </select>
          </label>
        </div>
        <div class="actions">
          <button id="confirm-button" type="submit">&#304;&#351;lemi Onayla</button>
        </div>
      </form>

      <p class="note">Google ile kay&#305;t olduysan ve &#351;ifren yoksa, hesab&#305;nda kay&#305;tl&#305; e-posta adresinden info@anssoft.com.tr adresine talep g&#246;nderebilirsin.</p>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </section>

    <h2>Uygulama i&#231;inden silme</h2>
    <ol>
      <li>Akademik Takvim mobil uygulamas&#305;n&#305; a&#231;.</li>
      <li>Profil sekmesine gir.</li>
      <li>&#214;nce yaln&#305;zca uygulama verilerini silmek istiyorsan &ldquo;Verilerimi Sil&rdquo; se&#231;ene&#287;ini kullan.</li>
      <li>Hesab&#305;n&#305; tamamen kapatmak istiyorsan &ldquo;Hesab&#305;m&#305; Sil&rdquo; se&#231;ene&#287;ini onayla.</li>
    </ol>

    <h2>Uygulamaya eri&#351;emiyorsan</h2>
    <p>Uygulamaya eri&#351;emiyorsan veya uygulamay&#305; cihaz&#305;ndan kald&#305;rd&#305;ysan, hesab&#305;nda kay&#305;tl&#305; e-posta adresinden <a href="mailto:info@anssoft.com.tr?subject=Akademik%20Takvim%20Hesap%20ve%20Veri%20Silme%20Talebi">info@anssoft.com.tr</a> adresine hesap ve veri silme talebi g&#246;nderebilirsin.</p>

    <p>E-postada &#351;u bilgileri belirtmen yeterlidir:</p>
    <ul>
      <li>Akademik Takvim hesab&#305;nda kulland&#305;&#287;&#305;n e-posta adresi</li>
      <li>Hesap silme veya yaln&#305;zca veri silme talebin</li>
      <li>Varsa se&#231;ili &#252;niversite, fak&#252;lte veya b&#246;l&#252;m bilgisi</li>
    </ul>

    <h2>Silinen veriler</h2>
    <p>Hesap silindi&#287;inde hesab&#305;na ba&#287;l&#305; kimlik bilgileri, okul se&#231;imi, fak&#252;lte/b&#246;l&#252;m/s&#305;n&#305;f tercihleri, bildirim tercihleri, cihaz bildirim kay&#305;tlar&#305;, ki&#351;isel alarm kay&#305;tlar&#305;, takvim ba&#287;lant&#305; kay&#305;tlar&#305; ve aktif oturumlar silinir veya anonim hale getirilir.</p>

    <p>Yaln&#305;zca uygulama verilerini silmeyi se&#231;ersen hesap kayd&#305;n korunabilir; ancak uygulama tercihlerin, okul/b&#246;l&#252;m se&#231;imlerin, bildirim tercihlerin, ki&#351;isel alarm kay&#305;tlar&#305;n ve cihaz bildirim kay&#305;tlar&#305;n silinir veya s&#305;f&#305;rlan&#305;r.</p>

    <h2>Sistemde kalabilecek veriler</h2>
    <p>&#220;niversitelerden al&#305;nan herkese a&#231;&#305;k akademik takvim, haber, etkinlik, duyuru ve ders program&#305; kay&#305;tlar&#305; kullan&#305;c&#305;ya &#246;zel veri olmad&#305;&#287;&#305; i&#231;in sistemde kalabilir.</p>

    <p>Yasal y&#252;k&#252;ml&#252;l&#252;k, g&#252;venlik, k&#246;t&#252;ye kullan&#305;m&#305;n &#246;nlenmesi veya teknik kay&#305;t b&#252;t&#252;nl&#252;&#287;&#252; i&#231;in saklanmas&#305; gereken s&#305;n&#305;rl&#305; kay&#305;tlar varsa, bu kay&#305;tlar yaln&#305;zca gerekli s&#252;re boyunca saklanabilir.</p>

    <h2>&#304;&#351;lem s&#252;resi</h2>
    <p>Silme talepleri m&#252;mk&#252;n olan en k&#305;sa s&#252;rede incelenir ve en ge&#231; 30 g&#252;n i&#231;inde tamamlan&#305;r. Talep tamamland&#305;&#287;&#305;nda, ba&#351;vuru yapt&#305;&#287;&#305;n e-posta adresine bilgilendirme g&#246;nderilebilir.</p>

    <h2>Hesap silme sonras&#305;</h2>
    <p>Silme i&#351;lemi tamamland&#305;&#287;&#305;nda ayn&#305; e-posta adresiyle tekrar yeni hesap olu&#351;turabilirsin.</p>

    <footer>Son g&#252;ncelleme: 24 Temmuz 2026</footer>
  </main>

  <script>
    const requestForm = document.getElementById("request-form");
    const confirmForm = document.getElementById("confirm-form");
    const statusBox = document.getElementById("status");
    const requestButton = document.getElementById("request-button");
    const confirmButton = document.getElementById("confirm-button");
    let pendingCredentials = null;

    function setStatus(type, message) {
      statusBox.className = "status " + type;
      statusBox.textContent = message;
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify(body)
      });
      await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(messageForStatus(response.status));
      }
    }

    function messageForStatus(status) {
      if (status === 401) return "Bilgileri veya dogrulama kodunu kontrol edip tekrar dene.";
      if (status === 429) return "Cok fazla deneme yapildi. Biraz bekleyip tekrar dene.";
      if (status === 503) return "Dogrulama e-postasi su anda gonderilemedi. Lutfen daha sonra tekrar dene.";
      return "Islem tamamlanamadi. Bilgileri kontrol edip tekrar dene.";
    }

    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      requestButton.disabled = true;
      setStatus("info", "Bilgiler kontrol ediliyor...");

      const email = document.getElementById("email").value.trim().toLowerCase();
      const password = document.getElementById("password").value;

      try {
        await postJson("/account-deletion/request-code", { email, password });
        pendingCredentials = { email, password };
        confirmForm.classList.remove("hidden");
        setStatus("success", "Dogrulama kodu e-posta adresine gonderildi. Kodu girip silme tercihini onaylayabilirsin.");
      } catch (error) {
        pendingCredentials = null;
        confirmForm.classList.add("hidden");
        setStatus("error", error instanceof Error ? error.message : "Islem tamamlanamadi. Bilgileri kontrol edip tekrar dene.");
      } finally {
        requestButton.disabled = false;
      }
    });

    confirmForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!pendingCredentials) {
        setStatus("error", "Once e-posta ve sifre ile dogrulama kodu almalisin.");
        return;
      }

      confirmButton.disabled = true;
      setStatus("info", "Silme talebin isleniyor...");

      try {
        const deletionType = document.getElementById("deletion-type").value;
        const code = document.getElementById("code").value.trim();
        await postJson("/account-deletion/confirm", { ...pendingCredentials, code, deletionType });
        document.getElementById("password").value = "";
        pendingCredentials = null;
        requestForm.reset();
        confirmForm.reset();
        confirmForm.classList.add("hidden");
        setStatus("success", deletionType === "account" ? "Hesabin silindi. Ayni e-posta adresiyle tekrar yeni hesap olusturabilirsin." : "Uygulama verilerin silindi. Hesabin aktif kalmaya devam eder.");
      } catch (error) {
        setStatus("error", error instanceof Error ? error.message : "Islem tamamlanamadi. Bilgileri kontrol edip tekrar dene.");
      } finally {
        confirmButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;
