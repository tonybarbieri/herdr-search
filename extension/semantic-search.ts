import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

export default function (pi: ExtensionAPI) {
  const binaryPath = path.join(os.homedir(), ".local/bin/herdr-search");

  pi.registerTool({
    name: "semantic_code_search",
    description:
      "Semantic search over the current repo's Qdrant index (Ollama embeddings; refreshed automatically before each query, no VS Code needed). Returns the best-matching files with " +
      "snippets read from the working tree (line numbers re-located after edits). Identifier-like terms (camelCase, " +
      "snake_case, dotted or `backticked`) also get an exact-match boost via git grep. Tests and specs rank slightly " +
      "below implementation; archived logs are excluded unless includeAll is set.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of the code or concept to find. Include exact identifiers when known.",
        },
        files: { type: "number", description: "Number of files to return (default 6)." },
        path: {
          type: "string",
          description: "Restrict to files under this repo-relative path prefix, e.g. 'src/core' or 'okf_knowledge/decisions'.",
        },
        listOnly: { type: "boolean", description: "Return ranked paths and line ranges only, without snippets." },
        includeAll: { type: "boolean", description: "Rank tests/specs/log archives at full weight." },
      },
      required: ["query"],
    },
    execute: async (
      _toolCallId,
      params: { query: string; files?: number; path?: string; listOnly?: boolean; includeAll?: boolean },
    ) => {
      const args: string[] = [];
      if (params.files) args.push("--files", String(Math.max(1, Math.floor(params.files))));
      if (params.path) args.push("--path", params.path);
      if (params.listOnly) args.push("--list");
      if (params.includeAll) args.push("--all");
      args.push(params.query);
      try {
        const { stdout, stderr } = await execFileAsync(binaryPath, args, { maxBuffer: 4 * 1024 * 1024 });
        return {
          content: [{ type: "text", text: stdout || stderr || "No results found." }],
        };
      } catch (err: any) {
        const detail = (err.stderr || err.stdout || err.message || "").toString().trim();
        return {
          isError: true,
          content: [{ type: "text", text: `Search execution error: ${detail}` }],
        };
      }
    },
  });
}
