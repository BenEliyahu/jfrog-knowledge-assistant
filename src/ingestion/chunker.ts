/**
 * Token-aware chunking with overlap. Splits a document into paragraph-aligned
 * chunks of ~targetTokens with a percentage overlap between consecutive chunks.
 * Token counts use a lightweight word-based estimate (~1.3 tokens/word) so the
 * chunker stays provider-agnostic.
 */
import type { Document } from "./cleaner";

const TOKENS_PER_WORD = 1.3;

export interface Chunk {
  text: string;
  url: string;
  title: string;
  product: string;
  chunkIndex: number;
}

function words(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

export function estimateTokens(text: string): number {
  return Math.round(words(text).length * TOKENS_PER_WORD);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function chunkDocument(
  doc: Document,
  targetTokens = 500,
  overlapRatio = 0.15,
): Chunk[] {
  const paragraphs = splitParagraphs(doc.text);
  const overlapTokens = Math.round(targetTokens * overlapRatio);

  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let idx = 0;

  const push = (text: string) => {
    if (!text.trim()) return;
    chunks.push({
      text: text.trim(),
      url: doc.url,
      title: doc.title,
      product: doc.product,
      chunkIndex: idx++,
    });
  };

  // Emit the buffer as a chunk and return an overlap tail to seed the next one.
  const flush = (): string[] => {
    push(buf.join("\n\n"));
    const tail: string[] = [];
    let t = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      t += estimateTokens(buf[i]);
      tail.unshift(buf[i]);
      if (t >= overlapTokens) break;
    }
    return tail;
  };

  for (const para of paragraphs) {
    const pTok = estimateTokens(para);

    // Oversized single paragraph: hard-split by words.
    if (pTok > targetTokens) {
      if (buf.length) {
        buf = flush();
        bufTokens = buf.reduce((s, p) => s + estimateTokens(p), 0);
      }
      const ws = words(para);
      const step = Math.max(1, Math.floor(targetTokens / TOKENS_PER_WORD));
      for (let i = 0; i < ws.length; i += step) {
        push(ws.slice(i, i + step).join(" "));
      }
      continue;
    }

    if (bufTokens + pTok > targetTokens && buf.length) {
      buf = flush();
      bufTokens = buf.reduce((s, p) => s + estimateTokens(p), 0);
    }

    buf.push(para);
    bufTokens += pTok;
  }

  if (buf.length) push(buf.join("\n\n"));

  return chunks;
}
