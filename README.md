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

## Development

```bash
npm test           # vitest
npm run build      # tsc -> dist/
npm run typecheck  # tsc --noEmit
```
