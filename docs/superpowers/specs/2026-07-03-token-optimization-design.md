# gmail-mcp Token Optimization — Design (Approach B)

**Date:** 2026-07-03
**Status:** Approved for planning
**Scope:** `gmail-mcp` MCP server (`src/`) + the `gmail-helper` skill prompt (two copies).

## Problem

Using the server to check or triage mail burns context-window tokens fast. Diagnosed cause (confirmed with the user): **too many round-trips**, not fat single payloads. A multi-account triage runs `1 search + N·gmail_get_message + N·gmail_modify_labels` because each mutation tool targets a single message and the `gmail-helper` skill reads every message individually — even though the search snippet already carries enough to decide.

Secondary, near-free wins observed in the code:
- Every JSON result is pretty-printed (`JSON.stringify(v, null, 2)`) — ~15–25% pure whitespace overhead.
- `gmail_get_message` returns raw HTML bodies when no `text/plain` part exists.
- `gmail_get_thread` returns the raw Gmail API object (`res.data`) — every message's full payload + base64 body.
- `gmail_get_attachment` returns base64 data inline — a single call can dump multiple MB into context.
- `gmail_search` does an N+1 `format:"full"` fetch per hit purely to build a summary.

## Goal & success metric

Collapse triage to a roughly **constant** number of round-trips — target `1 search + 1 batch-modify` per action group — and ensure no single tool result dumps raw HTML or base64 into context. Read side is already covered by `gmail_search` snippets, so the primary work is on the **mutation** side plus compaction of the heavy reads.

## Non-goals (YAGNI)

- No macro/digest tools (`gmail_triage`, `gmail_apply`) — that was rejected Approach C.
- No local mail cache / offline store.
- No search-pagination redesign beyond switching the per-hit fetch to `format:"metadata"`.

## Design

### Decisions (locked with user)

| Decision | Choice |
|---|---|
| Batch mutation param | Accept **either** `messageId` (string) or `messageIds` (string[]); normalize to array internally. Canonical = `messageIds`. |
| Body truncation default | **~1000 chars**, with `full: true` opt-in for the untruncated body. |
| Attachment handling | **Write decoded file to disk**, return `{filename, mimeType, path, bytes}` — never base64 inline. |
| Skill source of truth | Update **both** copies of `gmail-helper` (standalone + `chuan-skills` marketplace). |

### Component 1 — Batch mutations (primary win)

Convert single-target mutation tools to array-based, backed by `gmail.users.messages.batchModify` (up to 1000 IDs per API call).

| Tool | New input | Implementation |
|---|---|---|
| `gmail_modify_labels` | `messageIds: string[]`, `addLabels?`, `removeLabels?` | `batchModify({ ids, addLabelIds, removeLabelIds })` |
| `gmail_mark_read` | `messageIds: string[]` | `batchModify` removing `UNREAD` |
| `gmail_mark_unread` | `messageIds: string[]` | `batchModify` adding `UNREAD` |
| `gmail_trash` | `messageIds: string[]` | `batchModify` adding `TRASH` |
| `gmail_untrash` | `messageIds: string[]` | `batchModify` removing `TRASH` |

Rules:
- **Normalization:** a `messageId` string OR a `messageIds` array is accepted; both become `string[]`. At least one non-empty ID is required, else a clear error.
- **Chunking:** >1000 IDs are split into batches of 1000; each chunk is a separate `batchModify` call.
- **Return shape:** `{ modified: N }` (batchModify returns an empty body, so synthesize the count from input length).
- **Errors:** propagate through the existing `try/catch` in `handleCallTool` (returns `isError: true`). No partial-success bookkeeping beyond what the API reports.

Tool schemas in `src/tools.ts` change `messageId` (STR) → `messageIds` (STR_ARRAY) with updated descriptions; the handler accepts both for compatibility.

### Component 2 — Compact reads

- **Global JSON minify:** `json()` helper in `src/handlers.ts` uses `JSON.stringify(value)` (no indent). Applies to every JSON-returning tool; no other behavior change.
- **`gmail_get_message`:** prefer `text/plain`; when only `text/html` exists, strip tags → plain text (strip `<script>/<style>` blocks, remove tags, decode common HTML entities, collapse whitespace). Truncate the resulting body to **1000 chars**, appending `…[truncated, N chars total]`. New optional param `full: boolean` returns the untruncated body and skips the truncation marker.
- **`gmail_search`:** change the per-hit fetch to `format: "metadata"` with `metadataHeaders: ["Subject","From","Date"]`. Returns snippet + headers with **no body download** — same `EmailSummary` output, far cheaper (removes the N+1 body cost).
- **`gmail_get_thread`:** replace `return res.data` with a compact shape:
  ```
  { id, historyId, messages: [ { id, from, to, date, subject, snippet, body, labels } ] }
  ```
  where `body` reuses the get_message strip+truncate (1000 chars). New optional `full: boolean` returns the raw API object.
- **`gmail_get_attachment`:** decode the base64 and write to disk under the config dir (e.g. `${configDir}/attachments/<messageId>-<filename>`), returning `{ filename, mimeType, path, bytes }`. The `filename`/`mimeType` come from `gmail_list_attachments`; if unavailable, fall back to `<attachmentId>.bin` / `application/octet-stream`. Never return the base64 body in the tool result.

### Component 3 — Trim list outputs

- **`gmail_list_labels`:** map each label to `{ id, name, type }` (drop `color`, `messageListVisibility`, `labelListVisibility`, counts).

### Component 4 — Skill update (realizes the savings)

Update **both** copies of `gmail-helper/SKILL.md`:
- `~/.claude/skills/gmail-helper/SKILL.md`
- `~/.claude/plugins/marketplaces/chuan-skills/plugins/daily/skills/gmail-helper/SKILL.md`

Changes to the triage instructions:
1. Triage from `gmail_search` results (sender + subject + snippet). Only call `gmail_get_message` when a decision genuinely needs the body — not by default per message.
2. **Collect** label / read / trash decisions across all messages first, then apply them in **one batched call per action group** (e.g. all messages getting label X in a single `gmail_modify_labels` with `messageIds`).

`daily-planner` calls `gmail-helper` as a sub-step and needs no direct change.

The two copies currently diverge; after this change both should carry the same batched-triage instructions. Confirm the non-triage differences are intentional before overwriting (do not clobber unrelated content — apply the same targeted edit to each).

## Data flow (after)

```
Triage:
  gmail_search(account, "is:unread", maxResults=N)   → [ {id, subject, from, snippet, ...} ]   (1 call, no bodies)
  → model buckets by snippet
  → gmail_modify_labels(account, messageIds=[...], addLabels=[L])   (1 call per label group, batchModify)
  → gmail_mark_read(account, messageIds=[...])                      (1 call)

Read one message on demand:
  gmail_get_message(account, messageId)  → plain-text body, ≤1000 chars (full:true for all)

Attachment:
  gmail_get_attachment(...)  → { path } on disk (no base64 in context)
```

## Testing (TDD)

Existing vitest suite: `handlers.test.ts`, `gmail-client.test.ts`, `tools.test.ts`, `mime.test.ts`. Add/adjust:
- `batchModify` invoked with correct `ids` + `addLabelIds`/`removeLabelIds` for modify_labels / mark_read / mark_unread / trash / untrash.
- `messageId` string and `messageIds` array both normalize correctly; empty input errors.
- >1000 IDs → multiple `batchModify` calls (chunking).
- HTML → plain-text stripping; truncation at 1000 chars with marker; `full:true` bypasses truncation.
- `gmail_search` calls `messages.get` with `format:"metadata"`.
- `gmail_get_thread` compact shape; `full:true` returns raw.
- `gmail_get_attachment` writes a file and returns a path (mock fs), no base64 in result.
- `json()` output has no indentation.

## Rollout

1. Implement + green tests, `npm run build`.
2. Bump `package.json` version (0.1.0 → 0.2.0 — breaking tool-schema change).
3. Update both skill copies.
4. Restart the MCP server in Claude so it reloads the new tool schemas (same binary path — no `claude mcp add` change needed).

## Risks

- **Schema change is breaking:** any ad-hoc caller passing `messageId` still works via normalization, but the advertised schema now shows `messageIds`. Mitigated by dual-accept.
- **`batchModify` + `TRASH` label semantics:** adding/removing the `TRASH` system label via `batchModify` moves messages to/from trash (equivalent to `messages.trash`/`untrash`). Verify in a test against the mock and once live on a throwaway message.
- **Attachment disk writes:** need the config dir to be writable; create `attachments/` on demand. Filenames sanitized to avoid path traversal.
