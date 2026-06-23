/** Turn raw HTML into clean text plus light metadata (title, product). */
import * as cheerio from "cheerio";

const PRODUCT_KEYWORDS: Record<string, string[]> = {
  artifactory: ["artifactory", "repository", "repositories", "artifact"],
  xray: ["xray", "vulnerabilit", "cve", "scan", "license compliance"],
  pipelines: ["pipelines", "ci/cd", "pipeline"],
  distribution: ["distribution", "release bundle", "edge node"],
  platform: ["jfrog platform", "access token", "platform", "saas"],
};

const STRIP = "script, style, nav, header, footer, aside, form, noscript";

export interface Document {
  url: string;
  title: string;
  text: string;
  product: string;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

export function detectProduct(url: string, text: string): string {
  const hay = (url + " " + text.slice(0, 4000)).toLowerCase();
  let best = "platform";
  let bestScore = 0;
  for (const [product, kws] of Object.entries(PRODUCT_KEYWORDS)) {
    const score = kws.reduce((s, kw) => s + countOccurrences(hay, kw), 0);
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore > 0 ? best : "platform";
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function clean(url: string, html: string): Document | null {
  const $ = cheerio.load(html);
  $(STRIP).remove();

  const title = ($("title").first().text() || url).trim();

  const main = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");

  const text = collapseWhitespace(main.text().replace(/\r/g, ""));
  if (text.length < 200) return null;

  return { url, title, text, product: detectProduct(url, text) };
}
