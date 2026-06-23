/** Thin orchestrator wiring retrieval + generation into one call. */
import { Retriever } from "../retrieval/retriever";
import { AnswerGenerator, type RAGAnswer } from "./generator";

export class RAGPipeline {
  private _retriever: Retriever | null = null;
  private _generator: AnswerGenerator | null = null;

  private get retriever(): Retriever {
    if (!this._retriever) this._retriever = new Retriever();
    return this._retriever;
  }

  private get generator(): AnswerGenerator {
    if (!this._generator) this._generator = new AnswerGenerator();
    return this._generator;
  }

  async answer(
    question: string,
    topK?: number,
    product?: string,
  ): Promise<RAGAnswer> {
    const chunks = await this.retriever.retrieve(question, topK, product);
    return this.generator.generate(question, chunks);
  }
}
