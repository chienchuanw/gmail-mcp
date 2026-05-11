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
