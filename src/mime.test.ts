import { describe, it, expect } from "vitest";
import { encodeBase64Url, decodeBase64Url, buildRawMessage, parseMessageBody } from "./mime.js";

describe("base64url", () => {
  it("round-trips a unicode string with +, /, = bytes", () => {
    const s = "Hello, 世界! +/=";
    expect(decodeBase64Url(encodeBase64Url(s)).toString("utf-8")).toBe(s);
  });

  it("produces URL-safe output with no padding", () => {
    const out = encodeBase64Url("???>>>");
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe("buildRawMessage", () => {
  it("builds a simple plain-text message", () => {
    const raw = buildRawMessage({ to: "a@b.com", subject: "Hi", body: "Hello there" });
    const decoded = decodeBase64Url(raw).toString("utf-8");
    expect(decoded).toContain("To: a@b.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Content-Type: text/plain; charset=utf-8");
    expect(decoded).toContain("Hello there");
    expect(decoded).toContain("\r\n");
  });

  it("includes Cc and Bcc when provided", () => {
    const raw = buildRawMessage({ to: "a@b.com", subject: "S", body: "B", cc: "c@d.com", bcc: "e@f.com" });
    const decoded = decodeBase64Url(raw).toString("utf-8");
    expect(decoded).toContain("Cc: c@d.com");
    expect(decoded).toContain("Bcc: e@f.com");
  });

  it("builds a multipart/mixed message with an attachment", () => {
    const raw = buildRawMessage({
      to: "a@b.com",
      subject: "S",
      body: "B",
      attachments: [{ filename: "x.txt", content: "aGVsbG8=", mimeType: "text/plain" }],
    });
    const decoded = decodeBase64Url(raw).toString("utf-8");
    expect(decoded).toContain("Content-Type: multipart/mixed; boundary=");
    expect(decoded).toContain('Content-Disposition: attachment; filename="x.txt"');
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain("aGVsbG8=");
  });
});

describe("parseMessageBody", () => {
  it("returns an empty string for an undefined payload", () => {
    expect(parseMessageBody(undefined)).toBe("");
  });

  it("reads a single-part body", () => {
    const data = Buffer.from("plain body").toString("base64url");
    expect(parseMessageBody({ body: { data } })).toBe("plain body");
  });

  it("prefers text/plain among multipart parts", () => {
    const plain = Buffer.from("the plain part").toString("base64url");
    const html = Buffer.from("<p>html</p>").toString("base64url");
    expect(
      parseMessageBody({
        parts: [
          { mimeType: "text/html", body: { data: html } },
          { mimeType: "text/plain", body: { data: plain } },
        ],
      }),
    ).toBe("the plain part");
  });

  it("falls back to text/html when there is no text/plain part", () => {
    const html = Buffer.from("<p>only html</p>").toString("base64url");
    expect(parseMessageBody({ parts: [{ mimeType: "text/html", body: { data: html } }] })).toBe("<p>only html</p>");
  });
});
