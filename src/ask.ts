/**
 * CLI: ask the assistant a question.
 *
 *   npm run ask -- "How does Xray scan for vulnerabilities?"
 *   npm run ask -- "What is a virtual repository?" --product artifactory --top-k 6
 *   npm run ask -- "Explain release bundles" --json
 */
import { RAGPipeline } from "./llm/rag";

interface Args {
  question: string;
  product?: string;
  topK?: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { question: "", json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--product") args.product = argv[++i];
    else if (a === "--top-k") args.topK = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else positional.push(a);
  }
  args.question = positional.join(" ").trim();
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.question) {
    console.error('Usage: npm run ask -- "your question" [--product xray] [--top-k 6] [--json]');
    process.exit(1);
  }

  const pipeline = new RAGPipeline();
  const result = await pipeline.answer(args.question, args.topK, args.product);

  if (args.json) {
    console.log(
      JSON.stringify(
        { ...result, confidence: Number(result.confidence.toFixed(3)) },
        null,
        2,
      ),
    );
    return;
  }

  const bar = "=".repeat(70);
  console.log(`\n${bar}\nANSWER\n`);
  console.log(result.answer);
  console.log(`\n${"-".repeat(70)}`);
  console.log(`CONFIDENCE: ${result.confidence.toFixed(2)}`);
  console.log("SOURCES:");
  for (const url of result.sources) console.log(`  - ${url}`);
  console.log(bar);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
