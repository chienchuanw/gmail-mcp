import * as fs from "fs";
import * as path from "path";

export interface WrittenAttachment {
  filename: string;
  mimeType: string;
  path: string;
  bytes: number;
}

export interface WriteAttachmentInput {
  messageId: string;
  attachmentId: string;
  /** base64url-encoded attachment data, as returned by the Gmail API. */
  base64: string;
  filename?: string;
  mimeType?: string;
}

/** Reduce a suggested filename to a safe basename, preventing path traversal. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[/\\]/g, "_").trim();
  return base.length ? base : "attachment.bin";
}

/**
 * Decode an attachment and write it to `${configDir}/attachments/<messageId>-<filename>`,
 * returning file metadata instead of the (potentially huge) base64 payload.
 */
export function writeAttachment(configDir: string, input: WriteAttachmentInput): WrittenAttachment {
  const dir = path.join(configDir, "attachments");
  fs.mkdirSync(dir, { recursive: true });

  const filename = sanitizeFilename(input.filename ?? `${input.attachmentId}.bin`);
  const mimeType = input.mimeType ?? "application/octet-stream";
  const buf = Buffer.from(input.base64, "base64url");
  const target = path.join(dir, `${sanitizeFilename(input.messageId)}-${filename}`);
  fs.writeFileSync(target, buf);

  return { filename, mimeType, path: target, bytes: buf.length };
}
