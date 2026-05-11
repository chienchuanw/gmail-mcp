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
