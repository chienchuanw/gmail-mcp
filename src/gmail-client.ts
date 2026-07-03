import type { gmail_v1 } from "googleapis";
import { buildRawMessage, parseMessageBody, truncate, type MessageAttachment } from "./mime.js";

/** Default cap on returned message bodies; callers pass `{ full: true }` to bypass. */
export const BODY_CHAR_LIMIT = 1000;

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface EmailContent extends EmailSummary {
  to: string;
  body: string;
  labels: string[];
}

export interface SendOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  attachments?: MessageAttachment[];
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

export interface LabelSummary {
  id: string;
  name: string;
  type?: string;
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  snippet: string;
  body: string;
  labels: string[];
}

export interface CompactThread {
  id: string;
  historyId: string;
  messages: ThreadMessage[];
}

export interface ReadOptions {
  /** Return the full body instead of a truncated one (get_message / get_thread). */
  full?: boolean;
}

export class GmailClient {
  constructor(private readonly gmail: gmail_v1.Gmail) {}

  private headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  private extractContent(msg: gmail_v1.Schema$Message, full: boolean): EmailContent {
    const headers = msg.payload?.headers ?? undefined;
    const body = parseMessageBody(msg.payload ?? undefined);
    return {
      id: msg.id ?? "",
      threadId: msg.threadId ?? "",
      subject: this.headerValue(headers, "Subject"),
      from: this.headerValue(headers, "From"),
      to: this.headerValue(headers, "To"),
      date: this.headerValue(headers, "Date"),
      body: full ? body : truncate(body, BODY_CHAR_LIMIT),
      snippet: msg.snippet ?? "",
      labels: msg.labelIds ?? [],
    };
  }

  async getMessageContent(messageId: string, opts: ReadOptions = {}): Promise<EmailContent> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    return this.extractContent(res.data, opts.full ?? false);
  }

  async searchEmails(query: string, maxResults = 10): Promise<EmailSummary[]> {
    const res = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const out: EmailSummary[] = [];
    for (const m of res.data.messages ?? []) {
      if (!m.id) continue;
      const r = await this.gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      const msg = r.data;
      const headers = msg.payload?.headers ?? undefined;
      out.push({
        id: msg.id ?? "",
        threadId: msg.threadId ?? "",
        subject: this.headerValue(headers, "Subject"),
        from: this.headerValue(headers, "From"),
        date: this.headerValue(headers, "Date"),
        snippet: msg.snippet ?? "",
      });
    }
    return out;
  }

  async sendEmail(opts: SendOptions): Promise<gmail_v1.Schema$Message> {
    const raw = buildRawMessage({ to: opts.to, subject: opts.subject, body: opts.body, cc: opts.cc, bcc: opts.bcc, attachments: opts.attachments });
    const res = await this.gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: opts.threadId } });
    return res.data;
  }

  async createDraft(opts: SendOptions): Promise<gmail_v1.Schema$Draft> {
    const raw = buildRawMessage({ to: opts.to, subject: opts.subject, body: opts.body, cc: opts.cc, bcc: opts.bcc, attachments: opts.attachments });
    const res = await this.gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId: opts.threadId } } });
    return res.data;
  }

  async listDrafts(maxResults = 10): Promise<gmail_v1.Schema$Draft[]> {
    const res = await this.gmail.users.drafts.list({ userId: "me", maxResults });
    return res.data.drafts ?? [];
  }

  async sendDraft(draftId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    return res.data;
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.gmail.users.drafts.delete({ userId: "me", id: draftId });
  }

  async trashMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.trash({ userId: "me", id: messageId });
    return res.data;
  }

  async untrashMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.untrash({ userId: "me", id: messageId });
    return res.data;
  }

  async modifyLabels(messageId: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds, removeLabelIds } });
    return res.data;
  }

  async markAsRead(messageId: string): Promise<gmail_v1.Schema$Message> {
    return this.modifyLabels(messageId, undefined, ["UNREAD"]);
  }

  async markAsUnread(messageId: string): Promise<gmail_v1.Schema$Message> {
    return this.modifyLabels(messageId, ["UNREAD"], undefined);
  }

  async listLabels(): Promise<LabelSummary[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    return (res.data.labels ?? []).map((l) => ({ id: l.id ?? "", name: l.name ?? "", type: l.type ?? undefined }));
  }

  async createLabel(name: string): Promise<gmail_v1.Schema$Label> {
    const res = await this.gmail.users.labels.create({
      userId: "me",
      requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    return res.data;
  }

  async deleteLabel(labelId: string): Promise<void> {
    await this.gmail.users.labels.delete({ userId: "me", id: labelId });
  }

  async getThread(threadId: string, opts: ReadOptions = {}): Promise<gmail_v1.Schema$Thread | CompactThread> {
    const res = await this.gmail.users.threads.get({ userId: "me", id: threadId });
    if (opts.full) return res.data;
    const t = res.data;
    return {
      id: t.id ?? "",
      historyId: t.historyId ?? "",
      messages: (t.messages ?? []).map((m) => {
        const c = this.extractContent(m, false);
        return { id: c.id, from: c.from, to: c.to, date: c.date, subject: c.subject, snippet: c.snippet, body: c.body, labels: c.labels };
      }),
    };
  }

  async getProfile(): Promise<gmail_v1.Schema$Profile> {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    return res.data;
  }

  async listAttachments(messageId: string): Promise<AttachmentInfo[]> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const out: AttachmentInfo[] = [];
    const walk = (parts: gmail_v1.Schema$MessagePart[] | undefined): void => {
      for (const p of parts ?? []) {
        if (p.filename && p.body?.attachmentId) {
          out.push({ filename: p.filename, mimeType: p.mimeType ?? "application/octet-stream", attachmentId: p.body.attachmentId });
        }
        if (p.parts) walk(p.parts);
      }
    };
    walk(res.data.payload?.parts ?? undefined);
    return out;
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<string> {
    const res = await this.gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
    return res.data.data ?? "";
  }
}
