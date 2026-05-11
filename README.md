# gmail-mcp

Multi-account Gmail MCP server — read, send, search, and manage email across several Gmail accounts from Claude Code. Every tool takes an `account` alias so you choose which mailbox to act on.

## Setup

1. **Create a Google OAuth client** (one, shared by all your accounts): Google Cloud Console → create a project → enable the **Gmail API** → configure the **OAuth consent screen** (External) and add these scopes:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.compose
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/gmail.labels
   ```
   Add your Gmail address(es) under **Test users**. Then **Credentials → Create credentials → OAuth client ID → Desktop app** and **Download JSON**.

2. **Install and place credentials:**
   ```bash
   npm install && npm run build
   mkdir -p ~/.gmail-mcp
   cp /path/to/downloaded-credentials.json ~/.gmail-mcp/credentials.json
   ```

3. **Add one or more accounts** (opens a browser each time):
   ```bash
   node dist/index.js auth add work
   node dist/index.js auth add personal
   node dist/index.js auth list      # shows alias -> email
   ```
   Each `auth add` opens Google's consent screen, then redirects back to a local callback at `http://127.0.0.1:3000/oauth2callback` that the command is listening on — so port 3000 must be free while you're authorizing. (You don't need to configure any redirect URI in Google Cloud Console; Google allows any loopback redirect for "Desktop app" clients, and this server uses that port automatically.) Every account you add must also be listed under **Test users** on the consent screen.

4. **Register with Claude Code:**
   ```bash
   claude mcp add gmail -- node /absolute/path/to/gmail-mcp/dist/index.js
   ```

## Usage

Every Gmail tool takes an `account` parameter — the alias you chose in step 3. Discover configured accounts with `gmail_list_accounts`.

## Tools

`gmail_list_accounts`, plus per-account: `gmail_search`, `gmail_get_message`, `gmail_send`, `gmail_get_thread`, `gmail_get_profile`, `gmail_create_draft`, `gmail_list_drafts`, `gmail_send_draft`, `gmail_delete_draft`, `gmail_list_labels`, `gmail_create_label`, `gmail_delete_label`, `gmail_modify_labels`, `gmail_trash`, `gmail_untrash`, `gmail_mark_read`, `gmail_mark_unread`, `gmail_list_attachments`, `gmail_get_attachment`.

## Storage

```
~/.gmail-mcp/
├── credentials.json      # your shared Google OAuth client (never commit)
└── accounts/
    ├── work.json         # { alias, email, token }  (never commit)
    └── personal.json
```

Override the directory with `GMAIL_MCP_CONFIG_DIR`. Tokens auto-refresh; if refresh fails, re-run `gmail-mcp auth add <alias> --force`.

## Troubleshooting

- **`ERR_CONNECTION_REFUSED` / "localhost refused to connect" after authorizing** — the consent screen redirected back but nothing was listening. Make sure port **3000** is free when you run `auth add` (close anything using it, then re-run). You don't need to touch `redirect_uris` in `credentials.json` — the server ignores that field and always uses `http://127.0.0.1:3000/oauth2callback`.
- **"Access blocked: … has not completed the Google verification process"** — add the account's email under **Test users** on the OAuth consent screen, or, if it's already there, click *Advanced → Go to … (unsafe)* to proceed (expected while the app is in "Testing").
- **`gmail-mcp auth add` hangs** — you closed the browser tab without finishing. Press Ctrl-C and run it again.

## Development

```bash
npm test           # vitest
npm run build      # tsc -> dist/
npm run typecheck  # tsc --noEmit
```

## Packaging (MCPB)

`bash scripts/build-mcpb.sh` produces `build/gmail-mcp.mcpb` — a self-contained bundle (server code + Node deps) installable by dragging it onto Claude Desktop. The bundle runs the server in stdio mode; OAuth setup (`credentials.json` + `gmail-mcp auth add <alias>`) must still be done from a terminal as described above. The bundle's `config_dir` setting maps to `GMAIL_MCP_CONFIG_DIR`.
