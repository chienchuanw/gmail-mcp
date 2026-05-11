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
