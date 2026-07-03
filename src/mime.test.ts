import { describe, it, expect } from "vitest";
import { encodeBase64Url, decodeBase64Url, buildRawMessage, parseMessageBody, htmlToText, truncate } from "./mime.js";

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

  it("strips tags when it falls back to text/html", () => {
    const html = Buffer.from("<p>only <b>html</b></p>").toString("base64url");
    expect(parseMessageBody({ parts: [{ mimeType: "text/html", body: { data: html } }] })).toBe("only html");
  });
});

describe("htmlToText", () => {
  it("removes tags and collapses whitespace", () => {
    expect(htmlToText("<p>Hello</p>\n<p>  world </p>")).toBe("Hello world");
  });

  it("drops <script> and <style> blocks entirely", () => {
    expect(htmlToText("<style>.a{color:red}</style>Hi<script>alert(1)</script> there")).toBe("Hi there");
  });

  it("decodes common HTML entities", () => {
    expect(htmlToText("Tom &amp; Jerry &lt;3 &quot;x&quot; &#39;y&#39; &nbsp;z")).toBe('Tom & Jerry <3 "x" \'y\' z');
  });

  it("turns block boundaries into single spaces, not run-together text", () => {
    expect(htmlToText("<div>a</div><div>b</div>")).toBe("a b");
  });
});

describe("truncate", () => {
  it("returns the text unchanged when within the limit", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  it("cuts to the limit and appends a marker with the total length", () => {
    const out = truncate("abcdefghij", 4);
    expect(out).toBe("abcd…[truncated, 10 chars total]");
  });
});
