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
