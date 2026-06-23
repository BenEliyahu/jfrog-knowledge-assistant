/** Express API for the LangChain RAG pipeline (POST /ask on the same shape). */
import express from "express";
import { CONFIG } from "../config";
import { RAGPipeline } from "./rag";

const app = express();
app.use(express.json());

let pipeline: RAGPipeline | null = null;
function getPipeline(): RAGPipeline {
  if (!pipeline) pipeline = new RAGPipeline();
  return pipeline;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "langchain" });
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
    const status = msg.includes("No index found") ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

// Use a different default port so it can run alongside the hand-written API.
const port = CONFIG.port + 1;
app.listen(port, () => {
  console.log(`JFrog Knowledge Assistant (LangChain) API on http://127.0.0.1:${port}`);
  console.log(`  POST /ask    { "question": "...", "top_k": 5, "product": "xray" }`);
});
