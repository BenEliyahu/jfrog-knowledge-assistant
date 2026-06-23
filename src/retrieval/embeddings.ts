/**
 * OpenAI embeddings. Vectors are L2-normalized so a dot product equals cosine
 * similarity. Kept behind a small interface so a different provider could be
 * dropped in without touching the rest of the system.
 */
import OpenAI from "openai";
import { CONFIG, requireOpenAI } from "../config";

export interface EmbeddingModel {
  readonly dim: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const OPENAI_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

function l2normalize(vec: number[]): number[] {
  let norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (norm === 0) norm = 1;
  return vec.map((x) => x / norm);
}

export class OpenAIEmbeddings implements EmbeddingModel {
  readonly dim: number;
  private client: OpenAI;
  private model: string;

  constructor(model?: string) {
    requireOpenAI();
    this.client = new OpenAI({ apiKey: CONFIG.openaiApiKey });
    this.model = model ?? CONFIG.embeddingModel;
    this.dim = OPENAI_DIMS[this.model] ?? 1536;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return res.data.map((d) => l2normalize(d.embedding));
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    return v;
  }
}

export function getEmbeddingModel(): EmbeddingModel {
  return new OpenAIEmbeddings();
}
