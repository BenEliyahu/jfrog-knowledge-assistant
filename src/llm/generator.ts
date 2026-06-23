/**
 * Generation layer: build a grounded prompt and get a structured answer.
 *
 * Uses OpenAI (gpt-4o by default) with Structured Outputs via Zod, so the
 * response is guaranteed to match the { answer, sources, confidence } schema.
 * The model is told to answer ONLY from the retrieved context and to lower its
 * confidence when the context is thin.
 */
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { CONFIG, requireOpenAI } from "../config";
import type { RetrievedChunk } from "../retrieval/retriever";

export const RAGAnswerSchema = z.object({
  answer: z.string().describe("Concise, grounded answer to the user's question."),
  sources: z
    .array(z.string())
    .describe("Source URLs actually used to support the answer."),
  confidence: z
    .number()
    .describe("Confidence from 0.0 to 1.0 that the context supports the answer."),
});

export type RAGAnswer = z.infer<typeof RAGAnswerSchema>;

const SYSTEM_PROMPT = `You are the JFrog Product Knowledge Assistant, an internal \
enterprise assistant that answers questions about JFrog products (Artifactory, \
Xray, the JFrog Platform, Pipelines, Distribution).

Rules:
- Answer ONLY using the provided context passages. Do not use outside knowledge.
- If the context does not contain the answer, say so plainly and set a low \
confidence — do not invent details.
- Be concise, accurate, and technical. Prefer specifics from the context.
- Put the source URLs you actually used in the \`sources\` field.
- \`confidence\` (0-1) reflects how well the context supports your answer: high \
when passages directly answer the question, low when tangential or missing.`;

function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "(no relevant passages were retrieved)";
  return chunks
    .map(
      (c, i) =>
        `[Passage ${i + 1}] product=${c.product} | source=${c.url}\n` +
        `title: ${c.title}\n${c.text}`,
    )
    .join("\n\n---\n\n");
}

export class AnswerGenerator {
  private client: OpenAI;

  constructor(client?: OpenAI) {
    requireOpenAI();
    this.client = client ?? new OpenAI({ apiKey: CONFIG.openaiApiKey });
  }

  async generate(question: string, chunks: RetrievedChunk[]): Promise<RAGAnswer> {
    const userPrompt =
      `Context passages:\n\n${formatContext(chunks)}\n\n` +
      `Question: ${question}\n\n` +
      "Answer the question using only the passages above, and cite the source " +
      "URLs you relied on.";

    const completion = await this.client.beta.chat.completions.parse({
      model: CONFIG.openaiModel,
      max_tokens: CONFIG.maxTokens,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(RAGAnswerSchema, "rag_answer"),
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      return {
        answer: "I couldn't produce a grounded answer for this question.",
        sources: [],
        confidence: 0,
      };
    }

    // Enforce numeric range and only surface URLs that were actually retrieved.
    const allowed = new Set(chunks.map((c) => c.url));
    const filtered = parsed.sources.filter((u) => allowed.has(u));
    return {
      answer: parsed.answer,
      sources: filtered.length ? filtered : [...allowed],
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
    };
  }
}
