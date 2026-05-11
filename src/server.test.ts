import { describe, it, expect } from "vitest";
import { createServer } from "./server.js";

describe("createServer", () => {
  it("returns a Server instance without throwing when given defaults are overridden", () => {
    const fakeStore: any = { list: () => [] };
    const fakeRegistry: any = { getClient: async () => ({}) };
    const server = createServer({ store: fakeStore, registry: fakeRegistry });
    expect(server).toBeTruthy();
    expect(typeof (server as any).connect).toBe("function");
  });
});
