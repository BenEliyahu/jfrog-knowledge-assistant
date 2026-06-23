/** Ingestion pipeline: crawl/fetch -> clean -> chunk -> embed -> persist. */
import { CONFIG } from "../config";
import { crawl, fetchUrls, type Page } from "./crawler";
import { clean } from "./cleaner";
import { chunkDocument } from "./chunker";
import { getEmbeddingModel } from "../retrieval/embeddings";
import { VectorStore, type StoredChunk } from "../retrieval/vectorStore";

function pagesToChunks(pages: Page[]): StoredChunk[] {
  const chunks: StoredChunk[] = [];
  for (const page of pages) {
    const doc = clean(page.url, page.html);
    if (!doc) continue;
    for (const ch of chunkDocument(doc, CONFIG.chunkTokens, CONFIG.chunkOverlap)) {
      chunks.push({
        text: ch.text,
        url: ch.url,
        title: ch.title,
        product: ch.product,
        chunkIndex: ch.chunkIndex,
      });
    }
  }
  return chunks;
}

export async function buildIndex(opts: {
  seeds?: string[];
  urls?: string[];
  maxPages?: number;
  maxDepth?: number;
}): Promise<VectorStore> {
  console.log("1/4  Fetching pages...");
  let pages: Page[] = [];
  if (opts.seeds?.length) {
    pages = pages.concat(
      await crawl(opts.seeds, opts.maxPages ?? 25, opts.maxDepth ?? 1),
    );
  }
  if (opts.urls?.length) {
    pages = pages.concat(await fetchUrls(opts.urls));
  }
  if (pages.length === 0) {
    throw new Error("No pages fetched. Check your seeds/URLs and connectivity.");
  }

  console.log(`2/4  Cleaning + chunking ${pages.length} pages...`);
  const chunks = pagesToChunks(pages);
  if (chunks.length === 0) {
    throw new Error("No chunks produced (pages may have been empty/too short).");
  }
  console.log(`     -> ${chunks.length} chunks`);

  console.log("3/4  Embedding chunks...");
  const embedder = getEmbeddingModel();
  const store = new VectorStore(embedder.dim);
  const batch = 64;
  for (let i = 0; i < chunks.length; i += batch) {
    const slice = chunks.slice(i, i + batch);
    const vecs = await embedder.embedDocuments(slice.map((c) => c.text));
    store.add(vecs, slice);
    console.log(`     embedded ${Math.min(i + batch, chunks.length)}/${chunks.length}`);
  }

  console.log("4/4  Saving index...");
  store.save();
  console.log(`Done. Indexed ${store.size} chunks -> ${CONFIG.indexPath}`);
  return store;
}
