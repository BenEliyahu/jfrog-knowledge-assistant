/** Central, env-driven configuration. */
import "dotenv/config";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export const CONFIG = {
  // LLM (OpenAI)
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",
  maxTokens: Number(process.env.OPENAI_MAX_TOKENS ?? 2000),

  // Embeddings
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",

  // Chunking
  chunkTokens: Number(process.env.CHUNK_TOKENS ?? 500),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP ?? 0.15),

  // Retrieval
  topK: Number(process.env.TOP_K ?? 5),
  hybridSearch: bool("HYBRID_SEARCH", true),

  // API
  port: Number(process.env.PORT ?? 8000),

  // Storage
  indexPath: path.join(DATA_DIR, "index.json"),
} as const;

export function requireOpenAI(): void {
  if (!CONFIG.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy .env.example to .env and set it.",
    );
  }
}
