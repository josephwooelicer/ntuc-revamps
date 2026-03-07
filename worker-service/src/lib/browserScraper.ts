type BrowserScrapeResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  html: string;
};

export async function scrapePageWithBrowser(url: string): Promise<BrowserScrapeResult> {
  const timeoutMs = Number(process.env.CONNECTOR_BROWSER_TIMEOUT_MS || 45000);
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      process.env.CONNECTOR_BROWSER_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });

  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    const html = await page.content();
    const finalUrl = page.url();
    const status = response?.status() || 200;
    const headers = response ? await response.allHeaders() : {};
    return { finalUrl, status, headers, html };
  } finally {
    await context.close();
    await browser.close();
  }
}
