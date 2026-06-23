/**
 * Small, polite, same-domain crawler: breadth-first, depth-limited, page-capped,
 * with a delay between requests. JS-rendered SPAs (the JFrog help center) won't
 * fully render here — prefer an explicit URL list or a headless browser for those.
 */
import * as cheerio from "cheerio";

const USER_AGENT = "JFrog-Knowledge-Assistant/1.0 (+demo crawler)";
const SKIP_EXT = [
  ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".js",
  ".ico", ".woff", ".woff2", ".mp4", ".webp", ".xml", ".json",
];

export interface Page {
  url: string;
  html: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

function sameDomain(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

async function getHtml(url: string, timeoutMs = 15000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (!res.ok || !ctype.includes("text/html")) return null;
    return await res.text();
  } catch (err) {
    console.log(`  [skip] ${url} (${(err as Error).name})`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function crawl(
  seeds: string[],
  maxPages = 25,
  maxDepth = 1,
  delayMs = 500,
): Promise<Page[]> {
  const seen = new Set<string>();
  const pages: Page[] = [];
  const queue: Array<{ url: string; depth: number }> = [];

  for (const s of seeds) {
    const n = normalize(s);
    if (!seen.has(n)) {
      seen.add(n);
      queue.push({ url: n, depth: 0 });
    }
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const html = await getHtml(url);
    if (!html) {
      await sleep(delayMs);
      continue;
    }

    pages.push({ url, html });
    console.log(`  [${String(pages.length).padStart(3)}] ${url}`);

    if (depth < maxDepth) {
      const $ = cheerio.load(html);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        let link: string;
        try {
          link = normalize(new URL(href, url).toString());
        } catch {
          return;
        }
        if (!link.startsWith("http")) return;
        if (SKIP_EXT.some((ext) => link.toLowerCase().endsWith(ext))) return;
        if (!sameDomain(link, url)) return;
        if (seen.has(link)) return;
        seen.add(link);
        queue.push({ url: link, depth: depth + 1 });
      });
    }

    await sleep(delayMs);
  }

  return pages;
}

export async function fetchUrls(urls: string[], delayMs = 500): Promise<Page[]> {
  const pages: Page[] = [];
  for (const raw of urls) {
    const url = normalize(raw);
    const html = await getHtml(url);
    if (html) {
      pages.push({ url, html });
      console.log(`  [ok] ${url}`);
    }
    await sleep(delayMs);
  }
  return pages;
}
