import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";

describe("tools", () => {
  it("exposes 20 uniquely-named tools including gmail_list_accounts", () => {
    expect(tools).toHaveLength(20);
    const names = tools.map((t) => t.name);
    expect(names).toContain("gmail_list_accounts");
    expect(new Set(names).size).toBe(20);
  });

  it("gmail_list_accounts takes no parameters", () => {
    const t = tools.find((t) => t.name === "gmail_list_accounts")!;
    expect(t.inputSchema.properties).toEqual({});
    expect(t.inputSchema.required ?? []).toEqual([]);
  });

  it("every other tool requires an 'account' string parameter", () => {
    for (const t of tools) {
      if (t.name === "gmail_list_accounts") continue;
      expect((t.inputSchema.properties as Record<string, any>).account).toMatchObject({ type: "string" });
      expect(t.inputSchema.required).toContain("account");
    }
  });

  it("preserves the original required params (account is prepended)", () => {
    const search = tools.find((t) => t.name === "gmail_search")!;
    expect(search.inputSchema.required).toEqual(["account", "query"]);
    const send = tools.find((t) => t.name === "gmail_send")!;
    expect(send.inputSchema.required).toEqual(["account", "to", "subject", "body"]);
    const listDrafts = tools.find((t) => t.name === "gmail_list_drafts")!;
    expect(listDrafts.inputSchema.required).toEqual(["account"]);
  });

  it("batch mutation tools take a messageIds array", () => {
    for (const n of ["gmail_modify_labels", "gmail_mark_read", "gmail_mark_unread", "gmail_trash", "gmail_untrash"]) {
      const t = tools.find((t) => t.name === n)!;
      const props = t.inputSchema.properties as Record<string, any>;
      expect(props.messageIds).toMatchObject({ type: "array", items: { type: "string" } });
      expect(props.messageId).toBeUndefined();
      expect(t.inputSchema.required).toEqual(["account", "messageIds"]);
    }
  });

  it("get_message and get_thread expose a boolean full flag", () => {
    for (const n of ["gmail_get_message", "gmail_get_thread"]) {
      const t = tools.find((t) => t.name === n)!;
      expect((t.inputSchema.properties as Record<string, any>).full).toMatchObject({ type: "boolean" });
    }
  });

  it("includes all 19 Gmail tool names", () => {
    const names = new Set(tools.map((t) => t.name));
    for (const n of [
      "gmail_search", "gmail_get_message", "gmail_send", "gmail_get_thread", "gmail_get_profile",
      "gmail_create_draft", "gmail_list_drafts", "gmail_send_draft", "gmail_delete_draft",
      "gmail_list_labels", "gmail_create_label", "gmail_delete_label", "gmail_modify_labels",
      "gmail_trash", "gmail_untrash", "gmail_mark_read", "gmail_mark_unread",
      "gmail_list_attachments", "gmail_get_attachment",
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });
});
