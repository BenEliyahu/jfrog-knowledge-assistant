/**
 * Ingestion with LangChain.js.
 *
 *   npm run ingest:lc -- --seed https://jfrog.com/blog/ --max-depth 1 --max-pages 20
 *   npm run ingest:lc -- --urls-file my_urls.txt
 *
 * Compare with the hand-written src/ingestion/* : LangChain's loaders and
 * RecursiveCharacterTextSplitter replace the custom crawler/cleaner/chunker.
 * (Product tagging stays custom — LangChain has no notion of "JFrog product".)
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveUrlLoader } from "@langchain/community/document_loaders/web/recursive_url";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { CONFIG, requireOpenAI } from "../config";
import { saveStore } from "./store";

const PRODUCT_KEYWORDS: Record<string, string[]> = {
  artifactory: ["artifactory", "repository", "repositories", "artifact"],
  xray: ["xray", "vulnerabilit", "cve", "scan", "license compliance"],
  pipelines: ["pipelines", "ci/cd", "pipeline"],
  distribution: ["distribution", "release bundle", "edge node"],
  platform: ["jfrog platform", "access token", "platform", "saas"],
};

function detectProduct(url: string, text: string): string {
  const hay = (url + " " + text.slice(0, 4000)).toLowerCase();
  let best = "platform";
  let bestScore = 0;
  for (const [product, kws] of Object.entries(PRODUCT_KEYWORDS)) {
    const score = kws.reduce((s, kw) => s + hay.split(kw).length - 1, 0);
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return best;
}

/** Strip boilerplate and return readable text — used as the RecursiveUrlLoader extractor. */
function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside, form, noscript").remove();
  const main = $("main").first().length ? $("main").first() : $("body");
  return main
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

interface Args {
  seeds: string[];
  urlsFile?: string;
  maxDepth: number;
  maxPages: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seeds: [], maxDepth: 1, maxPages: 20 };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--seed": args.seeds.push(next()); break;
      case "--urls-file": args.urlsFile = next(); break;
      case "--max-depth": args.maxDepth = Number(next()); break;
      case "--max-pages": args.maxPages = Number(next()); break;
      default: console.error(`Unknown argument: ${argv[i]}`); process.exit(1);
    }
  }
  return args;
}

async function loadDocuments(args: Args): Promise<Document[]> {
  const docs: Document[] = [];

  for (const seed of args.seeds) {
    const loader = new RecursiveUrlLoader(seed, {
      maxDepth: args.maxDepth,
      timeout: 15000,
      preventOutside: true,
      extractor: extractText,
    });
    docs.push(...(await loader.load()));
  }

  if (args.urlsFile) {
    const urls = fs
      .readFileSync(args.urlsFile, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const url of urls) {
      const loaded = await new CheerioWebBaseLoader(url).load();
      docs.push(...loaded);
    }
  }

  return docs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.seeds.length === 0 && !args.urlsFile) {
    console.error("Provide at least one --seed URL or a --urls-file.");
    process.exit(1);
  }
  requireOpenAI();

  console.log("1/3  Loading pages...");
  let docs = await loadDocuments(args);
  docs = docs
    .filter((d) => d.pageContent.trim().length >= 200)
    .slice(0, args.maxPages);
  if (docs.length === 0) throw new Error("No usable pages loaded.");
  for (const d of docs) {
    d.metadata.product = detectProduct(String(d.metadata.source ?? ""), d.pageContent);
  }
  console.log(`     loaded ${docs.length} pages`);

  console.log("2/3  Splitting + embedding...");
  // chunkSize/Overlap are in characters here (~4 chars/token), so ~500 tokens ≈ 2000 chars.
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,
    chunkOverlap: 300,
  });
  const chunks = await splitter.splitDocuments(docs);
  console.log(`     -> ${chunks.length} chunks`);

  const store = await MemoryVectorStore.fromDocuments(
    chunks,
    new OpenAIEmbeddings({ model: CONFIG.embeddingModel }),
  );

  console.log("3/3  Saving index...");
  saveStore(store);
  console.log(`Done. Indexed ${chunks.length} chunks (LangChain store).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
