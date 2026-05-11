export interface JsonSchemaProperty {
  type: string;
  description?: string;
  items?: { type: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
  };
}

const ACCOUNT_PROPERTY: JsonSchemaProperty = {
  type: "string",
  description: "Configured account alias to act on (e.g. 'work'). See gmail_list_accounts.",
};

function gmailTool(
  name: string,
  description: string,
  properties: Record<string, JsonSchemaProperty>,
  required: string[],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT_PROPERTY, ...properties },
      required: ["account", ...required],
    },
  };
}

const STR = (description: string): JsonSchemaProperty => ({ type: "string", description });
const NUM = (description: string): JsonSchemaProperty => ({ type: "number", description });
const STR_ARRAY = (description: string): JsonSchemaProperty => ({ type: "array", items: { type: "string" }, description });

export const tools: ToolDefinition[] = [
  {
    name: "gmail_list_accounts",
    description: "List the configured Gmail account aliases and their email addresses.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  gmailTool("gmail_search", "Search emails using Gmail query syntax (e.g. 'from:a@b.com is:unread after:2024/01/01').", {
    query: STR("Gmail search query"),
    maxResults: NUM("Maximum number of results (default 10)"),
  }, ["query"]),
  gmailTool("gmail_get_message", "Get the full content of an email by its message ID.", {
    messageId: STR("The message ID"),
  }, ["messageId"]),
  gmailTool("gmail_send", "Send an email.", {
    to: STR("Recipient email address"),
    subject: STR("Email subject"),
    body: STR("Email body (plain text)"),
    cc: STR("CC recipients (comma-separated)"),
    bcc: STR("BCC recipients (comma-separated)"),
    threadId: STR("Thread ID to reply within (for threading)"),
  }, ["to", "subject", "body"]),
  gmailTool("gmail_get_thread", "Get all messages in an email thread.", {
    threadId: STR("The thread ID"),
  }, ["threadId"]),
  gmailTool("gmail_get_profile", "Get the account's Gmail profile (email address, message totals, etc.).", {}, []),
  gmailTool("gmail_create_draft", "Create a draft email.", {
    to: STR("Recipient email address"),
    subject: STR("Email subject"),
    body: STR("Email body (plain text)"),
    cc: STR("CC recipients (comma-separated)"),
    bcc: STR("BCC recipients (comma-separated)"),
    threadId: STR("Thread ID to reply within (for threading)"),
  }, ["to", "subject", "body"]),
  gmailTool("gmail_list_drafts", "List draft emails.", {
    maxResults: NUM("Maximum number of drafts to return (default 10)"),
  }, []),
  gmailTool("gmail_send_draft", "Send an existing draft.", {
    draftId: STR("The ID of the draft to send"),
  }, ["draftId"]),
  gmailTool("gmail_delete_draft", "Delete a draft email.", {
    draftId: STR("The ID of the draft to delete"),
  }, ["draftId"]),
  gmailTool("gmail_list_labels", "List all labels in the mailbox.", {}, []),
  gmailTool("gmail_create_label", "Create a new label.", {
    name: STR("Name for the new label"),
  }, ["name"]),
  gmailTool("gmail_delete_label", "Delete a label.", {
    labelId: STR("The ID of the label to delete"),
  }, ["labelId"]),
  gmailTool("gmail_modify_labels", "Add or remove labels from an email.", {
    messageId: STR("The message ID"),
    addLabels: STR_ARRAY("Label IDs to add"),
    removeLabels: STR_ARRAY("Label IDs to remove"),
  }, ["messageId"]),
  gmailTool("gmail_trash", "Move an email to trash.", {
    messageId: STR("The ID of the email to trash"),
  }, ["messageId"]),
  gmailTool("gmail_untrash", "Restore an email from trash.", {
    messageId: STR("The ID of the email to untrash"),
  }, ["messageId"]),
  gmailTool("gmail_mark_read", "Mark an email as read.", {
    messageId: STR("The ID of the email to mark as read"),
  }, ["messageId"]),
  gmailTool("gmail_mark_unread", "Mark an email as unread.", {
    messageId: STR("The ID of the email to mark as unread"),
  }, ["messageId"]),
  gmailTool("gmail_list_attachments", "List all attachments in an email.", {
    messageId: STR("The message ID"),
  }, ["messageId"]),
  gmailTool("gmail_get_attachment", "Download an attachment from an email (returns base64-encoded data).", {
    messageId: STR("The message ID"),
    attachmentId: STR("The attachment ID (from gmail_list_attachments)"),
  }, ["messageId", "attachmentId"]),
];
