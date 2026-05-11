# Multi-Account Gmail MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server in `/Users/chienchuanw/Documents/gmail-mcp` that lets Claude Code read, send, search, and manage email across multiple Gmail accounts, each selected by an explicit `account` alias parameter on every tool.

**Architecture:** TypeScript ES modules. Small single-purpose modules under `src/`: pure MIME/base64url helpers, a filesystem-backed `AccountStore` (one JSON file per alias under `~/.gmail-mcp/accounts/`), an OAuth layer over one shared `credentials.json`, an interactive auth CLI, a `GmailClient` wrapping the Gmail v1 SDK (constructor-injected for testing), a `ClientRegistry` that resolves an alias → refreshes its token → caches a `GmailClient`, pure request handlers, and a thin MCP stdio server. Built test-first with Vitest; the proven MIME assembly / body parsing / base64url logic is lifted from the existing `gmail-mcp-server` and wrapped in tests as the first cycle. Packaged as an `.mcpb` bundle at the end.

**Tech Stack:** TypeScript 5, Node 18+, `@modelcontextprotocol/sdk`, `googleapis`, `open`, Vitest.

**Working directory:** All paths are relative to `/Users/chienchuanw/Documents/gmail-mcp`. The git repository is already initialized (it contains one commit: the design spec under `docs/superpowers/specs/`).

**Spec:** `docs/superpowers/specs/2026-05-11-multi-account-gmail-mcp-design.md`

**Conventions for every task:** write the test(s) first, run them and watch them fail, implement the minimal code, run the full suite (`npm test`) and watch it pass, then `npx tsc --noEmit` to typecheck, then commit. Tests live next to source as `src/<name>.test.ts` and are excluded from the TypeScript build. Use `console.error` for all diagnostics (stdout must stay clean for the stdio transport).

**Deferred / out of scope (per spec §5):** auto-importing a legacy `~/.gmail-mcp/token.json` as an account. Not implemented in this plan; add later if wanted.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (temporary stub, replaced in Task 12)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gmail-mcp",
  "version": "0.1.0",
  "description": "Multi-account Gmail MCP server — read, send, search and manage email across several Gmail accounts.",
  "type": "module",
  "bin": { "gmail-mcp": "dist/index.js" },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js",
    "auth": "node dist/index.js auth",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "googleapis": "^144.0.0",
    "open": "^10.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": { "node": ">=18.0.0" }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 4: Create `src/index.ts` stub**

```ts
#!/usr/bin/env node
// Placeholder — replaced with the real entry point in a later task.
console.error("gmail-mcp (not yet implemented)");
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: dependencies install; the `prepare` script runs `tsc`, which compiles the stub `src/index.ts` into `dist/index.js` with no errors.

- [ ] **Step 6: Verify the test runner works with no tests yet**

Run: `npm test`
Expected: `No test files found, exiting with code 0` (passes because of `--passWithNoTests`).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/index.ts
git commit -m "chore: scaffold gmail-mcp project (package.json, tsconfig, deps)"
```

---

### Task 2: MIME helpers (`src/mime.ts`)

Pure functions, lifted from the existing `gmail-mcp-server`'s `gmail.ts`: base64url encode/decode, RFC 2822 raw-message assembly (with `multipart/mixed` when attachments are present), and message-body extraction (`text/plain`, falling back to `text/html`).

**Files:**
- Create: `src/mime.ts`
- Test: `src/mime.test.ts`

- [ ] **Step 1: Write the failing test**

`src/mime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeBase64Url, decodeBase64Url, buildRawMessage, parseMessageBody } from "./mime.js";

describe("base64url", () => {
  it("round-trips a unicode string with +, /, = bytes", () => {
    const s = "Hello, 世界! +/=";
    expect(decodeBase64Url(encodeBase64Url(s)).toString("utf-8")).toBe(s);
  });

  it("produces URL-safe output with no padding", () => {
    const out = encodeBase64Url("???>>>");
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe("buildRawMessage", () => {
  it("builds a simple plain-text message", () => {
    const raw = buildRawMessage({ to: "a@b.com", subject: "Hi", body: "Hello there" });
    const decoded = decodeBase64Url(raw).toString("utf-8");
    expect(decoded).toContain("To: a@b.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Content-Type: text/plain; charset=utf-8");
    expect(decoded).toContain("Hello there");
    expect(decoded).toContain("\r\n");
  });

  it("includes Cc and Bcc when provided", () => {
    const raw = buildRawMessage({ to: "a@b.com", subject: "S", body: "B", cc: "c@d.com", bcc: "e@f.com" });
    const decoded = decodeBase64Url(raw).toString("utf-8");
    expect(decoded).toContain("Cc: c@d.com");
    expect(decoded).toContain("Bcc: e@f.com");
  });

  it("builds a multipart/mixed message with an attachment", () => {
    const raw = buildRawMessage({
      to: "a@b.com",
      subject: "S",
      body: "B",
      attachments: [{ filename: "x.txt", content: "aGVsbG8=", mimeType: "text/plain" }],
    });
    const decoded = decodeBase64Url(raw).toString("utf-8");
    expect(decoded).toContain("Content-Type: multipart/mixed; boundary=");
    expect(decoded).toContain('Content-Disposition: attachment; filename="x.txt"');
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain("aGVsbG8=");
  });
});

describe("parseMessageBody", () => {
  it("returns an empty string for an undefined payload", () => {
    expect(parseMessageBody(undefined)).toBe("");
  });

  it("reads a single-part body", () => {
    const data = Buffer.from("plain body").toString("base64url");
    expect(parseMessageBody({ body: { data } })).toBe("plain body");
  });

  it("prefers text/plain among multipart parts", () => {
    const plain = Buffer.from("the plain part").toString("base64url");
    const html = Buffer.from("<p>html</p>").toString("base64url");
    expect(
      parseMessageBody({
        parts: [
          { mimeType: "text/html", body: { data: html } },
          { mimeType: "text/plain", body: { data: plain } },
        ],
      }),
    ).toBe("the plain part");
  });

  it("falls back to text/html when there is no text/plain part", () => {
    const html = Buffer.from("<p>only html</p>").toString("base64url");
    expect(parseMessageBody({ parts: [{ mimeType: "text/html", body: { data: html } }] })).toBe("<p>only html</p>");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/mime.test.ts`
Expected: FAIL — `src/mime.ts` does not exist yet (module resolution error).

- [ ] **Step 3: Write `src/mime.ts`**

```ts
/** Minimal structural shape of a Gmail message part (subset of gmail_v1.Schema$MessagePart). */
export interface MessagePart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MessagePart[] | null;
}

export interface MessageAttachment {
  /** Suggested filename for the attachment. */
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  /** MIME type, e.g. "application/pdf". */
  mimeType: string;
}

export interface RawMessageInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  attachments?: MessageAttachment[];
}

export function encodeBase64Url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64url");
}

export function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data, "base64url");
}

/** Build an RFC 2822 message and base64url-encode it for the Gmail API `raw` field. */
export function buildRawMessage(input: RawMessageInput): string {
  const headers = [`To: ${input.to}`, `Subject: ${input.subject}`, "MIME-Version: 1.0"];
  if (input.cc) headers.push(`Cc: ${input.cc}`);
  if (input.bcc) headers.push(`Bcc: ${input.bcc}`);

  let lines: string[];
  if (input.attachments && input.attachments.length > 0) {
    const boundary = `boundary_${Date.now()}`;
    lines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ];
    for (const att of input.attachments) {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "",
        att.content,
      );
    }
    lines.push(`--${boundary}--`);
  } else {
    lines = [...headers, "Content-Type: text/plain; charset=utf-8", "", input.body];
  }

  return encodeBase64Url(lines.join("\r\n"));
}

/** Extract a readable body from a message payload: prefer text/plain, then text/html. */
export function parseMessageBody(payload: MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).toString("utf-8");
  }
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data).toString("utf-8");
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) return decodeBase64Url(html.body.data).toString("utf-8");
  }
  return "";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `mime.test.ts` cases green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/mime.ts src/mime.test.ts
git commit -m "feat: add pure MIME assembly, body parsing, and base64url helpers"
```

---

### Task 3: Config paths (`src/config.ts`)

Resolve the config directory (`~/.gmail-mcp`, overridable via `GMAIL_MCP_CONFIG_DIR`, with `~` expansion) and derive the credentials path, accounts directory, and per-alias account file path.

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

- [ ] **Step 1: Write the failing test**

`src/config.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import { getConfigDir, getCredentialsPath, getAccountsDir, getAccountPath } from "./config.js";

const ORIGINAL = process.env.GMAIL_MCP_CONFIG_DIR;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GMAIL_MCP_CONFIG_DIR;
  else process.env.GMAIL_MCP_CONFIG_DIR = ORIGINAL;
});

describe("config", () => {
  it("defaults to ~/.gmail-mcp", () => {
    delete process.env.GMAIL_MCP_CONFIG_DIR;
    expect(getConfigDir()).toBe(path.join(os.homedir(), ".gmail-mcp"));
  });

  it("honors GMAIL_MCP_CONFIG_DIR", () => {
    process.env.GMAIL_MCP_CONFIG_DIR = path.join(os.tmpdir(), "gmail-mcp-x");
    expect(getConfigDir()).toBe(path.join(os.tmpdir(), "gmail-mcp-x"));
  });

  it("expands a leading ~ in GMAIL_MCP_CONFIG_DIR", () => {
    process.env.GMAIL_MCP_CONFIG_DIR = "~/custom-gmail";
    expect(getConfigDir()).toBe(path.join(os.homedir(), "custom-gmail"));
  });

  it("derives credentials path, accounts dir, and account file path", () => {
    process.env.GMAIL_MCP_CONFIG_DIR = path.join(os.tmpdir(), "gmail-mcp-y");
    const base = path.join(os.tmpdir(), "gmail-mcp-y");
    expect(getCredentialsPath()).toBe(path.join(base, "credentials.json"));
    expect(getAccountsDir()).toBe(path.join(base, "accounts"));
    expect(getAccountPath("work")).toBe(path.join(base, "accounts", "work.json"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `src/config.ts` does not exist yet.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import * as os from "os";
import * as path from "path";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function getConfigDir(): string {
  const fromEnv = process.env.GMAIL_MCP_CONFIG_DIR;
  return fromEnv && fromEnv.length > 0 ? expandHome(fromEnv) : path.join(os.homedir(), ".gmail-mcp");
}

export function getCredentialsPath(): string {
  return path.join(getConfigDir(), "credentials.json");
}

export function getAccountsDir(): string {
  return path.join(getConfigDir(), "accounts");
}

export function getAccountPath(alias: string): string {
  return path.join(getAccountsDir(), `${alias}.json`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config path resolution (GMAIL_MCP_CONFIG_DIR, ~ expansion)"
```

---

### Task 4: Account store (`src/accounts.ts`)

A filesystem-backed registry: one `<alias>.json` file per account under the accounts directory, each holding `{ alias, email, token }`.

**Files:**
- Create: `src/accounts.ts`
- Test: `src/accounts.test.ts`

- [ ] **Step 1: Write the failing test**

`src/accounts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AccountStore, type AccountRecord } from "./accounts.js";

let baseDir: string;
let accountsDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-mcp-test-"));
  accountsDir = path.join(baseDir, "accounts");
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

const rec = (alias: string, email: string): AccountRecord => ({
  alias,
  email,
  token: { access_token: "a", refresh_token: "r", expiry_date: 123 },
});

describe("AccountStore", () => {
  it("list() returns [] when the accounts dir does not exist", () => {
    expect(new AccountStore(accountsDir).list()).toEqual([]);
  });

  it("add() then list() returns summaries", () => {
    const s = new AccountStore(accountsDir);
    s.add(rec("work", "w@x.com"));
    s.add(rec("home", "h@x.com"));
    expect(s.list().sort((a, b) => a.alias.localeCompare(b.alias))).toEqual([
      { alias: "home", email: "h@x.com" },
      { alias: "work", email: "w@x.com" },
    ]);
  });

  it("get() returns the full record, or null when absent", () => {
    const s = new AccountStore(accountsDir);
    s.add(rec("work", "w@x.com"));
    expect(s.get("work")).toEqual(rec("work", "w@x.com"));
    expect(s.get("nope")).toBeNull();
  });

  it("has() reflects existence", () => {
    const s = new AccountStore(accountsDir);
    expect(s.has("work")).toBe(false);
    s.add(rec("work", "w@x.com"));
    expect(s.has("work")).toBe(true);
  });

  it("remove() deletes the record and is a no-op when already absent", () => {
    const s = new AccountStore(accountsDir);
    s.add(rec("work", "w@x.com"));
    s.remove("work");
    expect(s.has("work")).toBe(false);
    expect(() => s.remove("work")).not.toThrow();
  });

  it("saveToken() replaces only the token", () => {
    const s = new AccountStore(accountsDir);
    s.add(rec("work", "w@x.com"));
    s.saveToken("work", { access_token: "new", refresh_token: "r2", expiry_date: 999 });
    expect(s.get("work")).toEqual({
      alias: "work",
      email: "w@x.com",
      token: { access_token: "new", refresh_token: "r2", expiry_date: 999 },
    });
  });

  it("saveToken() throws for an unknown alias", () => {
    const s = new AccountStore(accountsDir);
    expect(() => s.saveToken("nope", { access_token: "x" })).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/accounts.test.ts`
Expected: FAIL — `src/accounts.ts` does not exist yet.

- [ ] **Step 3: Write `src/accounts.ts`**

```ts
import * as fs from "fs";
import * as path from "path";

export interface TokenData {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  id_token?: string;
}

export interface AccountRecord {
  alias: string;
  email: string;
  token: TokenData;
}

export interface AccountSummary {
  alias: string;
  email: string;
}

export class AccountStore {
  constructor(private readonly accountsDir: string) {}

  private fileFor(alias: string): string {
    return path.join(this.accountsDir, `${alias}.json`);
  }

  list(): AccountSummary[] {
    if (!fs.existsSync(this.accountsDir)) return [];
    return fs
      .readdirSync(this.accountsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const rec = JSON.parse(fs.readFileSync(path.join(this.accountsDir, f), "utf-8")) as AccountRecord;
        return { alias: rec.alias, email: rec.email };
      });
  }

  get(alias: string): AccountRecord | null {
    const p = this.fileFor(alias);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as AccountRecord;
  }

  has(alias: string): boolean {
    return fs.existsSync(this.fileFor(alias));
  }

  add(record: AccountRecord): void {
    fs.mkdirSync(this.accountsDir, { recursive: true });
    fs.writeFileSync(this.fileFor(record.alias), JSON.stringify(record, null, 2));
  }

  remove(alias: string): void {
    const p = this.fileFor(alias);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  saveToken(alias: string, token: TokenData): void {
    const rec = this.get(alias);
    if (!rec) throw new Error(`No such account: ${alias}`);
    rec.token = token;
    this.add(rec);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/accounts.ts src/accounts.test.ts
git commit -m "feat: add AccountStore (one JSON file per account alias)"
```

---

### Task 5: OAuth layer (`src/oauth.ts`)

Load the shared `credentials.json`, build a configured `OAuth2Client`, and refresh a token when it has expired (notifying the caller so the new token can be persisted).

**Files:**
- Create: `src/oauth.ts`
- Test: `src/oauth.test.ts`

- [ ] **Step 1: Write the failing test**

`src/oauth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { google } from "googleapis";
import { loadOAuthCredentials, createOAuth2Client, refreshIfExpired, GMAIL_SCOPES } from "./oauth.js";

describe("loadOAuthCredentials", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-mcp-test-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("returns null when the file is absent", () => {
    expect(loadOAuthCredentials(path.join(dir, "credentials.json"))).toBeNull();
  });

  it("parses the file when present", () => {
    const p = path.join(dir, "credentials.json");
    const content = { installed: { client_id: "id", client_secret: "sec", redirect_uris: ["http://localhost:3000/oauth2callback"] } };
    fs.writeFileSync(p, JSON.stringify(content));
    expect(loadOAuthCredentials(p)).toEqual(content);
  });
});

describe("GMAIL_SCOPES", () => {
  it("includes the modify and labels scopes", () => {
    expect(GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.labels");
  });
});

describe("createOAuth2Client", () => {
  it("accepts the 'installed' shape", () => {
    const c = createOAuth2Client({ installed: { client_id: "id", client_secret: "sec", redirect_uris: ["http://x/cb"] } });
    expect(c).toBeInstanceOf(google.auth.OAuth2);
  });

  it("accepts the 'web' shape", () => {
    const c = createOAuth2Client({ web: { client_id: "wid", client_secret: "wsec", redirect_uris: ["http://x/cb"] } });
    expect(c).toBeInstanceOf(google.auth.OAuth2);
  });

  it("throws for an invalid shape", () => {
    expect(() => createOAuth2Client({} as never)).toThrow(/credentials\.json/i);
  });
});

describe("refreshIfExpired", () => {
  it("refreshes and calls onRefresh when the token is expired", async () => {
    const newToken = { access_token: "fresh", refresh_token: "r", expiry_date: Date.now() + 3_600_000 };
    const fake: any = {
      credentials: { access_token: "old", refresh_token: "r", expiry_date: Date.now() - 1000 },
      setCredentials(c: any) { this.credentials = c; },
      async refreshAccessToken() { return { credentials: newToken }; },
    };
    const onRefresh = vi.fn();
    await refreshIfExpired(fake, onRefresh);
    expect(onRefresh).toHaveBeenCalledWith(newToken);
    expect(fake.credentials).toEqual(newToken);
  });

  it("does nothing when the token is still fresh", async () => {
    const fake: any = {
      credentials: { access_token: "ok", expiry_date: Date.now() + 3_600_000 },
      setCredentials: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    const onRefresh = vi.fn();
    await refreshIfExpired(fake, onRefresh);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(fake.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does nothing when there is no expiry_date", async () => {
    const fake: any = { credentials: { access_token: "ok" }, setCredentials: vi.fn(), refreshAccessToken: vi.fn() };
    const onRefresh = vi.fn();
    await refreshIfExpired(fake, onRefresh);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(fake.refreshAccessToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/oauth.test.ts`
Expected: FAIL — `src/oauth.ts` does not exist yet.

- [ ] **Step 3: Write `src/oauth.ts`**

```ts
import * as fs from "fs";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getCredentialsPath } from "./config.js";
import type { TokenData } from "./accounts.js";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
];

export interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

export interface OAuthCredentialsFile {
  installed?: OAuthClientConfig;
  web?: OAuthClientConfig;
}

export function loadOAuthCredentials(credentialsPath: string = getCredentialsPath()): OAuthCredentialsFile | null {
  if (!fs.existsSync(credentialsPath)) return null;
  return JSON.parse(fs.readFileSync(credentialsPath, "utf-8")) as OAuthCredentialsFile;
}

export function createOAuth2Client(creds: OAuthCredentialsFile): OAuth2Client {
  const cfg = creds.installed ?? creds.web;
  if (!cfg) throw new Error("Invalid credentials.json: expected an 'installed' or 'web' key");
  return new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    cfg.redirect_uris?.[0] ?? "http://localhost:3000/oauth2callback",
  );
}

/** If the client's token has expired, refresh it and invoke onRefresh with the new token. */
export async function refreshIfExpired(client: OAuth2Client, onRefresh: (token: TokenData) => void): Promise<void> {
  const expiry = client.credentials.expiry_date;
  if (expiry && expiry <= Date.now()) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    onRefresh(credentials as TokenData);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/oauth.ts src/oauth.test.ts
git commit -m "feat: add OAuth layer (load credentials, build client, refresh on expiry)"
```

---

### Task 6: Interactive auth flow (`src/auth-flow.ts`)

Pieces for the browser OAuth flow: build the consent URL, exchange the returned code for tokens, fetch the account email, run a one-shot local callback server, and a `runInteractiveAuth` orchestrator. The pure pieces and the callback server are unit-tested; `fetchAccountEmail` and `runInteractiveAuth` (which open a browser) are exercised by the manual smoke in Task 12.

**Files:**
- Create: `src/auth-flow.ts`
- Test: `src/auth-flow.test.ts`

- [ ] **Step 1: Write the failing test**

`src/auth-flow.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import * as http from "http";
import { buildAuthUrl, exchangeCodeForToken, waitForAuthCode } from "./auth-flow.js";

describe("buildAuthUrl", () => {
  it("requests offline access, the consent prompt, and the Gmail scopes", () => {
    const fake: any = { generateAuthUrl: vi.fn().mockReturnValue("https://auth.example/url") };
    const url = buildAuthUrl(fake);
    expect(url).toBe("https://auth.example/url");
    const arg = fake.generateAuthUrl.mock.calls[0][0];
    expect(arg.access_type).toBe("offline");
    expect(arg.prompt).toBe("consent");
    expect(arg.scope).toContain("https://www.googleapis.com/auth/gmail.modify");
  });
});

describe("exchangeCodeForToken", () => {
  it("exchanges the code and sets the credentials on the client", async () => {
    const tokens = { access_token: "a", refresh_token: "r", expiry_date: 1 };
    const fake: any = { getToken: vi.fn().mockResolvedValue({ tokens }), setCredentials: vi.fn() };
    const out = await exchangeCodeForToken(fake, "the-code");
    expect(fake.getToken).toHaveBeenCalledWith("the-code");
    expect(fake.setCredentials).toHaveBeenCalledWith(tokens);
    expect(out).toEqual(tokens);
  });
});

describe("waitForAuthCode", () => {
  it("resolves with the code from the OAuth callback request", async () => {
    const port = 39517;
    const pending = waitForAuthCode(port);
    await new Promise((r) => setTimeout(r, 50)); // let the server start listening
    await new Promise<void>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/oauth2callback?code=XYZ`, (res) => {
          res.resume();
          res.on("end", () => resolve());
        })
        .on("error", reject);
    });
    await expect(pending).resolves.toBe("XYZ");
  });

  it("rejects when the callback arrives without a code", async () => {
    const port = 39518;
    const pending = waitForAuthCode(port);
    await new Promise((r) => setTimeout(r, 50));
    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/oauth2callback?error=access_denied`, (res) => {
        res.resume();
        res.on("end", () => resolve());
      });
    });
    await expect(pending).rejects.toThrow(/authorization code/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/auth-flow.test.ts`
Expected: FAIL — `src/auth-flow.ts` does not exist yet.

- [ ] **Step 3: Write `src/auth-flow.ts`**

```ts
import * as http from "http";
import { URL } from "url";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { GMAIL_SCOPES } from "./oauth.js";
import type { TokenData } from "./accounts.js";

export function buildAuthUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({ access_type: "offline", scope: GMAIL_SCOPES, prompt: "consent" });
}

export async function exchangeCodeForToken(client: OAuth2Client, code: string): Promise<TokenData> {
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return tokens as TokenData;
}

export async function fetchAccountEmail(client: OAuth2Client): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data.emailAddress ?? "";
}

/** Start a one-shot HTTP server on `port` and resolve with the OAuth `code` from /oauth2callback. */
export function waitForAuthCode(port = 3000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Authenticated.</h1><p>You can close this window.</p></body></html>");
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h1>No authorization code received.</h1></body></html>");
        server.close();
        reject(new Error("No authorization code received"));
      }
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

/** Full interactive flow: open the browser, capture the code, exchange it, and fetch the email. */
export async function runInteractiveAuth(
  client: OAuth2Client,
  opts?: { openBrowser?: (url: string) => void; port?: number },
): Promise<{ email: string; token: TokenData }> {
  const port = opts?.port ?? 3000;
  const authUrl = buildAuthUrl(client);
  const openBrowser =
    opts?.openBrowser ??
    ((url: string) => {
      void import("open").then((m) => m.default(url));
    });
  console.error(`\nAuthorize this app by visiting:\n${authUrl}\n`);
  openBrowser(authUrl);
  const code = await waitForAuthCode(port);
  const token = await exchangeCodeForToken(client, code);
  const email = await fetchAccountEmail(client);
  return { email, token };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth-flow.ts src/auth-flow.test.ts
git commit -m "feat: add interactive OAuth flow (auth URL, code exchange, callback server)"
```

---

### Task 7: Gmail client (`src/gmail-client.ts`)

A wrapper around the Gmail v1 SDK. The constructor takes a `gmail_v1.Gmail` instance (dependency injection) so tests pass a hand-written fake. Each instance is already account-scoped via its `auth`, so every call uses `userId: "me"`. 19 operations.

**Files:**
- Create: `src/gmail-client.ts`
- Test: `src/gmail-client.test.ts`

- [ ] **Step 1: Write the failing test**

`src/gmail-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { gmail_v1 } from "googleapis";
import { GmailClient } from "./gmail-client.js";

function fakeGmail(overrides: Record<string, unknown> = {}): { gmail: gmail_v1.Gmail; calls: Record<string, any> } {
  const calls: Record<string, any> = {};
  const rec = (key: string, ret: unknown) =>
    vi.fn(async (params: any) => {
      calls[key] = params;
      return { data: ret };
    });
  const defaultMessageGet = {
    id: "m1",
    threadId: "t1",
    snippet: "snip",
    labelIds: ["INBOX"],
    payload: {
      headers: [
        { name: "Subject", value: "Hello" },
        { name: "From", value: "a@b.com" },
        { name: "To", value: "me@x.com" },
        { name: "Date", value: "Mon, 1 Jan 2024" },
      ],
      body: { data: Buffer.from("the body").toString("base64url") },
    },
  };
  const gmail: any = {
    users: {
      messages: {
        get: rec("messages.get", overrides["messages.get"] ?? defaultMessageGet),
        list: rec("messages.list", overrides["messages.list"] ?? { messages: [{ id: "m1" }] }),
        send: rec("messages.send", { id: "sent1" }),
        trash: rec("messages.trash", { id: "m1", labelIds: ["TRASH"] }),
        untrash: rec("messages.untrash", { id: "m1", labelIds: ["INBOX"] }),
        modify: rec("messages.modify", { id: "m1", labelIds: [] }),
        attachments: { get: rec("attachments.get", { data: "QkFTRTY0" }) },
      },
      drafts: {
        create: rec("drafts.create", { id: "d1" }),
        list: rec("drafts.list", { drafts: [{ id: "d1" }] }),
        send: rec("drafts.send", { id: "sentFromDraft" }),
        delete: rec("drafts.delete", {}),
      },
      labels: {
        list: rec("labels.list", { labels: [{ id: "Label_1", name: "Work" }] }),
        create: rec("labels.create", { id: "Label_2", name: "New" }),
        delete: rec("labels.delete", {}),
      },
      threads: { get: rec("threads.get", { id: "t1", messages: [{ id: "m1" }] }) },
      getProfile: rec("getProfile", { emailAddress: "me@x.com", messagesTotal: 42 }),
    },
  };
  return { gmail: gmail as gmail_v1.Gmail, calls };
}

describe("GmailClient", () => {
  it("getMessageContent extracts headers and body", async () => {
    const { gmail, calls } = fakeGmail();
    const out = await new GmailClient(gmail).getMessageContent("m1");
    expect(calls["messages.get"]).toMatchObject({ userId: "me", id: "m1", format: "full" });
    expect(out).toMatchObject({
      id: "m1",
      threadId: "t1",
      subject: "Hello",
      from: "a@b.com",
      to: "me@x.com",
      date: "Mon, 1 Jan 2024",
      snippet: "snip",
      labels: ["INBOX"],
      body: "the body",
    });
  });

  it("searchEmails lists then summarizes each message", async () => {
    const { gmail, calls } = fakeGmail();
    const out = await new GmailClient(gmail).searchEmails("is:unread", 5);
    expect(calls["messages.list"]).toMatchObject({ userId: "me", q: "is:unread", maxResults: 5 });
    expect(out).toEqual([{ id: "m1", threadId: "t1", subject: "Hello", from: "a@b.com", date: "Mon, 1 Jan 2024", snippet: "snip" }]);
  });

  it("sendEmail builds a raw message and posts it with the threadId", async () => {
    const { gmail, calls } = fakeGmail();
    const res = await new GmailClient(gmail).sendEmail({ to: "x@y.com", subject: "Hi", body: "Body text", threadId: "t9" });
    expect(calls["messages.send"].userId).toBe("me");
    expect(calls["messages.send"].requestBody.threadId).toBe("t9");
    const decoded = Buffer.from(calls["messages.send"].requestBody.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: x@y.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Body text");
    expect(res).toEqual({ id: "sent1" });
  });

  it("createDraft wraps the raw message under `message`", async () => {
    const { gmail, calls } = fakeGmail();
    const res = await new GmailClient(gmail).createDraft({ to: "x@y.com", subject: "S", body: "B" });
    const decoded = Buffer.from(calls["drafts.create"].requestBody.message.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: x@y.com");
    expect(res).toEqual({ id: "d1" });
  });

  it("listDrafts returns the drafts array", async () => {
    const { gmail } = fakeGmail();
    expect(await new GmailClient(gmail).listDrafts(3)).toEqual([{ id: "d1" }]);
  });

  it("sendDraft posts the draft id", async () => {
    const { gmail, calls } = fakeGmail();
    const res = await new GmailClient(gmail).sendDraft("d1");
    expect(calls["drafts.send"]).toMatchObject({ userId: "me", requestBody: { id: "d1" } });
    expect(res).toEqual({ id: "sentFromDraft" });
  });

  it("deleteDraft deletes by id", async () => {
    const { gmail, calls } = fakeGmail();
    await new GmailClient(gmail).deleteDraft("d1");
    expect(calls["drafts.delete"]).toMatchObject({ userId: "me", id: "d1" });
  });

  it("trashMessage and untrashMessage call the right endpoints", async () => {
    const { gmail, calls } = fakeGmail();
    const c = new GmailClient(gmail);
    await c.trashMessage("m1");
    expect(calls["messages.trash"]).toMatchObject({ userId: "me", id: "m1" });
    await c.untrashMessage("m1");
    expect(calls["messages.untrash"]).toMatchObject({ userId: "me", id: "m1" });
  });

  it("modifyLabels passes add/remove arrays", async () => {
    const { gmail, calls } = fakeGmail();
    await new GmailClient(gmail).modifyLabels("m1", ["A"], ["B"]);
    expect(calls["messages.modify"]).toMatchObject({ userId: "me", id: "m1", requestBody: { addLabelIds: ["A"], removeLabelIds: ["B"] } });
  });

  it("markAsRead removes UNREAD; markAsUnread adds UNREAD", async () => {
    const { gmail, calls } = fakeGmail();
    const c = new GmailClient(gmail);
    await c.markAsRead("m1");
    expect(calls["messages.modify"].requestBody).toMatchObject({ removeLabelIds: ["UNREAD"] });
    await c.markAsUnread("m1");
    expect(calls["messages.modify"].requestBody).toMatchObject({ addLabelIds: ["UNREAD"] });
  });

  it("listLabels, createLabel, deleteLabel", async () => {
    const { gmail, calls } = fakeGmail();
    const c = new GmailClient(gmail);
    expect(await c.listLabels()).toEqual([{ id: "Label_1", name: "Work" }]);
    const created = await c.createLabel("New");
    expect(calls["labels.create"]).toMatchObject({
      userId: "me",
      requestBody: { name: "New", labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    expect(created).toEqual({ id: "Label_2", name: "New" });
    await c.deleteLabel("Label_2");
    expect(calls["labels.delete"]).toMatchObject({ userId: "me", id: "Label_2" });
  });

  it("getThread returns the thread", async () => {
    const { gmail, calls } = fakeGmail();
    expect(await new GmailClient(gmail).getThread("t1")).toEqual({ id: "t1", messages: [{ id: "m1" }] });
    expect(calls["threads.get"]).toMatchObject({ userId: "me", id: "t1" });
  });

  it("getProfile returns the profile", async () => {
    const { gmail } = fakeGmail();
    expect(await new GmailClient(gmail).getProfile()).toEqual({ emailAddress: "me@x.com", messagesTotal: 42 });
  });

  it("listAttachments walks nested parts", async () => {
    const { gmail } = fakeGmail({
      "messages.get": {
        payload: {
          parts: [
            { mimeType: "text/plain", body: {} },
            { mimeType: "multipart/mixed", parts: [{ filename: "a.pdf", mimeType: "application/pdf", body: { attachmentId: "att1" } }] },
            { filename: "b.png", mimeType: "image/png", body: { attachmentId: "att2" } },
          ],
        },
      },
    });
    const out = await new GmailClient(gmail).listAttachments("m1");
    expect(out).toEqual([
      { filename: "a.pdf", mimeType: "application/pdf", attachmentId: "att1" },
      { filename: "b.png", mimeType: "image/png", attachmentId: "att2" },
    ]);
  });

  it("getAttachment returns the base64 data and passes the ids", async () => {
    const { gmail, calls } = fakeGmail();
    expect(await new GmailClient(gmail).getAttachment("m1", "att1")).toBe("QkFTRTY0");
    expect(calls["attachments.get"]).toMatchObject({ userId: "me", messageId: "m1", id: "att1" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/gmail-client.test.ts`
Expected: FAIL — `src/gmail-client.ts` does not exist yet.

- [ ] **Step 3: Write `src/gmail-client.ts`**

```ts
import type { gmail_v1 } from "googleapis";
import { buildRawMessage, parseMessageBody, type MessageAttachment } from "./mime.js";

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface EmailContent extends EmailSummary {
  to: string;
  body: string;
  labels: string[];
}

export interface SendOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  attachments?: MessageAttachment[];
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

export class GmailClient {
  constructor(private readonly gmail: gmail_v1.Gmail) {}

  private headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  async getMessageContent(messageId: string): Promise<EmailContent> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const msg = res.data;
    const headers = msg.payload?.headers ?? undefined;
    return {
      id: msg.id ?? "",
      threadId: msg.threadId ?? "",
      subject: this.headerValue(headers, "Subject"),
      from: this.headerValue(headers, "From"),
      to: this.headerValue(headers, "To"),
      date: this.headerValue(headers, "Date"),
      body: parseMessageBody(msg.payload ?? undefined),
      snippet: msg.snippet ?? "",
      labels: msg.labelIds ?? [],
    };
  }

  async searchEmails(query: string, maxResults = 10): Promise<EmailSummary[]> {
    const res = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const out: EmailSummary[] = [];
    for (const m of res.data.messages ?? []) {
      if (!m.id) continue;
      const c = await this.getMessageContent(m.id);
      out.push({ id: c.id, threadId: c.threadId, subject: c.subject, from: c.from, date: c.date, snippet: c.snippet });
    }
    return out;
  }

  async sendEmail(opts: SendOptions): Promise<gmail_v1.Schema$Message> {
    const raw = buildRawMessage({ to: opts.to, subject: opts.subject, body: opts.body, cc: opts.cc, bcc: opts.bcc, attachments: opts.attachments });
    const res = await this.gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: opts.threadId } });
    return res.data;
  }

  async createDraft(opts: SendOptions): Promise<gmail_v1.Schema$Draft> {
    const raw = buildRawMessage({ to: opts.to, subject: opts.subject, body: opts.body, cc: opts.cc, bcc: opts.bcc, attachments: opts.attachments });
    const res = await this.gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId: opts.threadId } } });
    return res.data;
  }

  async listDrafts(maxResults = 10): Promise<gmail_v1.Schema$Draft[]> {
    const res = await this.gmail.users.drafts.list({ userId: "me", maxResults });
    return res.data.drafts ?? [];
  }

  async sendDraft(draftId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    return res.data;
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.gmail.users.drafts.delete({ userId: "me", id: draftId });
  }

  async trashMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.trash({ userId: "me", id: messageId });
    return res.data;
  }

  async untrashMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.untrash({ userId: "me", id: messageId });
    return res.data;
  }

  async modifyLabels(messageId: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds, removeLabelIds } });
    return res.data;
  }

  async markAsRead(messageId: string): Promise<gmail_v1.Schema$Message> {
    return this.modifyLabels(messageId, undefined, ["UNREAD"]);
  }

  async markAsUnread(messageId: string): Promise<gmail_v1.Schema$Message> {
    return this.modifyLabels(messageId, ["UNREAD"], undefined);
  }

  async listLabels(): Promise<gmail_v1.Schema$Label[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    return res.data.labels ?? [];
  }

  async createLabel(name: string): Promise<gmail_v1.Schema$Label> {
    const res = await this.gmail.users.labels.create({
      userId: "me",
      requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    return res.data;
  }

  async deleteLabel(labelId: string): Promise<void> {
    await this.gmail.users.labels.delete({ userId: "me", id: labelId });
  }

  async getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
    const res = await this.gmail.users.threads.get({ userId: "me", id: threadId });
    return res.data;
  }

  async getProfile(): Promise<gmail_v1.Schema$Profile> {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    return res.data;
  }

  async listAttachments(messageId: string): Promise<AttachmentInfo[]> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const out: AttachmentInfo[] = [];
    const walk = (parts: gmail_v1.Schema$MessagePart[] | undefined): void => {
      for (const p of parts ?? []) {
        if (p.filename && p.body?.attachmentId) {
          out.push({ filename: p.filename, mimeType: p.mimeType ?? "application/octet-stream", attachmentId: p.body.attachmentId });
        }
        if (p.parts) walk(p.parts);
      }
    };
    walk(res.data.payload?.parts ?? undefined);
    return out;
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<string> {
    const res = await this.gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
    return res.data.data ?? "";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `gmail-client.test.ts` cases green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/gmail-client.ts src/gmail-client.test.ts
git commit -m "feat: add GmailClient wrapping the Gmail v1 SDK (19 operations, DI for tests)"
```

---

### Task 8: Client registry (`src/client-registry.ts`)

Resolves an account alias to a ready-to-use `GmailClient`: looks up the record, builds an `OAuth2Client`, refreshes the token if expired (persisting the new token), wraps it in a `GmailClient`, and caches per alias. Collaborators are injected with sensible defaults so the registry can be tested without network or filesystem.

**Files:**
- Create: `src/client-registry.ts`
- Test: `src/client-registry.test.ts`

- [ ] **Step 1: Write the failing test**

`src/client-registry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ClientRegistry } from "./client-registry.js";
import type { AccountStore } from "./accounts.js";

function fakeStore(records: Record<string, any>): AccountStore {
  return {
    get: vi.fn((alias: string) => records[alias] ?? null),
    list: vi.fn(() => Object.values(records).map((r: any) => ({ alias: r.alias, email: r.email }))),
    saveToken: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    has: vi.fn((a: string) => a in records),
  } as unknown as AccountStore;
}

const creds = { installed: { client_id: "i", client_secret: "s", redirect_uris: ["http://x/cb"] } };

function makeRegistry(store: AccountStore, opts: { refreshThrows?: boolean; loadCredentials?: () => any } = {}) {
  const oauthClient: any = {
    credentials: {},
    setCredentials(c: any) {
      this.credentials = { ...this.credentials, ...c };
    },
  };
  const buildGmail = vi.fn(() => ({ marker: "gmail-client" }) as any);
  const refreshIfExpired = vi.fn(async (_client: any, onRefresh: (t: any) => void) => {
    if (opts.refreshThrows) throw new Error("refresh failed");
    onRefresh({ access_token: "fresh" });
  });
  const reg = new ClientRegistry(store, {
    loadCredentials: opts.loadCredentials ?? (() => creds),
    createClient: () => oauthClient,
    refreshIfExpired,
    buildGmail,
  });
  return { reg, buildGmail, refreshIfExpired };
}

describe("ClientRegistry.getClient", () => {
  it("resolves an account, refreshes the token, persists it, and returns a GmailClient", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: { access_token: "old", expiry_date: 1 } } });
    const { reg, buildGmail } = makeRegistry(store);
    const c = await reg.getClient("work");
    expect(buildGmail).toHaveBeenCalledTimes(1);
    expect(store.saveToken).toHaveBeenCalledWith("work", { access_token: "fresh" });
    expect(c).toEqual({ marker: "gmail-client" });
  });

  it("caches: a second getClient does not re-resolve or rebuild", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: {} } });
    const { reg, buildGmail } = makeRegistry(store);
    const a = await reg.getClient("work");
    const b = await reg.getClient("work");
    expect(a).toBe(b);
    expect(buildGmail).toHaveBeenCalledTimes(1);
    expect(store.get as any).toHaveBeenCalledTimes(1);
  });

  it("throws a helpful error for an unknown alias, listing what is available", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: {} } });
    const { reg } = makeRegistry(store);
    await expect(reg.getClient("nope")).rejects.toThrow(/Unknown account "nope"[\s\S]*work[\s\S]*gmail-mcp auth add/);
  });

  it("throws when credentials.json is missing", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: {} } });
    const { reg } = makeRegistry(store, { loadCredentials: () => null });
    await expect(reg.getClient("work")).rejects.toThrow(/credentials\.json/i);
  });

  it("translates a refresh failure into a re-auth instruction", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: { expiry_date: 1 } } });
    const { reg } = makeRegistry(store, { refreshThrows: true });
    await expect(reg.getClient("work")).rejects.toThrow(/re-authentication[\s\S]*gmail-mcp auth add work --force/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/client-registry.test.ts`
Expected: FAIL — `src/client-registry.ts` does not exist yet.

- [ ] **Step 3: Write `src/client-registry.ts`**

```ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { AccountStore, type TokenData } from "./accounts.js";
import { GmailClient } from "./gmail-client.js";
import {
  loadOAuthCredentials,
  createOAuth2Client,
  refreshIfExpired,
  type OAuthCredentialsFile,
} from "./oauth.js";

export interface RegistryDeps {
  loadCredentials: () => OAuthCredentialsFile | null;
  createClient: (creds: OAuthCredentialsFile) => OAuth2Client;
  refreshIfExpired: (client: OAuth2Client, onRefresh: (token: TokenData) => void) => Promise<void>;
  buildGmail: (auth: OAuth2Client) => GmailClient;
}

const DEFAULT_DEPS: RegistryDeps = {
  loadCredentials: () => loadOAuthCredentials(),
  createClient: createOAuth2Client,
  refreshIfExpired,
  buildGmail: (auth) => new GmailClient(google.gmail({ version: "v1", auth })),
};

export class ClientRegistry {
  private readonly cache = new Map<string, GmailClient>();
  private readonly deps: RegistryDeps;

  constructor(private readonly store: AccountStore, deps: Partial<RegistryDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async getClient(alias: string): Promise<GmailClient> {
    const cached = this.cache.get(alias);
    if (cached) return cached;

    const record = this.store.get(alias);
    if (!record) {
      const available = this.store.list().map((a) => a.alias);
      throw new Error(
        `Unknown account "${alias}". Available: ${available.length ? available.join(", ") : "(none)"}. ` +
          `Add one with: gmail-mcp auth add <alias>`,
      );
    }

    const creds = this.deps.loadCredentials();
    if (!creds) {
      throw new Error(
        "No credentials.json found. Place your Google OAuth client file at ~/.gmail-mcp/credentials.json (see the README setup steps).",
      );
    }

    const oauth = this.deps.createClient(creds);
    oauth.setCredentials(record.token);
    try {
      await this.deps.refreshIfExpired(oauth, (token) => this.store.saveToken(alias, token));
    } catch {
      throw new Error(`Account "${alias}" needs re-authentication. Run: gmail-mcp auth add ${alias} --force`);
    }

    const client = this.deps.buildGmail(oauth);
    this.cache.set(alias, client);
    return client;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client-registry.ts src/client-registry.test.ts
git commit -m "feat: add ClientRegistry (alias -> refreshed, cached GmailClient)"
```

---

### Task 9: Tool definitions (`src/tools.ts`)

The 20 MCP tool definitions: `gmail_list_accounts` (no parameters) plus the 19 ported Gmail tools, each with a required `account` string parameter prepended to its original schema. A small helper avoids repeating the `account` boilerplate.

**Files:**
- Create: `src/tools.ts`
- Test: `src/tools.test.ts`

- [ ] **Step 1: Write the failing test**

`src/tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";

describe("tools", () => {
  it("exposes 20 uniquely-named tools including gmail_list_accounts", () => {
    expect(tools).toHaveLength(20);
    const names = tools.map((t) => t.name);
    expect(names).toContain("gmail_list_accounts");
    expect(new Set(names).size).toBe(20);
  });

  it("gmail_list_accounts takes no parameters", () => {
    const t = tools.find((t) => t.name === "gmail_list_accounts")!;
    expect(t.inputSchema.properties).toEqual({});
    expect(t.inputSchema.required ?? []).toEqual([]);
  });

  it("every other tool requires an 'account' string parameter", () => {
    for (const t of tools) {
      if (t.name === "gmail_list_accounts") continue;
      expect((t.inputSchema.properties as Record<string, any>).account).toMatchObject({ type: "string" });
      expect(t.inputSchema.required).toContain("account");
    }
  });

  it("preserves the original required params (account is prepended)", () => {
    const search = tools.find((t) => t.name === "gmail_search")!;
    expect(search.inputSchema.required).toEqual(["account", "query"]);
    const send = tools.find((t) => t.name === "gmail_send")!;
    expect(send.inputSchema.required).toEqual(["account", "to", "subject", "body"]);
    const listDrafts = tools.find((t) => t.name === "gmail_list_drafts")!;
    expect(listDrafts.inputSchema.required).toEqual(["account"]);
  });

  it("includes all 19 Gmail tool names", () => {
    const names = new Set(tools.map((t) => t.name));
    for (const n of [
      "gmail_search", "gmail_get_message", "gmail_send", "gmail_get_thread", "gmail_get_profile",
      "gmail_create_draft", "gmail_list_drafts", "gmail_send_draft", "gmail_delete_draft",
      "gmail_list_labels", "gmail_create_label", "gmail_delete_label", "gmail_modify_labels",
      "gmail_trash", "gmail_untrash", "gmail_mark_read", "gmail_mark_unread",
      "gmail_list_attachments", "gmail_get_attachment",
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tools.test.ts`
Expected: FAIL — `src/tools.ts` does not exist yet.

- [ ] **Step 3: Write `src/tools.ts`**

```ts
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  items?: { type: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
  };
}

const ACCOUNT_PROPERTY: JsonSchemaProperty = {
  type: "string",
  description: "Configured account alias to act on (e.g. 'work'). See gmail_list_accounts.",
};

function gmailTool(
  name: string,
  description: string,
  properties: Record<string, JsonSchemaProperty>,
  required: string[],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT_PROPERTY, ...properties },
      required: ["account", ...required],
    },
  };
}

const STR = (description: string): JsonSchemaProperty => ({ type: "string", description });
const NUM = (description: string): JsonSchemaProperty => ({ type: "number", description });
const STR_ARRAY = (description: string): JsonSchemaProperty => ({ type: "array", items: { type: "string" }, description });

export const tools: ToolDefinition[] = [
  {
    name: "gmail_list_accounts",
    description: "List the configured Gmail account aliases and their email addresses.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  gmailTool("gmail_search", "Search emails using Gmail query syntax (e.g. 'from:a@b.com is:unread after:2024/01/01').", {
    query: STR("Gmail search query"),
    maxResults: NUM("Maximum number of results (default 10)"),
  }, ["query"]),
  gmailTool("gmail_get_message", "Get the full content of an email by its message ID.", {
    messageId: STR("The message ID"),
  }, ["messageId"]),
  gmailTool("gmail_send", "Send an email.", {
    to: STR("Recipient email address"),
    subject: STR("Email subject"),
    body: STR("Email body (plain text)"),
    cc: STR("CC recipients (comma-separated)"),
    bcc: STR("BCC recipients (comma-separated)"),
    threadId: STR("Thread ID to reply within (for threading)"),
  }, ["to", "subject", "body"]),
  gmailTool("gmail_get_thread", "Get all messages in an email thread.", {
    threadId: STR("The thread ID"),
  }, ["threadId"]),
  gmailTool("gmail_get_profile", "Get the account's Gmail profile (email address, message totals, etc.).", {}, []),
  gmailTool("gmail_create_draft", "Create a draft email.", {
    to: STR("Recipient email address"),
    subject: STR("Email subject"),
    body: STR("Email body (plain text)"),
    cc: STR("CC recipients (comma-separated)"),
    bcc: STR("BCC recipients (comma-separated)"),
    threadId: STR("Thread ID to reply within (for threading)"),
  }, ["to", "subject", "body"]),
  gmailTool("gmail_list_drafts", "List draft emails.", {
    maxResults: NUM("Maximum number of drafts to return (default 10)"),
  }, []),
  gmailTool("gmail_send_draft", "Send an existing draft.", {
    draftId: STR("The ID of the draft to send"),
  }, ["draftId"]),
  gmailTool("gmail_delete_draft", "Delete a draft email.", {
    draftId: STR("The ID of the draft to delete"),
  }, ["draftId"]),
  gmailTool("gmail_list_labels", "List all labels in the mailbox.", {}, []),
  gmailTool("gmail_create_label", "Create a new label.", {
    name: STR("Name for the new label"),
  }, ["name"]),
  gmailTool("gmail_delete_label", "Delete a label.", {
    labelId: STR("The ID of the label to delete"),
  }, ["labelId"]),
  gmailTool("gmail_modify_labels", "Add or remove labels from an email.", {
    messageId: STR("The message ID"),
    addLabels: STR_ARRAY("Label IDs to add"),
    removeLabels: STR_ARRAY("Label IDs to remove"),
  }, ["messageId"]),
  gmailTool("gmail_trash", "Move an email to trash.", {
    messageId: STR("The ID of the email to trash"),
  }, ["messageId"]),
  gmailTool("gmail_untrash", "Restore an email from trash.", {
    messageId: STR("The ID of the email to untrash"),
  }, ["messageId"]),
  gmailTool("gmail_mark_read", "Mark an email as read.", {
    messageId: STR("The ID of the email to mark as read"),
  }, ["messageId"]),
  gmailTool("gmail_mark_unread", "Mark an email as unread.", {
    messageId: STR("The ID of the email to mark as unread"),
  }, ["messageId"]),
  gmailTool("gmail_list_attachments", "List all attachments in an email.", {
    messageId: STR("The message ID"),
  }, ["messageId"]),
  gmailTool("gmail_get_attachment", "Download an attachment from an email (returns base64-encoded data).", {
    messageId: STR("The message ID"),
    attachmentId: STR("The attachment ID (from gmail_list_attachments)"),
  }, ["messageId", "attachmentId"]),
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/tools.test.ts
git commit -m "feat: add the 20 MCP tool definitions (19 Gmail tools + gmail_list_accounts)"
```

---

### Task 10: Request handlers (`src/handlers.ts`)

Pure handler functions, independent of the MCP SDK: `handleListTools()` returns the tool list; `handleCallTool(name, args, { store, registry })` handles `gmail_list_accounts` directly, otherwise resolves `args.account` via the registry and dispatches to the matching `GmailClient` method, formatting the result and turning any thrown error into `{ isError: true }`.

**Files:**
- Create: `src/handlers.ts`
- Test: `src/handlers.test.ts`

- [ ] **Step 1: Write the failing test**

`src/handlers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleCallTool, handleListTools } from "./handlers.js";
import type { AccountStore } from "./accounts.js";
import type { ClientRegistry } from "./client-registry.js";

const makeStore = () => ({ list: vi.fn(() => [{ alias: "work", email: "w@x.com" }]) }) as unknown as AccountStore;

const makeClient = () => ({
  searchEmails: vi.fn(async () => [{ id: "m1", threadId: "t", subject: "S", from: "f", date: "d", snippet: "x" }]),
  getMessageContent: vi.fn(async (id: string) => ({ id, subject: "S" })),
  sendEmail: vi.fn(async () => ({ id: "sent1" })),
  createDraft: vi.fn(async () => ({ id: "d1" })),
  listDrafts: vi.fn(async () => [{ id: "d1" }]),
  sendDraft: vi.fn(async () => ({ id: "s2" })),
  deleteDraft: vi.fn(async () => {}),
  trashMessage: vi.fn(async () => ({})),
  untrashMessage: vi.fn(async () => ({})),
  markAsRead: vi.fn(async () => ({})),
  markAsUnread: vi.fn(async () => ({})),
  modifyLabels: vi.fn(async () => ({})),
  listLabels: vi.fn(async () => [{ id: "L1" }]),
  createLabel: vi.fn(async () => ({ id: "L2" })),
  deleteLabel: vi.fn(async () => {}),
  getThread: vi.fn(async () => ({ id: "t1" })),
  listAttachments: vi.fn(async () => [{ filename: "a", mimeType: "m", attachmentId: "x" }]),
  getAttachment: vi.fn(async () => "QkFTRTY0"),
  getProfile: vi.fn(async () => ({ emailAddress: "w@x.com" })),
});

const makeRegistry = (client: any, opts: { onGet?: (a: string) => void } = {}) =>
  ({
    getClient: vi.fn(async (alias: string) => {
      opts.onGet?.(alias);
      if (alias === "bad") throw new Error('Unknown account "bad". Available: work.');
      return client;
    }),
  }) as unknown as ClientRegistry;

describe("handleListTools", () => {
  it("returns the 20 tools", async () => {
    expect((await handleListTools()).tools).toHaveLength(20);
  });
});

describe("handleCallTool", () => {
  it("gmail_list_accounts returns the store list without calling the registry", async () => {
    const store = makeStore();
    const registry = makeRegistry(makeClient());
    const res = await handleCallTool("gmail_list_accounts", {}, { store, registry });
    expect(JSON.parse(res.content[0].text)).toEqual([{ alias: "work", email: "w@x.com" }]);
    expect(registry.getClient).not.toHaveBeenCalled();
    expect(res.isError).toBeFalsy();
  });

  it("routes args.account through the registry and dispatches to the client method", async () => {
    let seen = "";
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_search",
      { account: "work", query: "is:unread", maxResults: 3 },
      { store: makeStore(), registry: makeRegistry(client, { onGet: (a) => (seen = a) }) },
    );
    expect(seen).toBe("work");
    expect(client.searchEmails).toHaveBeenCalledWith("is:unread", 3);
    expect(JSON.parse(res.content[0].text)).toHaveLength(1);
    expect(res.isError).toBeFalsy();
  });

  it("gmail_search defaults maxResults to 10", async () => {
    const client = makeClient();
    await handleCallTool("gmail_search", { account: "work", query: "q" }, { store: makeStore(), registry: makeRegistry(client) });
    expect(client.searchEmails).toHaveBeenCalledWith("q", 10);
  });

  it("gmail_send returns a human-readable confirmation containing the message id", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_send",
      { account: "work", to: "a@b.com", subject: "S", body: "B" },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.sendEmail).toHaveBeenCalledWith({ account: "work", to: "a@b.com", subject: "S", body: "B" });
    expect(res.content[0].text).toMatch(/sent1/);
    expect(res.isError).toBeFalsy();
  });

  it("gmail_mark_read calls markAsRead and confirms", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_mark_read",
      { account: "work", messageId: "m1" },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.markAsRead).toHaveBeenCalledWith("m1");
    expect(res.content[0].text).toMatch(/read/i);
  });

  it("gmail_get_attachment returns the base64 data embedded in JSON", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_get_attachment",
      { account: "work", messageId: "m1", attachmentId: "att1" },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(JSON.parse(res.content[0].text)).toMatchObject({ messageId: "m1", attachmentId: "att1", data: "QkFTRTY0" });
  });

  it("missing account → isError", async () => {
    const res = await handleCallTool("gmail_search", { query: "x" }, { store: makeStore(), registry: makeRegistry(makeClient()) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/account/i);
  });

  it("a registry error surfaces as isError with the message", async () => {
    const res = await handleCallTool("gmail_search", { account: "bad", query: "x" }, { store: makeStore(), registry: makeRegistry(makeClient()) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown account "bad"/);
  });

  it("an unknown tool name → isError", async () => {
    const res = await handleCallTool("gmail_nope", { account: "work" }, { store: makeStore(), registry: makeRegistry(makeClient()) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown tool/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/handlers.test.ts`
Expected: FAIL — `src/handlers.ts` does not exist yet.

- [ ] **Step 3: Write `src/handlers.ts`**

```ts
import { tools } from "./tools.js";
import type { AccountStore } from "./accounts.js";
import type { ClientRegistry } from "./client-registry.js";
import type { GmailClient } from "./gmail-client.js";

export interface ToolDeps {
  store: AccountStore;
  registry: ClientRegistry;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2));
}

async function dispatch(client: GmailClient, name: string, args: Record<string, any>): Promise<ToolResult> {
  switch (name) {
    case "gmail_search":
      return json(await client.searchEmails(args.query, args.maxResults ?? 10));
    case "gmail_get_message":
      return json(await client.getMessageContent(args.messageId));
    case "gmail_send": {
      const r = await client.sendEmail(args);
      return text(`Email sent successfully. Message ID: ${r.id}`);
    }
    case "gmail_get_thread":
      return json(await client.getThread(args.threadId));
    case "gmail_get_profile":
      return json(await client.getProfile());
    case "gmail_create_draft": {
      const r = await client.createDraft(args);
      return text(`Draft created successfully. Draft ID: ${r.id}`);
    }
    case "gmail_list_drafts":
      return json(await client.listDrafts(args.maxResults ?? 10));
    case "gmail_send_draft": {
      const r = await client.sendDraft(args.draftId);
      return text(`Draft sent successfully. Message ID: ${r.id}`);
    }
    case "gmail_delete_draft":
      await client.deleteDraft(args.draftId);
      return text("Draft deleted successfully.");
    case "gmail_list_labels":
      return json(await client.listLabels());
    case "gmail_create_label": {
      const l = await client.createLabel(args.name);
      return text(`Label created successfully. ID: ${l.id}`);
    }
    case "gmail_delete_label":
      await client.deleteLabel(args.labelId);
      return text("Label deleted successfully.");
    case "gmail_modify_labels":
      await client.modifyLabels(args.messageId, args.addLabels, args.removeLabels);
      return text("Labels modified successfully.");
    case "gmail_trash":
      await client.trashMessage(args.messageId);
      return text("Email moved to trash.");
    case "gmail_untrash":
      await client.untrashMessage(args.messageId);
      return text("Email removed from trash.");
    case "gmail_mark_read":
      await client.markAsRead(args.messageId);
      return text("Email marked as read.");
    case "gmail_mark_unread":
      await client.markAsUnread(args.messageId);
      return text("Email marked as unread.");
    case "gmail_list_attachments":
      return json(await client.listAttachments(args.messageId));
    case "gmail_get_attachment": {
      const data = await client.getAttachment(args.messageId, args.attachmentId);
      return json({ messageId: args.messageId, attachmentId: args.attachmentId, data });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleListTools(): Promise<{ tools: typeof tools }> {
  return { tools };
}

export async function handleCallTool(name: string, args: Record<string, any>, deps: ToolDeps): Promise<ToolResult> {
  try {
    if (name === "gmail_list_accounts") return json(deps.store.list());
    const alias = args.account;
    if (typeof alias !== "string" || alias.length === 0) {
      throw new Error("Missing required 'account' parameter (a configured account alias — see gmail_list_accounts).");
    }
    const client = await deps.registry.getClient(alias);
    return await dispatch(client, name, args);
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/handlers.ts src/handlers.test.ts
git commit -m "feat: add pure tool request handlers (list, dispatch, error wrapping)"
```

---

### Task 11: Auth CLI (`src/cli.ts`)

`gmail-mcp auth add <alias> [--force]`, `gmail-mcp auth list`, `gmail-mcp auth remove <alias>`. Collaborators (store, credentials loader, OAuth client factory, interactive auth) are injected with real defaults so the CLI can be tested without a browser or filesystem.

**Files:**
- Create: `src/cli.ts`
- Test: `src/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`src/cli.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runCli } from "./cli.js";

function fakeStore(initial: Record<string, any> = {}) {
  const records: Record<string, any> = { ...initial };
  return {
    has: vi.fn((a: string) => a in records),
    add: vi.fn((r: any) => { records[r.alias] = r; }),
    remove: vi.fn((a: string) => { delete records[a]; }),
    list: vi.fn(() => Object.values(records).map((r: any) => ({ alias: r.alias, email: r.email }))),
    get: vi.fn((a: string) => records[a] ?? null),
  } as any;
}

const creds = { installed: { client_id: "i", client_secret: "s", redirect_uris: ["http://x/cb"] } };
const okDeps = (extra: any = {}) => ({ loadCredentials: () => creds, createClient: () => ({}) as any, doAuth: vi.fn(async () => ({ email: "new@x.com", token: { access_token: "a", refresh_token: "r", expiry_date: 1 } })), ...extra });

describe("runCli auth add", () => {
  it("runs the OAuth flow and stores the new account", async () => {
    const store = fakeStore();
    const deps = okDeps();
    await runCli(["add", "work"], { store, ...deps });
    expect(deps.doAuth).toHaveBeenCalled();
    expect(store.add).toHaveBeenCalledWith({ alias: "work", email: "new@x.com", token: { access_token: "a", refresh_token: "r", expiry_date: 1 } });
  });

  it("refuses an existing alias without --force", async () => {
    const store = fakeStore({ work: { alias: "work", email: "old@x.com", token: {} } });
    await expect(runCli(["add", "work"], { store, ...okDeps() })).rejects.toThrow(/already exists/);
  });

  it("overwrites an existing alias with --force", async () => {
    const store = fakeStore({ work: { alias: "work", email: "old@x.com", token: {} } });
    const deps = okDeps({ doAuth: vi.fn(async () => ({ email: "new@x.com", token: { access_token: "a" } })) });
    await runCli(["add", "work", "--force"], { store, ...deps });
    expect(store.add).toHaveBeenCalledWith({ alias: "work", email: "new@x.com", token: { access_token: "a" } });
  });

  it("errors when credentials.json is missing", async () => {
    await expect(runCli(["add", "work"], { store: fakeStore(), ...okDeps({ loadCredentials: () => null }) })).rejects.toThrow(/credentials\.json/i);
  });

  it("errors when no alias is given", async () => {
    await expect(runCli(["add"], { store: fakeStore(), ...okDeps() })).rejects.toThrow(/Usage/i);
  });
});

describe("runCli auth list", () => {
  it("resolves without throwing when accounts are present", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: {} } });
    await expect(runCli(["list"], { store })).resolves.toBeUndefined();
    expect(store.list).toHaveBeenCalled();
  });

  it("resolves without throwing when there are no accounts", async () => {
    await expect(runCli(["list"], { store: fakeStore() })).resolves.toBeUndefined();
  });
});

describe("runCli auth remove", () => {
  it("removes an existing account", async () => {
    const store = fakeStore({ work: { alias: "work", email: "w@x.com", token: {} } });
    await runCli(["remove", "work"], { store });
    expect(store.remove).toHaveBeenCalledWith("work");
  });

  it("errors for an unknown account", async () => {
    await expect(runCli(["remove", "nope"], { store: fakeStore() })).rejects.toThrow(/No such account/);
  });
});

describe("runCli", () => {
  it("errors on an unknown subcommand", async () => {
    await expect(runCli(["frobnicate"], { store: fakeStore() })).rejects.toThrow(/Unknown auth subcommand/);
  });

  it("errors when no subcommand is given", async () => {
    await expect(runCli([], { store: fakeStore() })).rejects.toThrow(/Unknown auth subcommand/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL — `src/cli.ts` does not exist yet.

- [ ] **Step 3: Write `src/cli.ts`**

```ts
import { AccountStore } from "./accounts.js";
import { loadOAuthCredentials, createOAuth2Client } from "./oauth.js";
import { runInteractiveAuth } from "./auth-flow.js";
import { getAccountsDir, getCredentialsPath } from "./config.js";

export interface CliDeps {
  store: AccountStore;
  loadCredentials: typeof loadOAuthCredentials;
  createClient: typeof createOAuth2Client;
  doAuth: typeof runInteractiveAuth;
}

function resolveDeps(partial: Partial<CliDeps>): CliDeps {
  return {
    store: partial.store ?? new AccountStore(getAccountsDir()),
    loadCredentials: partial.loadCredentials ?? loadOAuthCredentials,
    createClient: partial.createClient ?? createOAuth2Client,
    doAuth: partial.doAuth ?? runInteractiveAuth,
  };
}

export async function runCli(argv: string[], depsOverride: Partial<CliDeps> = {}): Promise<void> {
  const deps = resolveDeps(depsOverride);
  const [subcommand, ...rest] = argv;

  if (subcommand === "add") {
    const force = rest.includes("--force");
    const alias = rest.find((a) => !a.startsWith("--"));
    if (!alias) throw new Error("Usage: gmail-mcp auth add <alias> [--force]");
    if (deps.store.has(alias) && !force) {
      throw new Error(`Account "${alias}" already exists. Use --force to overwrite, or remove it first: gmail-mcp auth remove ${alias}`);
    }
    const creds = deps.loadCredentials();
    if (!creds) {
      throw new Error(`No credentials.json found at ${getCredentialsPath()}. Place your Google OAuth client file there (see the README setup steps).`);
    }
    const client = deps.createClient(creds);
    const { email, token } = await deps.doAuth(client);
    deps.store.add({ alias, email, token });
    console.error(`Added account "${alias}" (${email}).`);
    return;
  }

  if (subcommand === "list") {
    const accounts = deps.store.list();
    if (accounts.length === 0) {
      console.error("No accounts configured. Add one with: gmail-mcp auth add <alias>");
      return;
    }
    for (const a of accounts) console.error(`${a.alias}\t${a.email}`);
    return;
  }

  if (subcommand === "remove") {
    const alias = rest[0];
    if (!alias) throw new Error("Usage: gmail-mcp auth remove <alias>");
    if (!deps.store.has(alias)) throw new Error(`No such account: ${alias}`);
    deps.store.remove(alias);
    console.error(`Removed account "${alias}".`);
    return;
  }

  throw new Error(`Unknown auth subcommand: ${subcommand ?? "(none)"}. Use one of: add | list | remove`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add auth CLI (add/list/remove accounts)"
```

---

### Task 12: MCP server wiring, entry point, build, and smoke test (`src/server.ts`, `src/index.ts`)

Thin glue: `createServer()` wires the SDK request schemas to the pure handlers; `startStdioServer()` connects it over stdio. `index.ts` routes `auth ...` to the CLI and everything else to the server. Then build and a manual smoke test.

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts` (replace the Task 1 stub)
- Test: `src/server.test.ts`

- [ ] **Step 1: Write the failing test**

`src/server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createServer } from "./server.js";

describe("createServer", () => {
  it("returns a Server instance without throwing when given defaults are overridden", () => {
    const fakeStore: any = { list: () => [] };
    const fakeRegistry: any = { getClient: async () => ({}) };
    const server = createServer({ store: fakeStore, registry: fakeRegistry });
    expect(server).toBeTruthy();
    expect(typeof (server as any).connect).toBe("function");
  });
});
```

(Behavioural coverage of request dispatch lives in `handlers.test.ts`; this test just confirms the wiring constructs cleanly. The end-to-end stdio path is verified by the manual smoke test below.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server.test.ts`
Expected: FAIL — `src/server.ts` does not exist yet.

- [ ] **Step 3: Write `src/server.ts`**

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AccountStore } from "./accounts.js";
import { ClientRegistry } from "./client-registry.js";
import { getAccountsDir } from "./config.js";
import { handleCallTool, handleListTools } from "./handlers.js";

export function createServer(deps?: { store?: AccountStore; registry?: ClientRegistry }): Server {
  const store = deps?.store ?? new AccountStore(getAccountsDir());
  const registry = deps?.registry ?? new ClientRegistry(store);

  const server = new Server({ name: "gmail-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => handleListTools());

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleCallTool(request.params.name, (request.params.arguments ?? {}) as Record<string, any>, { store, registry }),
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("gmail-mcp server running on stdio");
}
```

If TypeScript complains that the `handleListTools()` result is not assignable to the SDK's expected `ListToolsResult`, change the first handler to `async () => handleListTools() as unknown as { tools: unknown[] }` — the runtime shape is correct (each tool is `{ name, description, inputSchema: { type: "object", ... } }`).

- [ ] **Step 4: Replace `src/index.ts` with the real entry point**

```ts
#!/usr/bin/env node
import { startStdioServer } from "./server.js";
import { runCli } from "./cli.js";

async function main(): Promise<void> {
  if (process.argv[2] === "auth") {
    await runCli(process.argv.slice(3));
  } else {
    await startStdioServer();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — full suite green (all `*.test.ts`).

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `dist/` is populated (`dist/index.js`, `dist/server.js`, etc.).

- [ ] **Step 7: Manual smoke test — CLI**

Run: `node dist/index.js auth`
Expected: exits with an error message `Unknown auth subcommand: (none). Use one of: add | list | remove` (proves the CLI path is wired).

Run: `node dist/index.js auth list`
Expected: prints `No accounts configured. Add one with: gmail-mcp auth add <alias>` (assuming no real `~/.gmail-mcp/accounts/`), or your existing aliases. Exits 0.

- [ ] **Step 8: Manual smoke test — server handshake**

Run:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/index.js
```
Expected: stderr shows `gmail-mcp server running on stdio`; stdout emits a JSON-RPC `initialize` result and then a `tools/list` result whose `tools` array has 20 entries (you'll see `gmail_list_accounts`, `gmail_search`, … in the output). The process stays open after — press Ctrl-C to exit.

- [ ] **Step 9: Commit**

```bash
git add src/server.ts src/index.ts src/server.test.ts
git commit -m "feat: wire MCP stdio server and CLI-aware entry point"
```

---

### Task 13: README and final polish

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# gmail-mcp

Multi-account Gmail MCP server — read, send, search, and manage email across several Gmail accounts from Claude Code. Every tool takes an `account` alias so you choose which mailbox to act on.

## Setup

1. **Create a Google OAuth client** (one, shared by all your accounts): Google Cloud Console → create a project → enable the **Gmail API** → configure the **OAuth consent screen** (External) and add these scopes:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.compose
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/gmail.labels
   ```
   Add your Gmail address(es) under **Test users**. Then **Credentials → Create credentials → OAuth client ID → Desktop app** and **Download JSON**.

2. **Install and place credentials:**
   ```bash
   npm install && npm run build
   mkdir -p ~/.gmail-mcp
   cp /path/to/downloaded-credentials.json ~/.gmail-mcp/credentials.json
   ```

3. **Add one or more accounts** (opens a browser each time):
   ```bash
   node dist/index.js auth add work
   node dist/index.js auth add personal
   node dist/index.js auth list      # shows alias -> email
   ```

4. **Register with Claude Code:**
   ```bash
   claude mcp add gmail -- node /absolute/path/to/gmail-mcp/dist/index.js
   ```

## Usage

Every Gmail tool takes an `account` parameter — the alias you chose in step 3. Discover configured accounts with `gmail_list_accounts`.

## Tools

`gmail_list_accounts`, plus per-account: `gmail_search`, `gmail_get_message`, `gmail_send`, `gmail_get_thread`, `gmail_get_profile`, `gmail_create_draft`, `gmail_list_drafts`, `gmail_send_draft`, `gmail_delete_draft`, `gmail_list_labels`, `gmail_create_label`, `gmail_delete_label`, `gmail_modify_labels`, `gmail_trash`, `gmail_untrash`, `gmail_mark_read`, `gmail_mark_unread`, `gmail_list_attachments`, `gmail_get_attachment`.

## Storage

```
~/.gmail-mcp/
├── credentials.json      # your shared Google OAuth client (never commit)
└── accounts/
    ├── work.json         # { alias, email, token }  (never commit)
    └── personal.json
```

Override the directory with `GMAIL_MCP_CONFIG_DIR`. Tokens auto-refresh; if refresh fails, re-run `gmail-mcp auth add <alias> --force`.

## Development

```bash
npm test           # vitest
npm run build      # tsc -> dist/
npm run typecheck  # tsc --noEmit
```
````

- [ ] **Step 2: Verify the build still works with README present**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README (setup, multi-account usage, storage layout)"
```

---

### Task 14: Package as an MCPB bundle

Use the `/mcp-server-dev:build-mcpb` skill to wrap the built server as an `.mcpb` bundle.

- [ ] **Step 1: Invoke the build-mcpb skill**

Run the `/mcp-server-dev:build-mcpb` skill against this project. Provide it:
- **Server type:** Node, stdio transport. Entry point: `dist/index.js` run with **no arguments** (the `auth` subcommand is for terminal use only and is not exposed through the bundle).
- **Tools:** the 20 defined in `src/tools.ts`.
- **Configuration:** the server reads `~/.gmail-mcp/credentials.json` and `~/.gmail-mcp/accounts/*.json`; the directory is overridable via the `GMAIL_MCP_CONFIG_DIR` environment variable. The user must complete the OAuth setup (see README) and run `gmail-mcp auth add <alias>` from a terminal before the bundle is useful.
- **Build step:** `npm install && npm run build` must run before packaging so `dist/` exists.

Follow the skill's prompts to produce the manifest and bundle.

- [ ] **Step 2: Verify the bundle**

Follow the skill's verification steps (e.g. validating the manifest and confirming the bundle loads and lists 20 tools). Then commit whatever artifacts/manifest the skill produced:

```bash
git add -A
git commit -m "build: package gmail-mcp as an .mcpb bundle"
```

---

## Notes for the implementer

- **Behaviour change from the original `gmail-mcp-server`:** `gmail_get_attachment` returns the *full* base64 attachment data (as JSON `{ messageId, attachmentId, data }`) rather than the original's truncated-to-100-chars string, which was not usable. This is intentional.
- **`gmail_send`/`gmail_create_draft` and the `account` arg:** `handlers.ts` passes the whole `args` object (which includes `account`) to `GmailClient.sendEmail`/`createDraft`; those methods only read `to/subject/body/cc/bcc/attachments/threadId`, so the extra `account` field is harmless.
- **`.js` import extensions:** this is intentional — the project is `"module": "NodeNext"`, so runtime ESM imports must carry `.js` extensions even though the source files are `.ts`. Vitest resolves them to the `.ts` sources automatically.
- If `npm install` warns about `prepare`/`tsc` on a fresh clone before `src/` is fully populated, that only matters in Task 1 (where the stub `src/index.ts` exists) — later clones will have the full source and build cleanly.
