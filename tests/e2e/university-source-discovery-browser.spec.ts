import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { chromium, expect, test } from "@playwright/test";

test("real browser navigation clicks listings and downloads a document across two local origins", async () => {
  const primary = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end('<main><h1>Test Üniversitesi</h1><a id="announcements" href="/duyurular">Duyurular</a><a id="calendar">Akademik Takvim</a></main>');
      return;
    }
    if (request.url === "/duyurular") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end('<main><h1>Duyurular</h1><a href="/duyurular/kayit">Kayıt duyurusu</a><a href="/duyurular/sinav">Sınav duyurusu</a></main>');
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<main><h1>Duyuru Detayı</h1><p>${"Güncel öğrenci duyurusu içeriği. ".repeat(8)}</p></main>`);
  });
  const documents = createServer((request, response) => {
    if (request.url === "/calendar.pdf") {
      response.setHeader("content-type", "application/pdf");
      response.end(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048)]));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  const primaryPort = await listen(primary);
  const documentPort = await listen(documents);
  const executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, executablePath });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const homepage = `http://127.0.0.1:${primaryPort}/`;
    await page.goto(homepage);
    await page.locator("#calendar").evaluate((anchor, href) => anchor.setAttribute("href", String(href)), `http://127.0.0.1:${documentPort}/calendar.pdf`);
    await page.locator("#announcements").click();
    await expect(page.locator("h1")).toHaveText("Duyurular");
    const dom = await page.content();
    expect(dom).toContain("Kayıt duyurusu");
    await page.getByText("Kayıt duyurusu").click();
    await expect(page.locator("p")).toContainText("Güncel öğrenci duyurusu");

    const documentResponse = await context.request.get(`http://127.0.0.1:${documentPort}/calendar.pdf`);
    const documentBody = await documentResponse.body();
    expect(documentResponse.status()).toBe(200);
    expect(documentBody.subarray(0, 5).toString()).toBe("%PDF-");
    await context.close();
  } finally {
    await browser.close();
    await close(primary);
    await close(documents);
  }
});

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local test server did not expose a TCP port.");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}
