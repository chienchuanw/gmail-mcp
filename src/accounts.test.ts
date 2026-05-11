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
