/** Minimal structural shape of a Gmail message part (subset of gmail_v1.Schema$MessagePart). */
export interface MessagePart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MessagePart[] | null;
}

export interface MessageAttachment {
  /** Suggested filename for the attachment. */
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  /** MIME type, e.g. "application/pdf". */
  mimeType: string;
}

export interface RawMessageInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  attachments?: MessageAttachment[];
}

export function encodeBase64Url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64url");
}

export function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data, "base64url");
}

/** Build an RFC 2822 message and base64url-encode it for the Gmail API `raw` field. */
export function buildRawMessage(input: RawMessageInput): string {
  const headers = [`To: ${input.to}`, `Subject: ${input.subject}`, "MIME-Version: 1.0"];
  if (input.cc) headers.push(`Cc: ${input.cc}`);
  if (input.bcc) headers.push(`Bcc: ${input.bcc}`);

  let lines: string[];
  if (input.attachments && input.attachments.length > 0) {
    const boundary = `boundary_${Date.now()}`;
    lines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ];
    for (const att of input.attachments) {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "",
        att.content,
      );
    }
    lines.push(`--${boundary}--`);
  } else {
    lines = [...headers, "Content-Type: text/plain; charset=utf-8", "", input.body];
  }

  return encodeBase64Url(lines.join("\r\n"));
}

/** Strip HTML to readable plain text: drop script/style, remove tags, decode common entities, collapse whitespace. */
export function htmlToText(html: string): string {
  const decoded = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

/** Cut text to `limit` characters, appending a marker noting the original length when truncated. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…[truncated, ${text.length} chars total]`;
}

/** Extract a readable body from a message payload: prefer text/plain, else strip text/html to text. */
export function parseMessageBody(payload: MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).toString("utf-8");
  }
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data).toString("utf-8");
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) return htmlToText(decodeBase64Url(html.body.data).toString("utf-8"));
  }
  return "";
}
