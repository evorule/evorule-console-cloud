// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
import { describe, it, expect, vi, afterEach } from "vitest";
import { TemplatesClient, TemplatesError } from "../templates";

const OK_BODY = { success: true, format: "text", content: "你好,张三" };

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("TemplatesClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders via POST /api/templates/render and normalizes trailing slash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OK_BODY));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const c = new TemplatesClient("http://127.0.0.1:18080/");
    const r = await c.render({ template: "你好,{{user.name}}", context: { user: { name: "张三" } } });
    expect(r).toEqual(OK_BODY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18080/api/templates/render");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      template: "你好,{{user.name}}",
      context: { user: { name: "张三" } }
    });
  });

  it("sends Bearer header only when authToken present", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse(OK_BODY)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await new TemplatesClient("http://127.0.0.1:18080", "tok-1").render({ template: "x" });
    await new TemplatesClient("http://127.0.0.1:18080", null).render({ template: "x" });
    const h1 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const h2 = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(h1["Authorization"]).toBe("Bearer tok-1");
    expect(h2["Authorization"]).toBeUndefined();
  });

  it("propagates fail-fast 400 with diagnostic text as TemplatesError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("模板第 2 行第 5 列:路径缺失 user.missing", { status: 400 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const c = new TemplatesClient("http://127.0.0.1:18080");
    await expect(c.render({ template: "x" })).rejects.toMatchObject({
      status: 400,
      endpoint: "/api/templates/render"
    });
    await expect(c.render({ template: "x" })).rejects.toThrow(TemplatesError);
  });

  it("wraps network failure as TemplatesError with status 0", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const c = new TemplatesClient("http://127.0.0.1:18080");
    await expect(c.render({ template: "x" })).rejects.toMatchObject({ status: 0 });
  });
});
