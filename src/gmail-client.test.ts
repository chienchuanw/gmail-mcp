import { describe, it, expect, vi } from "vitest";
import type { gmail_v1 } from "googleapis";
import { GmailClient } from "./gmail-client.js";

function fakeGmail(overrides: Record<string, unknown> = {}): { gmail: gmail_v1.Gmail; calls: Record<string, any> } {
  const calls: Record<string, any> = {};
  const rec = (key: string, ret: unknown) =>
    vi.fn(async (params: any) => {
      calls[key] = params;
      return { data: ret };
    });
  const defaultMessageGet = {
    id: "m1",
    threadId: "t1",
    snippet: "snip",
    labelIds: ["INBOX"],
    payload: {
      headers: [
        { name: "Subject", value: "Hello" },
        { name: "From", value: "a@b.com" },
        { name: "To", value: "me@x.com" },
        { name: "Date", value: "Mon, 1 Jan 2024" },
      ],
      body: { data: Buffer.from("the body").toString("base64url") },
    },
  };
  const gmail: any = {
    users: {
      messages: {
        get: rec("messages.get", overrides["messages.get"] ?? defaultMessageGet),
        list: rec("messages.list", overrides["messages.list"] ?? { messages: [{ id: "m1" }] }),
        send: rec("messages.send", { id: "sent1" }),
        trash: rec("messages.trash", { id: "m1", labelIds: ["TRASH"] }),
        untrash: rec("messages.untrash", { id: "m1", labelIds: ["INBOX"] }),
        modify: rec("messages.modify", { id: "m1", labelIds: [] }),
        attachments: { get: rec("attachments.get", { data: "QkFTRTY0" }) },
      },
      drafts: {
        create: rec("drafts.create", { id: "d1" }),
        list: rec("drafts.list", { drafts: [{ id: "d1" }] }),
        send: rec("drafts.send", { id: "sentFromDraft" }),
        delete: rec("drafts.delete", {}),
      },
      labels: {
        list: rec("labels.list", { labels: [{ id: "Label_1", name: "Work" }] }),
        create: rec("labels.create", { id: "Label_2", name: "New" }),
        delete: rec("labels.delete", {}),
      },
      threads: { get: rec("threads.get", { id: "t1", messages: [{ id: "m1" }] }) },
      getProfile: rec("getProfile", { emailAddress: "me@x.com", messagesTotal: 42 }),
    },
  };
  return { gmail: gmail as gmail_v1.Gmail, calls };
}

describe("GmailClient", () => {
  it("getMessageContent extracts headers and body", async () => {
    const { gmail, calls } = fakeGmail();
    const out = await new GmailClient(gmail).getMessageContent("m1");
    expect(calls["messages.get"]).toMatchObject({ userId: "me", id: "m1", format: "full" });
    expect(out).toMatchObject({
      id: "m1",
      threadId: "t1",
      subject: "Hello",
      from: "a@b.com",
      to: "me@x.com",
      date: "Mon, 1 Jan 2024",
      snippet: "snip",
      labels: ["INBOX"],
      body: "the body",
    });
  });

  it("searchEmails lists then summarizes each message", async () => {
    const { gmail, calls } = fakeGmail();
    const out = await new GmailClient(gmail).searchEmails("is:unread", 5);
    expect(calls["messages.list"]).toMatchObject({ userId: "me", q: "is:unread", maxResults: 5 });
    expect(out).toEqual([{ id: "m1", threadId: "t1", subject: "Hello", from: "a@b.com", date: "Mon, 1 Jan 2024", snippet: "snip" }]);
  });

  it("sendEmail builds a raw message and posts it with the threadId", async () => {
    const { gmail, calls } = fakeGmail();
    const res = await new GmailClient(gmail).sendEmail({ to: "x@y.com", subject: "Hi", body: "Body text", threadId: "t9" });
    expect(calls["messages.send"].userId).toBe("me");
    expect(calls["messages.send"].requestBody.threadId).toBe("t9");
    const decoded = Buffer.from(calls["messages.send"].requestBody.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: x@y.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Body text");
    expect(res).toEqual({ id: "sent1" });
  });

  it("createDraft wraps the raw message under `message`", async () => {
    const { gmail, calls } = fakeGmail();
    const res = await new GmailClient(gmail).createDraft({ to: "x@y.com", subject: "S", body: "B" });
    const decoded = Buffer.from(calls["drafts.create"].requestBody.message.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: x@y.com");
    expect(res).toEqual({ id: "d1" });
  });

  it("listDrafts returns the drafts array", async () => {
    const { gmail } = fakeGmail();
    expect(await new GmailClient(gmail).listDrafts(3)).toEqual([{ id: "d1" }]);
  });

  it("sendDraft posts the draft id", async () => {
    const { gmail, calls } = fakeGmail();
    const res = await new GmailClient(gmail).sendDraft("d1");
    expect(calls["drafts.send"]).toMatchObject({ userId: "me", requestBody: { id: "d1" } });
    expect(res).toEqual({ id: "sentFromDraft" });
  });

  it("deleteDraft deletes by id", async () => {
    const { gmail, calls } = fakeGmail();
    await new GmailClient(gmail).deleteDraft("d1");
    expect(calls["drafts.delete"]).toMatchObject({ userId: "me", id: "d1" });
  });

  it("trashMessage and untrashMessage call the right endpoints", async () => {
    const { gmail, calls } = fakeGmail();
    const c = new GmailClient(gmail);
    await c.trashMessage("m1");
    expect(calls["messages.trash"]).toMatchObject({ userId: "me", id: "m1" });
    await c.untrashMessage("m1");
    expect(calls["messages.untrash"]).toMatchObject({ userId: "me", id: "m1" });
  });

  it("modifyLabels passes add/remove arrays", async () => {
    const { gmail, calls } = fakeGmail();
    await new GmailClient(gmail).modifyLabels("m1", ["A"], ["B"]);
    expect(calls["messages.modify"]).toMatchObject({ userId: "me", id: "m1", requestBody: { addLabelIds: ["A"], removeLabelIds: ["B"] } });
  });

  it("markAsRead removes UNREAD; markAsUnread adds UNREAD", async () => {
    const { gmail, calls } = fakeGmail();
    const c = new GmailClient(gmail);
    await c.markAsRead("m1");
    expect(calls["messages.modify"].requestBody).toMatchObject({ removeLabelIds: ["UNREAD"] });
    await c.markAsUnread("m1");
    expect(calls["messages.modify"].requestBody).toMatchObject({ addLabelIds: ["UNREAD"] });
  });

  it("listLabels, createLabel, deleteLabel", async () => {
    const { gmail, calls } = fakeGmail();
    const c = new GmailClient(gmail);
    expect(await c.listLabels()).toEqual([{ id: "Label_1", name: "Work" }]);
    const created = await c.createLabel("New");
    expect(calls["labels.create"]).toMatchObject({
      userId: "me",
      requestBody: { name: "New", labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    expect(created).toEqual({ id: "Label_2", name: "New" });
    await c.deleteLabel("Label_2");
    expect(calls["labels.delete"]).toMatchObject({ userId: "me", id: "Label_2" });
  });

  it("getThread returns the thread", async () => {
    const { gmail, calls } = fakeGmail();
    expect(await new GmailClient(gmail).getThread("t1")).toEqual({ id: "t1", messages: [{ id: "m1" }] });
    expect(calls["threads.get"]).toMatchObject({ userId: "me", id: "t1" });
  });

  it("getProfile returns the profile", async () => {
    const { gmail } = fakeGmail();
    expect(await new GmailClient(gmail).getProfile()).toEqual({ emailAddress: "me@x.com", messagesTotal: 42 });
  });

  it("listAttachments walks nested parts", async () => {
    const { gmail } = fakeGmail({
      "messages.get": {
        payload: {
          parts: [
            { mimeType: "text/plain", body: {} },
            { mimeType: "multipart/mixed", parts: [{ filename: "a.pdf", mimeType: "application/pdf", body: { attachmentId: "att1" } }] },
            { filename: "b.png", mimeType: "image/png", body: { attachmentId: "att2" } },
          ],
        },
      },
    });
    const out = await new GmailClient(gmail).listAttachments("m1");
    expect(out).toEqual([
      { filename: "a.pdf", mimeType: "application/pdf", attachmentId: "att1" },
      { filename: "b.png", mimeType: "image/png", attachmentId: "att2" },
    ]);
  });

  it("getAttachment returns the base64 data and passes the ids", async () => {
    const { gmail, calls } = fakeGmail();
    expect(await new GmailClient(gmail).getAttachment("m1", "att1")).toBe("QkFTRTY0");
    expect(calls["attachments.get"]).toMatchObject({ userId: "me", messageId: "m1", id: "att1" });
  });
});
