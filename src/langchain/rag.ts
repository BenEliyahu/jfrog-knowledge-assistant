/**
 * RAG with LangChain.js — retrieval + generation.
 *
 * Compare with the hand-written src/retrieval/* and src/llm/* : the hybrid
 * retriever (semantic + BM25 + RRF) and the structured-output LLM call are a few
 * lines each here, because LangChain ships them as building blocks:
 *   - OpenAIEmbeddings / MemoryVectorStore   -> semantic retrieval
 *   - BM25Retriever                          -> lexical retrieval
 *   - EnsembleRetriever                      -> RRF fusion (built in)
 *   - ChatOpenAI.withStructuredOutput(zod)   -> guaranteed JSON contract
 */
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { EnsembleRetriever } from "langchain/retrievers/ensemble";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import type { Document } from "@langchain/core/documents";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { CONFIG, requireOpenAI } from "../config";
import { loadStoreAndDocs } from "./store";

export const RAGAnswerSchema = z.object({
  answer: z.string().describe("Concise, grounded answer to the user's question."),
  sources: z.array(z.string()).describe("Source URLs used to support the answer."),
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
- \`confidence\` (0-1) reflects how well the context supports your answer.`;

function formatDocs(docs: Document[]): string {
  if (docs.length === 0) return "(no relevant passages were retrieved)";
  return docs
    .map(
      (d, i) =>
        `[Passage ${i + 1}] product=${d.metadata.product ?? "?"} | ` +
        `source=${d.metadata.source ?? "?"}\n${d.pageContent}`,
    )
    .join("\n\n---\n\n");
}

export class RAGPipeline {
  private retriever!: EnsembleRetriever;
  private chain!: Runnable<{ context: string; question: string }, RAGAnswer>;
  private overfetch = Math.max(CONFIG.topK * 4, 20);
  private ready = false;

  private init(): void {
    if (this.ready) return;
    requireOpenAI();

    // LangChain reads OPENAI_API_KEY from the environment (loaded by config.ts).
    const embeddings = new OpenAIEmbeddings({ model: CONFIG.embeddingModel });
    const { store, docs } = loadStoreAndDocs(embeddings);

    // Hybrid retriever: semantic + lexical, fused with RRF by EnsembleRetriever.
    const semantic = store.asRetriever(this.overfetch);
    const lexical = BM25Retriever.fromDocuments(docs, { k: this.overfetch });
    this.retriever = new EnsembleRetriever({
      retrievers: [semantic, lexical],
      weights: [0.5, 0.5],
    });

    // Generation: prompt -> LLM constrained to the RAGAnswer schema.
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", SYSTEM_PROMPT],
      [
        "human",
        "Context passages:\n\n{context}\n\nQuestion: {question}\n\n" +
          "Answer using only the passages above, and cite the source URLs you relied on.",
      ],
    ]);
    const llm = new ChatOpenAI({
      model: CONFIG.openaiModel,
      maxTokens: CONFIG.maxTokens,
    }).withStructuredOutput(RAGAnswerSchema, { name: "rag_answer" });

    this.chain = prompt.pipe(llm);
    this.ready = true;
  }

  async answer(question: string, topK?: number, product?: string): Promise<RAGAnswer> {
    this.init();
    const k = topK ?? CONFIG.topK;

    let docs = await this.retriever.invoke(question);
    if (product) docs = docs.filter((d) => d.metadata.product === product);
    docs = docs.slice(0, k);

    const parsed = await this.chain.invoke({ context: formatDocs(docs), question });

    // Safety net: clamp confidence and keep only URLs that were actually retrieved.
    const allowed = new Set(docs.map((d) => String(d.metadata.source ?? "")));
    const filtered = parsed.sources.filter((u) => allowed.has(u));
    return {
      answer: parsed.answer,
      sources: filtered.length ? filtered : [...allowed].filter(Boolean),
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
    };
  }
}
