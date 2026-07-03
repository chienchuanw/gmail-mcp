import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeAttachment, sanitizeFilename } from "./attachments.js";

describe("sanitizeFilename", () => {
  it("strips directory components to prevent path traversal", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a/b/c.pdf")).toBe("c.pdf");
  });

  it("falls back to a default when empty", () => {
    expect(sanitizeFilename("")).toBe("attachment.bin");
  });
});

describe("writeAttachment", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gmailmcp-att-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("decodes base64url data to a file under configDir/attachments and returns metadata", () => {
    const base64 = Buffer.from("hello world").toString("base64url");
    const out = writeAttachment(dir, { messageId: "m1", attachmentId: "att1", base64, filename: "doc.txt", mimeType: "text/plain" });

    expect(out.filename).toBe("doc.txt");
    expect(out.mimeType).toBe("text/plain");
    expect(out.bytes).toBe(11);
    expect(out.path).toBe(path.join(dir, "attachments", "m1-doc.txt"));
    expect(fs.readFileSync(out.path, "utf-8")).toBe("hello world");
    expect((out as unknown as Record<string, unknown>).data).toBeUndefined();
  });

  it("sanitizes the messageId so it cannot escape the attachments directory", () => {
    const out = writeAttachment(dir, { messageId: "../../evil", attachmentId: "att1", base64: Buffer.from("x").toString("base64url"), filename: "f.txt" });
    expect(out.path).toBe(path.join(dir, "attachments", "evil-f.txt"));
    expect(fs.existsSync(out.path)).toBe(true);
  });

  it("defaults filename and mimeType when not provided", () => {
    const out = writeAttachment(dir, { messageId: "m1", attachmentId: "att9", base64: Buffer.from("x").toString("base64url") });
    expect(out.filename).toBe("att9.bin");
    expect(out.mimeType).toBe("application/octet-stream");
  });
});
