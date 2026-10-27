# herdr-search

Semantic code search for pi agents that works without VS Code. A standalone indexer keeps a
Qdrant index fresh, and a small CLI queries it.

```
pi tool semantic_code_search  ->  herdr-search  ->  herdr-index (refresh) -> Ollama + Qdrant
```

## Components

| Path | Installed to | Purpose |
|---|---|---|
| `bin/herdr-index` | `~/.local/bin/herdr-index` | Incremental indexer (chunk, embed, upsert, delete) |
| `bin/herdr-search` | `~/.local/bin/herdr-search` | Query CLI: refreshes the index, embeds the query, ranks results |
| `extension/semantic-search.ts` | `~/.pi/agent/extensions/semantic-search.ts` | pi tool wrapper (`semantic_code_search`) |
| `config/herdr-sidebar.toml` | merge into `~/.config/herdr/config.toml` | Optional "indexing" indicator in the Herdr sidebar |

## Requirements

- Python 3 with `requests`
- `git`
- Ollama on `localhost:11434` with `nomic-embed-text` (`ollama pull nomic-embed-text`)
- Qdrant on `localhost:6333`
- pi (for the tool wrapper) and optionally Herdr (for the sidebar indicator)

Override endpoints with `HERDR_QDRANT` and `HERDR_OLLAMA`, and the cache directory with `HERDR_INDEX_CACHE`.

## Install

```sh
./install.sh   # symlinks the scripts and the extension; reload pi afterwards
```

## How it works

- **Collection:** `ws-` + `sha256(git root)[:16]`; 768-d cosine vectors from `nomic-embed-text`.
- **Payload:** `filePath` (relative), `codeChunk`, `startLine`, `endLine`, `segmentHash`, `pathSegments`.
  Point id is `uuid5(segmentHash, f47ac10b-58cc-4372-a567-0e02b2c3d479)` (a fixed namespace) and
  `segmentHash = sha256("<abs path>-<start>-<end>-<len>-<first 100 chars>")`.
- **Chunking:** line-based, up to about 1150 characters, preferring blank-line and declaration
  boundaries.
- **Files:** `git ls-files -co --exclude-standard`, minus an optional `.herdrignore`. Extension
  allowlist, 1 MB cap (200 KB for JSON), lockfiles and minified files skipped. Non-git directories
  are refused unless `--allow-nongit` is given; `$HOME` and `/` are always refused.
- **Change detection:** manifest in `~/.cache/herdr-index/<collection>.json` (mtime and size, then
  content hash). Changed files are deleted and re-upserted; removed files are deleted. One lock per
  collection.
- **Freshness:** every `herdr-search` runs `herdr-index --budget 25` first. Work beyond the budget
  continues in a detached background run and the results start with a note. No daemon is needed.
- **Worktrees:** a linked worktree without its own index uses the main checkout's index, reading
  files from the worktree.
- **Ranking:** semantic score, plus a `git grep` boost for identifier-like terms, tests slightly
  down-weighted, `log-archive/` excluded unless `--all`.
- **Speed:** embedding throughput (about 105 chunks/s on the author's machine) is the limit; batching
  and parallel requests did not help. A full 9.7k-chunk index takes about 95 s; a no-op refresh about 0.3 s.

## Usage

```sh
herdr-search [--files N] [--path PREFIX] [--list] [--all] <query...>

herdr-index [--root DIR] [--budget SEC] [--full] [--status] [--prune] [--quiet]
            [--collection NAME] [--allow-nongit]
herdr-index --doctor [--max-age SEC]
# exit codes: 0 up to date, 1 unhealthy (--doctor), 2 error, 3 budget hit (more pending), 4 another run active
```

Environment: `HERDR_NO_REFRESH=1` skips the refresh in `herdr-search`; `HERDR_COLLECTION` overrides
the collection (for experiments).

## Herdr sidebar indicator

Inside Herdr, `herdr-index` sets an `indexing` token on the current workspace
(`herdr workspace report-metadata`, 20 s TTL) once a run lasts more than 1 s. Add the row from
`config/herdr-sidebar.toml` to your Herdr config to display it.

## Health monitoring

Failures should not be visible only inside an agent run. `herdr-index --doctor` probes Qdrant, and
Ollama (reachable, `nomic-embed-text` installed, embeddings are 768-d), records the result in
`~/.cache/herdr-index/health.json` and exits 1 if anything is wrong. It runs:

- when a pi session starts (the extension; skipped if a healthy check is under 5 minutes old),
- when a search or an indexing run fails (which also puts the cause in the error the agent sees),
- after any successful run that follows an unhealthy state, so recovery is noticed.

While unhealthy, every Herdr workspace shows a red `⚠ search down: <component>` row (the
`$searchwarn` token in `config/herdr-sidebar.toml`), and Herdr posts one notification when the state
flips to unhealthy and one when it recovers. Errors returned to agents say what is down and tell them
to report it to you before falling back to grep. Call the `semantic_code_search` tool with `status: true` (no query needed) for an on-demand probe plus how
current the index for the current repo is; agents can use it too.
There is no background daemon, so a backend that
dies between sessions is noticed at the next session start or search.

## Notes

- Deleting a collection in Qdrant is safe: the indexer notices it is missing and the next search rebuilds it.
