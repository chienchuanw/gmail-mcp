import { tools } from "./tools.js";
import type { AccountStore } from "./accounts.js";
import type { ClientRegistry } from "./client-registry.js";
import type { GmailClient, SendOptions } from "./gmail-client.js";

export interface ToolDeps {
  store: AccountStore;
  registry: ClientRegistry;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value));
}

/** Accept either a `messageIds` array or a single `messageId` string; require at least one. */
function messageIds(args: Record<string, any>): string[] {
  const ids: unknown = args.messageIds ?? (args.messageId != null ? [args.messageId] : []);
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("Provide messageIds — a non-empty array of message IDs (a single messageId string is also accepted).");
  }
  return ids as string[];
}

async function dispatch(client: GmailClient, name: string, args: Record<string, any>): Promise<ToolResult> {
  switch (name) {
    case "gmail_search":
      return json(await client.searchEmails(args.query, args.maxResults ?? 10));
    case "gmail_get_message":
      return json(await client.getMessageContent(args.messageId, { full: args.full === true }));
    case "gmail_send": {
      const r = await client.sendEmail(args as SendOptions);
      return text(`Email sent successfully. Message ID: ${r.id}`);
    }
    case "gmail_get_thread":
      return json(await client.getThread(args.threadId, { full: args.full === true }));
    case "gmail_get_profile":
      return json(await client.getProfile());
    case "gmail_create_draft": {
      const r = await client.createDraft(args as SendOptions);
      return text(`Draft created successfully. Draft ID: ${r.id}`);
    }
    case "gmail_list_drafts":
      return json(await client.listDrafts(args.maxResults ?? 10));
    case "gmail_send_draft": {
      const r = await client.sendDraft(args.draftId);
      return text(`Draft sent successfully. Message ID: ${r.id}`);
    }
    case "gmail_delete_draft":
      await client.deleteDraft(args.draftId);
      return text("Draft deleted successfully.");
    case "gmail_list_labels":
      return json(await client.listLabels());
    case "gmail_create_label": {
      const l = await client.createLabel(args.name);
      return text(`Label created successfully. ID: ${l.id}`);
    }
    case "gmail_delete_label":
      await client.deleteLabel(args.labelId);
      return text("Label deleted successfully.");
    case "gmail_modify_labels": {
      const ids = messageIds(args);
      await client.modifyLabels(ids, args.addLabels, args.removeLabels);
      return json({ modified: ids.length });
    }
    case "gmail_trash": {
      const ids = messageIds(args);
      await client.trashMessages(ids);
      return json({ modified: ids.length });
    }
    case "gmail_untrash": {
      const ids = messageIds(args);
      await client.untrashMessages(ids);
      return json({ modified: ids.length });
    }
    case "gmail_mark_read": {
      const ids = messageIds(args);
      await client.markAsRead(ids);
      return json({ modified: ids.length });
    }
    case "gmail_mark_unread": {
      const ids = messageIds(args);
      await client.markAsUnread(ids);
      return json({ modified: ids.length });
    }
    case "gmail_list_attachments":
      return json(await client.listAttachments(args.messageId));
    case "gmail_get_attachment": {
      const data = await client.getAttachment(args.messageId, args.attachmentId);
      return json({ messageId: args.messageId, attachmentId: args.attachmentId, data });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleListTools(): Promise<{ tools: typeof tools }> {
  return { tools };
}

export async function handleCallTool(name: string, args: Record<string, any>, deps: ToolDeps): Promise<ToolResult> {
  try {
    if (name === "gmail_list_accounts") return json(deps.store.list());
    const alias = args.account;
    if (typeof alias !== "string" || alias.length === 0) {
      throw new Error("Missing required 'account' parameter (a configured account alias — see gmail_list_accounts).");
    }
    const client = await deps.registry.getClient(alias);
    return await dispatch(client, name, args);
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}
