/**
 * Tiny persistence for LangChain's MemoryVectorStore.
 *
 * MemoryVectorStore keeps everything in `store.memoryVectors` (content + embedding
 * + metadata) but has no built-in save/load, so we serialize that array to JSON.
 * On load we also rebuild plain Documents so BM25 can be reconstructed from the
 * same data — no re-embedding, no re-crawling.
 */
import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import type { OpenAIEmbeddings } from "@langchain/openai";

export const LC_STORE_PATH = path.resolve(__dirname, "..", "..", "data", "lc-store.json");

interface PersistedVector {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export function saveStore(store: MemoryVectorStore): void {
  fs.mkdirSync(path.dirname(LC_STORE_PATH), { recursive: true });
  const data: PersistedVector[] = store.memoryVectors.map((v) => ({
    content: v.content,
    embedding: v.embedding,
    metadata: v.metadata,
  }));
  fs.writeFileSync(LC_STORE_PATH, JSON.stringify(data));
}

export function loadStoreAndDocs(embeddings: OpenAIEmbeddings): {
  store: MemoryVectorStore;
  docs: Document[];
} {
  if (!fs.existsSync(LC_STORE_PATH)) {
    throw new Error(
      `No index found at ${LC_STORE_PATH}. Run \`npm run ingest:lc -- ...\` first.`,
    );
  }
  const data = JSON.parse(fs.readFileSync(LC_STORE_PATH, "utf-8")) as PersistedVector[];

  const store = new MemoryVectorStore(embeddings);
  store.memoryVectors = data.map((d) => ({
    content: d.content,
    embedding: d.embedding,
    metadata: d.metadata,
  }));

  const docs = data.map(
    (d) => new Document({ pageContent: d.content, metadata: d.metadata }),
  );
  return { store, docs };
}
