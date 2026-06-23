/** Express API exposing the RAG assistant over HTTP. */
import express from "express";
import { CONFIG } from "../config";
import { RAGPipeline } from "../llm/rag";

const app = express();
app.use(express.json());

// Single shared pipeline (loads the index + embedder + OpenAI client once).
let pipeline: RAGPipeline | null = null;
function getPipeline(): RAGPipeline {
  if (!pipeline) pipeline = new RAGPipeline();
  return pipeline;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/ask", async (req, res) => {
  const { question, top_k, product } = req.body ?? {};
  if (typeof question !== "string" || question.trim().length < 3) {
    return res.status(400).json({ error: "`question` must be a string (>= 3 chars)." });
  }
  try {
    const result = await getPipeline().answer(
      question,
      typeof top_k === "number" ? top_k : undefined,
      typeof product === "string" ? product : undefined,
    );
    res.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    // Missing index -> 503 (run ingest first); everything else -> 500.
    const status = msg.includes("No index found") ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

app.listen(CONFIG.port, () => {
  console.log(`JFrog Knowledge Assistant API on http://127.0.0.1:${CONFIG.port}`);
  console.log(`  POST /ask    { "question": "...", "top_k": 5, "product": "xray" }`);
  console.log(`  GET  /health`);
});
