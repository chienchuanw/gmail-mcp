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
