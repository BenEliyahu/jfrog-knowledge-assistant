/** Minimal BM25 (Okapi) implementation for lexical retrieval. */

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export class BM25 {
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private docs: string[][];
  private docLen: number[];
  private avgdl: number;
  private idf: Map<string, number> = new Map();

  constructor(corpus: string[][]) {
    this.docs = corpus;
    this.docLen = corpus.map((d) => d.length);
    const n = corpus.length;
    this.avgdl = n ? this.docLen.reduce((a, b) => a + b, 0) / n : 0;

    const df = new Map<string, number>();
    for (const doc of corpus) {
      for (const term of new Set(doc)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    for (const [term, freq] of df) {
      // Okapi BM25 idf with +1 to keep it non-negative.
      this.idf.set(term, Math.log(1 + (n - freq + 0.5) / (freq + 0.5)));
    }
  }

  getScores(queryTokens: string[]): number[] {
    const q = [...new Set(queryTokens)];
    return this.docs.map((doc, i) => {
      const len = this.docLen[i];
      const freqs = new Map<string, number>();
      for (const t of doc) freqs.set(t, (freqs.get(t) ?? 0) + 1);

      let score = 0;
      for (const term of q) {
        const f = freqs.get(term);
        if (!f) continue;
        const idf = this.idf.get(term) ?? 0;
        const denom = f + this.k1 * (1 - this.b + (this.b * len) / (this.avgdl || 1));
        score += idf * ((f * (this.k1 + 1)) / denom);
      }
      return score;
    });
  }
}
