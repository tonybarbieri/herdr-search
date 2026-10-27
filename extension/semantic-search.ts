import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

export default function (pi: ExtensionAPI) {
  const binaryPath = path.join(os.homedir(), ".local/bin/herdr-search");
  const indexerPath = path.join(os.homedir(), ".local/bin/herdr-index");

  // Probe the search backends when a session starts (skipped if a healthy check is under 5 minutes
  // old). A failure also raises the Herdr sidebar warning and notification; this adds a pi notice.
  pi.on("session_start", (_event, ctx) => {
    execFile(indexerPath, ["--doctor", "--max-age", "300"], { timeout: 60_000 }, (err, stdout) => {
      if (!err) return;
      const problems = stdout
        .split("\n")
        .filter((l) => l.startsWith("FAIL"))
        .map((l) => l.replace(/^FAIL\s+/, ""))
        .join("; ");
      try {
        ctx.ui.notify(`Semantic search is down: ${problems || (err as Error).message}`, "warning");
      } catch {
        // no UI available (non-interactive session)
      }
    });
  });

  // status=true: a fresh probe of the backends plus how current this repo's index is.
  const run = async (args: string[]) => {
    try {
      const { stdout } = await execFileAsync(indexerPath, args, { timeout: 60_000 });
      return { ok: true, out: stdout.trim() };
    } catch (err: any) {
      return { ok: false, out: (err.stdout || err.stderr || err.message || "").toString().trim() };
    }
  };
  const searchStatus = async () => {
    const health = await run(["--doctor"]);
    const status = await run(["--status"]);
    // --status already reports the point count, so drop the doctor's duplicate "info index" line.
    const doctor = health.out.split("\n").filter((l) => !l.startsWith("info index")).join("\n");
    const text = [doctor, status.ok ? status.out : ""].filter(Boolean).join("\n");
    return {
      ...(health.ok ? {} : { isError: true }),
      content: [{ type: "text", text }],
    };
  };

  pi.registerTool({
    name: "semantic_code_search",
    description:
      "Semantic search over the current repo's Qdrant index (Ollama embeddings; refreshed automatically before each query, no VS Code needed). Returns the best-matching files with " +
      "snippets read from the working tree (line numbers re-located after edits). Identifier-like terms (camelCase, " +
      "snake_case, dotted or `backticked`) also get an exact-match boost via git grep. Tests and specs rank slightly " +
      "below implementation; archived logs are excluded unless includeAll is set. Pass status=true (no query needed) " +
      "to check whether Qdrant and Ollama are up and how current this repo's index is.",
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
        status: {
          type: "boolean",
          description: "Report search health (Qdrant, Ollama) and index freshness instead of searching. No query needed.",
        },
      },
      required: [],
    },
    execute: async (
      _toolCallId,
      params: { query?: string; files?: number; path?: string; listOnly?: boolean; includeAll?: boolean; status?: boolean },
    ) => {
      if (params.status) return searchStatus();
      if (!params.query) {
        return { isError: true, content: [{ type: "text", text: "Provide a query, or pass status=true to check search health." }] };
      }
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
