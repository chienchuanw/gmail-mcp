import type { gmail_v1 } from "googleapis";
import { buildRawMessage, parseMessageBody, type MessageAttachment } from "./mime.js";

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

export class GmailClient {
  constructor(private readonly gmail: gmail_v1.Gmail) {}

  private headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  async getMessageContent(messageId: string): Promise<EmailContent> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const msg = res.data;
    const headers = msg.payload?.headers ?? undefined;
    return {
      id: msg.id ?? "",
      threadId: msg.threadId ?? "",
      subject: this.headerValue(headers, "Subject"),
      from: this.headerValue(headers, "From"),
      to: this.headerValue(headers, "To"),
      date: this.headerValue(headers, "Date"),
      body: parseMessageBody(msg.payload ?? undefined),
      snippet: msg.snippet ?? "",
      labels: msg.labelIds ?? [],
    };
  }

  async searchEmails(query: string, maxResults = 10): Promise<EmailSummary[]> {
    const res = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const out: EmailSummary[] = [];
    for (const m of res.data.messages ?? []) {
      if (!m.id) continue;
      const c = await this.getMessageContent(m.id);
      out.push({ id: c.id, threadId: c.threadId, subject: c.subject, from: c.from, date: c.date, snippet: c.snippet });
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

  async listLabels(): Promise<gmail_v1.Schema$Label[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    return res.data.labels ?? [];
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

  async getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
    const res = await this.gmail.users.threads.get({ userId: "me", id: threadId });
    return res.data;
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
