# JFrog Product Knowledge Assistant (RAG) — TypeScript

An AI assistant that answers questions about JFrog products (Artifactory, Xray,
Platform) from public documentation and blog content. It behaves like an
internal enterprise knowledge assistant: retrieve relevant docs, ground the
answer in them, and return a structured response with source citations.

```
question ──▶ embed query ──▶ vector search (cosine, +optional BM25 hybrid)
                                   │
                              top-K chunks (with metadata: url, product)
                                   │
                       prompt = context + question
                                   │
                            OpenAI (gpt-4o)
                                   │
              { "answer": ..., "sources": [...], "confidence": 0-1 }
```

## Stack

| Layer        | Choice                                   | Notes |
|--------------|------------------------------------------|-------|
| Language     | **TypeScript** (run via `tsx`)           | No build step needed for dev |
| LLM          | **OpenAI `gpt-4o`** via `openai` SDK      | Structured Outputs (Zod) guarantee the JSON contract |
| Embeddings   | **OpenAI `text-embedding-3-small`**       | Same SDK/key as the LLM |
| Vector store | **In-memory cosine**, persisted to JSON   | Zero native deps; swap for hnswlib/Qdrant at scale |
| Hybrid       | **BM25** (hand-rolled) + RRF, optional    | Lexical + semantic fusion |
| API          | **Express**                               | `POST /ask` returns the structured response |

> Why not FAISS? FAISS has no good Node binding, and `hnswlib-node` needs native
> build tools on Windows. For a demo corpus, brute-force cosine is fast and has
> zero native dependencies. The `VectorStore` interface makes swapping in an ANN
> index or a served vector DB straightforward.

## Project layout

```
src/
├── config.ts                 # env-driven config
├── ingestion/
│   ├── crawler.ts            # polite same-domain crawler (fetch + cheerio)
│   ├── cleaner.ts            # HTML -> clean text + product tagging
│   ├── chunker.ts            # token-aware chunking w/ overlap
│   └── pipeline.ts           # crawl -> clean -> chunk -> embed -> store
├── retrieval/
│   ├── embeddings.ts         # OpenAI embeddings (pluggable interface)
│   ├── vectorStore.ts        # cosine search + JSON persistence
│   ├── bm25.ts               # BM25 Okapi
│   └── retriever.ts          # semantic + BM25 hybrid (RRF) + product filter
├── llm/
│   ├── generator.ts          # OpenAI prompt + Zod structured answer
│   └── rag.ts                # retrieval + generation orchestrator
├── api/
│   └── server.ts             # Express app
├── ingest.ts                 # CLI: build the index
└── ask.ts                    # CLI: ask a question
```

## Setup

```powershell
cd C:\Users\bene\Desktop\ben\jfrog-knowledge-assistant-ts
npm install
Copy-Item .env.example .env    # then edit .env and set OPENAI_API_KEY
```

Requires Node 18+ (uses the global `fetch`).

## Usage

### 1. Build the index (ingestion — required before asking)

```powershell
npm run ingest -- --seed https://jfrog.com/blog/ --max-pages 25 --max-depth 1
# or feed your own URL list (one per line):
npm run ingest -- --urls-file my_urls.txt
```

> The `--` passes the flags through npm to the script. The JFrog *help center* is
> a JavaScript-rendered SPA, so a plain HTTP crawler gets limited content from it;
> the blog is server-rendered and works well.

### 2. Ask a question (CLI)

```powershell
npm run ask -- "How does Xray scan for vulnerabilities?"
npm run ask -- "What is a virtual repository?" --product artifactory --top-k 6
npm run ask -- "Explain release bundles" --json
```

### 3. Run the API

```powershell
npm run serve
```

```powershell
curl -X POST http://127.0.0.1:8000/ask `
  -H "Content-Type: application/json" `
  -d '{\"question\": \"How does Xray scan for vulnerabilities?\", \"top_k\": 5}'
```

Response:

```json
{
  "answer": "Xray scans by recursively...",
  "sources": ["https://jfrog.com/blog/..."],
  "confidence": 0.82
}
```

## Design notes (for the interview)

- **Modular boundaries:** ingestion / retrieval / llm / api are independent and
  individually testable; each has a single responsibility.
- **Type-safe contract:** the `{ answer, sources, confidence }` shape is a Zod
  schema used both as the OpenAI Structured Outputs format *and* the TS type.
- **Grounding & honesty:** the prompt forces answers from context only and lowers
  `confidence` when context is thin; a code-level guard also drops any cited URL
  that wasn't actually retrieved.
- **Hybrid retrieval:** semantic (cosine) + lexical (BM25) fused with Reciprocal
  Rank Fusion, toggled by `HYBRID_SEARCH`.
- **Metadata filtering:** chunks are tagged by product (artifactory / xray / ...)
  for filtered retrieval.

## Production next steps

- Swap the brute-force store for **hnswlib-node** or a served vector DB
  (Qdrant / pgvector / Pinecone) behind the same `VectorStore` interface.
- Upgrade embeddings to `text-embedding-3-large` for higher recall.
- Add a **reranker** after retrieval.
- Render JS-heavy docs with **Playwright** during ingestion.
- Add query/answer logging + an eval harness (faithfulness, answer relevance).
```
