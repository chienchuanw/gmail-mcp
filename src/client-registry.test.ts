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
