/**
 * CLI: build the vector index from JFrog content.
 *
 *   npm run ingest -- --seed https://jfrog.com/blog/ --max-pages 25 --max-depth 1
 *   npm run ingest -- --urls-file my_urls.txt
 */
import fs from "node:fs";
import { buildIndex } from "./ingestion/pipeline";

interface Args {
  seeds: string[];
  urlsFile?: string;
  maxPages: number;
  maxDepth: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seeds: [], maxPages: 25, maxDepth: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--seed":
        args.seeds.push(next());
        break;
      case "--urls-file":
        args.urlsFile = next();
        break;
      case "--max-pages":
        args.maxPages = Number(next());
        break;
      case "--max-depth":
        args.maxDepth = Number(next());
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let urls: string[] = [];
  if (args.urlsFile) {
    urls = fs
      .readFileSync(args.urlsFile, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  if (args.seeds.length === 0 && urls.length === 0) {
    console.error("Provide at least one --seed URL or a --urls-file.");
    process.exit(1);
  }

  await buildIndex({
    seeds: args.seeds,
    urls,
    maxPages: args.maxPages,
    maxDepth: args.maxDepth,
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
