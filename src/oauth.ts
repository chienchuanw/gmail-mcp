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

/** Port the interactive auth flow's local callback server listens on. */
export const OAUTH_CALLBACK_PORT = 3000;

/**
 * Redirect URI used for the interactive auth flow. We always use a loopback
 * address with this port and path because that is exactly what the local
 * callback server (see auth-flow.ts) listens on. We deliberately ignore the
 * `redirect_uris` in credentials.json — a downloaded "Desktop app" client lists
 * `http://localhost` (port 80, no path), which would never reach our server.
 * Google permits any loopback redirect for Desktop clients, so this works.
 */
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/oauth2callback`;

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
  return new google.auth.OAuth2(cfg.client_id, cfg.client_secret, OAUTH_REDIRECT_URI);
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
