# Multi-Account Gmail MCP Server — Design

**Date:** 2026-05-11
**Status:** Approved (brainstorming complete; pending implementation plan)

## 1. Overview & Scope

A single MCP server that talks to *N* Gmail accounts instead of one. Every Gmail tool
takes an `account` parameter (a user-chosen alias such as `"work"`). Accounts are added
via an interactive auth CLI. The server exposes the 19 tools that exist today in
`gmail-mcp-server` (each gaining an `account` parameter) plus one new tool,
`gmail_list_accounts`, for runtime discovery of configured aliases — 20 tools total.

**Reuse strategy:** Build the project fresh in `/Users/chienchuanw/Documents/gmail-mcp`
with a multi-account architecture, test-first. Lift the proven *pure* helpers from the
existing `gmail-mcp-server` (`/Users/chienchuanw/Documents/gmail-mcp-server`) near-verbatim
— RFC 2822 MIME assembly with multipart boundaries, the `text/plain` → `text/html` body
extraction, and base64url encode/decode — and wrap them in tests as the first TDD cycle.
The structural parts (auth, server wiring, CLI) are written new because the originals are
single-account by construction (module-level config singletons, `userId: "me"` everywhere,
one token file).

**Stack:** TypeScript, ES modules, Node 18+. Dependencies: `@modelcontextprotocol/sdk`,
`googleapis`, `open`. Dev dependencies: `typescript`, `@types/node`, `vitest`. Packaged as
an `.mcpb` bundle at the end via `/mcp-server-dev:build-mcpb`.

**Principles:** All development follows TDD (test-first, red-green-refactor) and SDD
(this document is the spec; the implementation plan derives from it).

## 2. Storage Model

Config directory `~/.gmail-mcp/` (overridable via the `GMAIL_MCP_CONFIG_DIR` env var):

```
~/.gmail-mcp/
├── credentials.json          # ONE shared Google OAuth client (Desktop app type)
└── accounts/
    ├── work.json
    └── personal.json
```

Each `accounts/<alias>.json`:

```json
{
  "alias": "work",
  "email": "me@company.com",
  "token": {
    "access_token": "...",
    "refresh_token": "...",
    "scope": "...",
    "token_type": "Bearer",
    "expiry_date": 1731000000000
  }
}
```

- **One shared `credentials.json`** (one Google Cloud OAuth client app), **many per-alias
  token files.** One file per alias avoids read-modify-write races when one account's token
  is refreshed while the CLI is touching another.
- `email` is captured during the OAuth flow via `users.getProfile` and used for display in
  `gmail_list_accounts` output and `gmail-mcp auth list`.
- OAuth scopes are unchanged from the existing server:
  `gmail.readonly`, `gmail.send`, `gmail.compose`, `gmail.modify`, `gmail.labels`.

## 3. Module Layout

Small, single-purpose, independently testable modules under `src/`:

| Module | Responsibility | How it is tested |
|---|---|---|
| `config.ts` | Resolve config dir and file paths from the environment. | Direct, with env override. |
| `mime.ts` | **Pure.** `buildRawMessage({ to, subject, body, cc?, bcc?, attachments? })` → base64url string (RFC 2822, multipart/mixed when attachments present). `parseMessageBody(payload)` → string (prefers `text/plain`, falls back to `text/html`, handles single-part and multipart). `encodeBase64Url(buf)` / `decodeBase64Url(str)`. Lifted from the old `gmail.ts`. | Direct — **first TDD cycle.** |
| `accounts.ts` | `AccountStore`: `list()` → `{ alias, email }[]`; `get(alias)` → full record or null; `add(record)`; `remove(alias)`; `saveToken(alias, token)`. Filesystem-backed. | Against a temporary directory. |
| `oauth.ts` | `loadOAuthCredentials()` → parsed `credentials.json` (handles both `installed` and `web` shapes) or null; `createOAuth2Client(creds)` → configured `OAuth2Client`; `refreshIfExpired(client, onRefresh)` — if `expiry_date` is in the past, refresh and call `onRefresh(newToken)`. Wraps `google-auth-library`. | With a fake `OAuth2Client`. |
| `auth-flow.ts` | Interactive browser OAuth: build the auth URL, run a local HTTP callback server on port 3000, exchange the code for tokens, call `users.getProfile` for the account email. Returns `{ email, token }`. | Pure pieces (URL building, code→token via an injected client) tested directly; the HTTP server kept thin and exercised only by a smoke/integration check. |
| `gmail-client.ts` | `GmailClient` — constructed with a `gmail_v1.Gmail` instance (dependency injection). The 19 operations: `searchEmails`, `getMessageContent`, `getThread`, `getProfile`, `sendEmail`, `createDraft`, `listDrafts`, `sendDraft`, `deleteDraft`, `trashMessage`, `untrashMessage`, `modifyLabels`, `markAsRead`, `markAsUnread`, `listLabels`, `createLabel`, `deleteLabel`, `listAttachments`, `getAttachment`. Uses `mime.ts` for message assembly/parsing. All calls use `userId: "me"` — each instance is already account-scoped through its `auth`. | Against a hand-written fake Gmail API: assert request parameters and returned shapes; for `sendEmail`/`createDraft`, decode the raw message and check headers and body. |
| `client-registry.ts` | `ClientRegistry.getClient(alias)`: resolve the account from `AccountStore` (throw a clear error listing available aliases if unknown, or a "not authenticated — run `gmail-mcp auth add <alias>`" error if no credentials/token); build an `OAuth2Client` via `oauth.ts`; `refreshIfExpired(...)` persisting the new token via `AccountStore.saveToken`; wrap in a `GmailClient`; cache per alias for the process lifetime. | With fakes for `AccountStore` and `oauth`. |
| `tools.ts` | The 20 tool definitions. Every Gmail tool's `inputSchema` gains a required `account: string` ("Configured account alias, e.g. 'work'"). `gmail_list_accounts` takes no arguments. | Schema assertions (each Gmail tool has `account` required; `gmail_list_accounts` does not). |
| `server.ts` | Wire the MCP `Server`. `ListToolsRequestSchema` → return `tools`. `CallToolRequestSchema` → if `name === "gmail_list_accounts"`, return `AccountStore.list()` as pretty JSON; otherwise read `args.account`, `registry.getClient(account)`, dispatch to the matching `GmailClient` method with the remaining args, and format the result (mutations → human-readable string; reads → `JSON.stringify(result, null, 2)`). Catch all errors → `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`. Diagnostics to stderr only. | With a fake registry returning fake clients; assert dispatch routing and error formatting. |
| `cli.ts` | `gmail-mcp auth add <alias> [--force]`, `gmail-mcp auth list`, `gmail-mcp auth remove <alias>`. Uses `auth-flow.ts` and `AccountStore`. `add` refuses an existing alias unless `--force`. | Argument parsing → correct `AccountStore` / `auth-flow` calls (auth-flow stubbed). |
| `index.ts` | `#!/usr/bin/env node`. If `process.argv[2] === "auth"`, run the CLI; otherwise start the MCP server over stdio. | Smoke only. |

## 4. Request Flow

1. **`ListTools`** → returns all 20 tool definitions.
2. **`CallTool(name, args)`**:
   - `gmail_list_accounts` → `AccountStore.list()` → `[{ alias, email }]` as pretty JSON. No client needed.
   - Any other tool → read `args.account`; `registry.getClient(account)` (an unknown alias or missing auth surfaces as `isError: true` with the list of available aliases / the re-auth hint); call the matching `GmailClient` method with the rest of `args`; return the result using the same conventions as the original server (mutating operations return a human-readable success string; read operations return `JSON.stringify(result, null, 2)`).
3. Any thrown error is caught at dispatch and returned as `{ content: [{ type: "text", text: "Error: <message>" }], isError: true }`. All diagnostic logging goes to `console.error` (stderr); stdout stays clean for the stdio transport.

## 5. Auth CLI

- `gmail-mcp auth add work` — loads `credentials.json`; opens the browser; runs the local callback server on port 3000; exchanges the code; calls `users.getProfile` for the email; writes `~/.gmail-mcp/accounts/work.json`. Refuses if the alias already exists (suggests `auth remove` first); `--force` overwrites.
- `gmail-mcp auth list` — prints an `alias → email` table.
- `gmail-mcp auth remove work` — deletes `accounts/work.json`.
- Token auto-refresh happens transparently inside `ClientRegistry`, persisting the new token back to the alias file.
- **Optional, YAGNI-trimmable:** on startup, if a legacy `~/.gmail-mcp/token.json` exists and `accounts/` is empty, import it as alias `default` (resolving its email via `users.getProfile`). Include only if cheap; drop if it complicates the plan.

## 6. Error Handling

| Situation | Behaviour |
|---|---|
| `account` arg names an unknown alias | Tool returns `isError: true`, message: `Unknown account "<x>". Available: <list>. Add one with: gmail-mcp auth add <alias>`. |
| No `credentials.json` | Returns `isError: true` with a pointer to the setup steps and the expected path. |
| Account exists but token refresh fails | Returns `isError: true`: `Account "<x>" needs re-authentication. Run: gmail-mcp auth add <x> --force`. |
| Gmail API error | Caught at dispatch, returned as `isError: true` with the API message. |
| Any other thrown error | Same — caught at dispatch, `isError: true`. |
| All diagnostics | `console.error` (stderr) only. |

## 7. Testing & TDD Order

Every module is written test-first (red → green → refactor). No test touches the network.
Suggested cycle order:

1. `mime.ts` — round-trip `buildRawMessage` (with and without `cc`/`bcc`/`attachments`), `encodeBase64Url`/`decodeBase64Url`, `parseMessageBody` from single-part and multipart payloads, `text/html` fallback.
2. `accounts.ts` — `add` / `list` / `get` / `remove` / `saveToken` against a temp dir; `get` on a missing alias returns null; `add` then `list` round-trips `{ alias, email }`.
3. `oauth.ts` — `createOAuth2Client` from `installed` and `web` shapes; `refreshIfExpired` refreshes and calls `onRefresh` when `expiry_date` is in the past, no-ops when fresh; `loadOAuthCredentials` returns null when the file is absent.
4. `gmail-client.ts` — each of the 19 methods against a fake Gmail API: assert request params (`userId: "me"`, `q`, ids, `requestBody`) and returned shapes; `sendEmail`/`createDraft` decode the raw message and verify headers and body; `markAsRead`/`markAsUnread` delegate to `modifyLabels` with the `UNREAD` label.
5. `client-registry.ts` — `getClient` resolves and caches (second call returns the same instance, no second `AccountStore.get`); unknown alias throws the listed error; an expired token triggers a refresh and a persist via `AccountStore.saveToken`.
6. `tools.ts` / `server.ts` — all 20 tools present; every Gmail tool's schema has `account` required and `gmail_list_accounts` does not; `CallTool` dispatches by name and routes `args.account` to the right client (fake registry returning fake clients); `gmail_list_accounts` returns the store's list; thrown errors become `isError: true`.
7. `cli.ts` — argument parsing maps to the correct `AccountStore` / `auth-flow` calls; `auth add` on an existing alias without `--force` errors.

Then run `/mcp-server-dev:build-mcpb` to package the server as an `.mcpb` bundle with a manifest.

## 8. Package Scripts

`package.json` (ES modules, `bin: { "gmail-mcp": "dist/index.js" }`):

- `build` — `tsc`
- `test` — `vitest run`
- `test:watch` — `vitest`
- `start` — `node dist/index.js`
- `dev` — `tsc && node dist/index.js`
- `auth` — `node dist/index.js auth` (convenience wrapper)
- `prepare` — `npm run build`

## 9. Alternatives Considered & Rejected

- **Stateful "current account" switch tool** — hidden mutable state is error-prone for an LLM, race-prone across concurrent calls, and harder to test. Rejected in favour of an explicit `account` parameter.
- **Per-account namespaced tools** (`gmail_work_search`, `gmail_personal_search`, …) — tool count becomes 19 × N and the tool list churns whenever accounts change. Rejected.
- **Single combined `accounts.json` file** — read-modify-write races when one account's token refreshes while the CLI mutates another. Rejected in favour of one file per alias.
- **Modifying `gmail-mcp-server` in place** — the single-account assumptions are structural; refactoring in place is more friction than a clean build. Rejected, but the pure helpers are lifted from it.
- **Optional `account` with a default** vs. **required `account`** — chose required for predictability; can revisit if a default proves ergonomic.
