import { describe, it, expect, vi } from "vitest";
import * as http from "http";
import { buildAuthUrl, exchangeCodeForToken, waitForAuthCode } from "./auth-flow.js";

describe("buildAuthUrl", () => {
  it("requests offline access, the consent prompt, and the Gmail scopes", () => {
    const fake: any = { generateAuthUrl: vi.fn().mockReturnValue("https://auth.example/url") };
    const url = buildAuthUrl(fake);
    expect(url).toBe("https://auth.example/url");
    const arg = fake.generateAuthUrl.mock.calls[0][0];
    expect(arg.access_type).toBe("offline");
    expect(arg.prompt).toBe("consent");
    expect(arg.scope).toContain("https://www.googleapis.com/auth/gmail.modify");
  });
});

describe("exchangeCodeForToken", () => {
  it("exchanges the code and sets the credentials on the client", async () => {
    const tokens = { access_token: "a", refresh_token: "r", expiry_date: 1 };
    const fake: any = { getToken: vi.fn().mockResolvedValue({ tokens }), setCredentials: vi.fn() };
    const out = await exchangeCodeForToken(fake, "the-code");
    expect(fake.getToken).toHaveBeenCalledWith("the-code");
    expect(fake.setCredentials).toHaveBeenCalledWith(tokens);
    expect(out).toEqual(tokens);
  });
});

describe("waitForAuthCode", () => {
  it("resolves with the code from the OAuth callback request", async () => {
    const port = 39517;
    const pending = waitForAuthCode(port);
    await new Promise((r) => setTimeout(r, 50)); // let the server start listening
    await new Promise<void>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/oauth2callback?code=XYZ`, (res) => {
          res.resume();
          res.on("end", () => resolve());
        })
        .on("error", reject);
    });
    await expect(pending).resolves.toBe("XYZ");
  });

  it("rejects when the callback arrives without a code", async () => {
    const port = 39518;
    const pending = waitForAuthCode(port);
    await new Promise((r) => setTimeout(r, 50));
    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/oauth2callback?error=access_denied`, (res) => {
        res.resume();
        res.on("end", () => resolve());
      });
    });
    await expect(pending).rejects.toThrow(/authorization code/i);
  });
});
