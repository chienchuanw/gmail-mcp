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
