/**
 * In-memory vector store with brute-force cosine search, persisted to JSON.
 *
 * Vectors are stored L2-normalized, so cosine similarity is just a dot product.
 * Brute force is O(N) per query — perfectly fine for a demo corpus (hundreds to
 * a few thousand chunks). For larger corpora, swap in an ANN index (hnswlib-node)
 * or a served vector DB (Qdrant, pgvector, Pinecone) behind this same interface.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config";

export interface StoredChunk {
  text: string;
  url: string;
  title: string;
  product: string;
  chunkIndex: number;
}

export interface SearchHit {
  index: number;
  score: number;
}

interface Persisted {
  dim: number;
  chunks: StoredChunk[];
  vectors: number[][];
}

export class VectorStore {
  readonly dim: number;
  chunks: StoredChunk[] = [];
  private vectors: number[][] = [];

  constructor(dim: number) {
    this.dim = dim;
  }

  add(vectors: number[][], chunks: StoredChunk[]): void {
    if (vectors.length !== chunks.length) {
      throw new Error("vectors and chunks length mismatch");
    }
    this.vectors.push(...vectors);
    this.chunks.push(...chunks);
  }

  get size(): number {
    return this.vectors.length;
  }

  /** Top-k by cosine similarity (dot product on normalized vectors). */
  search(queryVec: number[], topK: number): SearchHit[] {
    const scores: SearchHit[] = this.vectors.map((v, index) => {
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * queryVec[i];
      return { index, score: dot };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  save(indexPath: string = CONFIG.indexPath): void {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    const payload: Persisted = {
      dim: this.dim,
      chunks: this.chunks,
      vectors: this.vectors,
    };
    fs.writeFileSync(indexPath, JSON.stringify(payload));
  }

  static load(indexPath: string = CONFIG.indexPath): VectorStore {
    if (!fs.existsSync(indexPath)) {
      throw new Error(
        `No index found at ${indexPath}. Run \`npm run ingest -- ...\` first.`,
      );
    }
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Persisted;
    const store = new VectorStore(data.dim);
    store.chunks = data.chunks;
    store.vectors = data.vectors;
    return store;
  }
}
