import { describe, it, expect, vi } from "vitest";
import { handleCallTool, handleListTools } from "./handlers.js";
import type { AccountStore } from "./accounts.js";
import type { ClientRegistry } from "./client-registry.js";

const makeStore = () => ({ list: vi.fn(() => [{ alias: "work", email: "w@x.com" }]) }) as unknown as AccountStore;

const makeClient = () => ({
  searchEmails: vi.fn(async () => [{ id: "m1", threadId: "t", subject: "S", from: "f", date: "d", snippet: "x" }]),
  getMessageContent: vi.fn(async (id: string, _opts?: unknown) => ({ id, subject: "S" })),
  sendEmail: vi.fn(async () => ({ id: "sent1" })),
  createDraft: vi.fn(async () => ({ id: "d1" })),
  listDrafts: vi.fn(async () => [{ id: "d1" }]),
  sendDraft: vi.fn(async () => ({ id: "s2" })),
  deleteDraft: vi.fn(async () => {}),
  trashMessages: vi.fn(async () => {}),
  untrashMessages: vi.fn(async () => {}),
  markAsRead: vi.fn(async () => {}),
  markAsUnread: vi.fn(async () => {}),
  modifyLabels: vi.fn(async () => {}),
  listLabels: vi.fn(async () => [{ id: "L1" }]),
  createLabel: vi.fn(async () => ({ id: "L2" })),
  deleteLabel: vi.fn(async () => {}),
  getThread: vi.fn(async (_id: string, _opts?: unknown) => ({ id: "t1" })),
  listAttachments: vi.fn(async () => [{ filename: "a", mimeType: "m", attachmentId: "x" }]),
  getAttachment: vi.fn(async () => "QkFTRTY0"),
  getProfile: vi.fn(async () => ({ emailAddress: "w@x.com" })),
});

const makeRegistry = (client: any, opts: { onGet?: (a: string) => void } = {}) =>
  ({
    getClient: vi.fn(async (alias: string) => {
      opts.onGet?.(alias);
      if (alias === "bad") throw new Error('Unknown account "bad". Available: work.');
      return client;
    }),
  }) as unknown as ClientRegistry;

describe("handleListTools", () => {
  it("returns the 20 tools", async () => {
    expect((await handleListTools()).tools).toHaveLength(20);
  });
});

describe("handleCallTool", () => {
  it("gmail_list_accounts returns the store list without calling the registry", async () => {
    const store = makeStore();
    const registry = makeRegistry(makeClient());
    const res = await handleCallTool("gmail_list_accounts", {}, { store, registry });
    expect(JSON.parse(res.content[0].text)).toEqual([{ alias: "work", email: "w@x.com" }]);
    expect(registry.getClient).not.toHaveBeenCalled();
    expect(res.isError).toBeFalsy();
  });

  it("routes args.account through the registry and dispatches to the client method", async () => {
    let seen = "";
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_search",
      { account: "work", query: "is:unread", maxResults: 3 },
      { store: makeStore(), registry: makeRegistry(client, { onGet: (a) => (seen = a) }) },
    );
    expect(seen).toBe("work");
    expect(client.searchEmails).toHaveBeenCalledWith("is:unread", 3);
    expect(JSON.parse(res.content[0].text)).toHaveLength(1);
    expect(res.isError).toBeFalsy();
  });

  it("gmail_search defaults maxResults to 10", async () => {
    const client = makeClient();
    await handleCallTool("gmail_search", { account: "work", query: "q" }, { store: makeStore(), registry: makeRegistry(client) });
    expect(client.searchEmails).toHaveBeenCalledWith("q", 10);
  });

  it("gmail_send returns a human-readable confirmation containing the message id", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_send",
      { account: "work", to: "a@b.com", subject: "S", body: "B" },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.sendEmail).toHaveBeenCalledWith({ account: "work", to: "a@b.com", subject: "S", body: "B" });
    expect(res.content[0].text).toMatch(/sent1/);
    expect(res.isError).toBeFalsy();
  });

  it("gmail_mark_read accepts messageIds and reports the count", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_mark_read",
      { account: "work", messageIds: ["m1", "m2"] },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.markAsRead).toHaveBeenCalledWith(["m1", "m2"]);
    expect(JSON.parse(res.content[0].text)).toEqual({ modified: 2 });
  });

  it("gmail_mark_read normalizes a single messageId string to an array", async () => {
    const client = makeClient();
    await handleCallTool(
      "gmail_mark_read",
      { account: "work", messageId: "m1" },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.markAsRead).toHaveBeenCalledWith(["m1"]);
  });

  it("gmail_modify_labels batches add/remove across messageIds", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_modify_labels",
      { account: "work", messageIds: ["m1", "m2", "m3"], addLabels: ["A"], removeLabels: ["B"] },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.modifyLabels).toHaveBeenCalledWith(["m1", "m2", "m3"], ["A"], ["B"]);
    expect(JSON.parse(res.content[0].text)).toEqual({ modified: 3 });
  });

  it("gmail_trash routes to trashMessages with the id array", async () => {
    const client = makeClient();
    await handleCallTool(
      "gmail_trash",
      { account: "work", messageIds: ["m1", "m2"] },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(client.trashMessages).toHaveBeenCalledWith(["m1", "m2"]);
  });

  it("a mutation with no message ids → isError", async () => {
    const res = await handleCallTool(
      "gmail_mark_read",
      { account: "work" },
      { store: makeStore(), registry: makeRegistry(makeClient()) },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/messageIds/);
  });

  it("gmail_get_attachment returns the base64 data embedded in JSON", async () => {
    const client = makeClient();
    const res = await handleCallTool(
      "gmail_get_attachment",
      { account: "work", messageId: "m1", attachmentId: "att1" },
      { store: makeStore(), registry: makeRegistry(client) },
    );
    expect(JSON.parse(res.content[0].text)).toMatchObject({ messageId: "m1", attachmentId: "att1", data: "QkFTRTY0" });
  });

  it("gmail_get_message forwards the full flag to the client", async () => {
    const client = makeClient();
    await handleCallTool("gmail_get_message", { account: "work", messageId: "m1", full: true }, { store: makeStore(), registry: makeRegistry(client) });
    expect(client.getMessageContent).toHaveBeenCalledWith("m1", { full: true });
  });

  it("gmail_get_thread forwards the full flag to the client", async () => {
    const client = makeClient();
    await handleCallTool("gmail_get_thread", { account: "work", threadId: "t1", full: true }, { store: makeStore(), registry: makeRegistry(client) });
    expect(client.getThread).toHaveBeenCalledWith("t1", { full: true });
  });

  it("missing account → isError", async () => {
    const res = await handleCallTool("gmail_search", { query: "x" }, { store: makeStore(), registry: makeRegistry(makeClient()) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/account/i);
  });

  it("a registry error surfaces as isError with the message", async () => {
    const res = await handleCallTool("gmail_search", { account: "bad", query: "x" }, { store: makeStore(), registry: makeRegistry(makeClient()) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown account "bad"/);
  });

  it("an unknown tool name → isError", async () => {
    const res = await handleCallTool("gmail_nope", { account: "work" }, { store: makeStore(), registry: makeRegistry(makeClient()) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown tool/);
  });
});
