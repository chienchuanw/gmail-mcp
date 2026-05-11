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
