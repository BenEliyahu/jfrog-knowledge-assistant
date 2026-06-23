/**
 * Retrieval: semantic search, optional BM25 hybrid, optional product filter.
 *
 * Semantic (cosine) and lexical (BM25) result lists are fused with Reciprocal
 * Rank Fusion (RRF), which combines ranks rather than incomparable score scales.
 */
import { CONFIG } from "../config";
import { getEmbeddingModel, type EmbeddingModel } from "./embeddings";
import { VectorStore } from "./vectorStore";
import { BM25, tokenize } from "./bm25";

export interface RetrievedChunk {
  text: string;
  url: string;
  title: string;
  product: string;
  score: number;
}

function rrf(rankedLists: number[][], k = 60): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ranked of rankedLists) {
    ranked.forEach((idx, rank) => {
      fused.set(idx, (fused.get(idx) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return fused;
}

export class Retriever {
  private store: VectorStore;
  private embedder: EmbeddingModel;
  private useHybrid: boolean;
  private bm25: BM25 | null = null;

  constructor(opts?: {
    store?: VectorStore;
    embedder?: EmbeddingModel;
    useHybrid?: boolean;
  }) {
    this.store = opts?.store ?? VectorStore.load();
    this.embedder = opts?.embedder ?? getEmbeddingModel();
    this.useHybrid = opts?.useHybrid ?? CONFIG.hybridSearch;
    if (this.useHybrid && this.store.size > 0) {
      this.bm25 = new BM25(this.store.chunks.map((c) => tokenize(c.text)));
    }
  }

  async retrieve(
    query: string,
    topK: number = CONFIG.topK,
    product?: string,
  ): Promise<RetrievedChunk[]> {
    const chunks = this.store.chunks;
    if (chunks.length === 0) return [];

    const fetch = topK * 5;

    // 1) Semantic
    const qvec = await this.embedder.embedQuery(query);
    const semHits = this.store.search(qvec, Math.min(fetch, chunks.length));
    const semOrder = semHits.map((h) => h.index);
    const semScore = new Map(semHits.map((h) => [h.index, h.score]));

    // 2) Lexical (optional) + fuse
    let ranked: number[];
    let scoreLookup: Map<number, number>;
    if (this.useHybrid && this.bm25) {
      const lexScores = this.bm25.getScores(tokenize(query));
      const lexOrder = lexScores
        .map((s, i) => [i, s] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, fetch)
        .map(([i]) => i);
      const fused = rrf([semOrder, lexOrder]);
      ranked = [...fused.keys()].sort((a, b) => fused.get(b)! - fused.get(a)!);
      scoreLookup = fused;
    } else {
      ranked = semOrder;
      scoreLookup = semScore;
    }

    // 3) Optional product filter + take topK
    const results: RetrievedChunk[] = [];
    for (const i of ranked) {
      const c = chunks[i];
      if (product && c.product !== product) continue;
      results.push({
        text: c.text,
        url: c.url,
        title: c.title,
        product: c.product,
        score: scoreLookup.get(i) ?? 0,
      });
      if (results.length >= topK) break;
    }
    return results;
  }
}
