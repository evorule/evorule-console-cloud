// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// UV-084 W1 单测:HttpBackend A 组 5 项 7 方法
// (审计导入×2 / 会话派生 / 会话回收 / payload 注入 / 共享事实×2)。
//
// 运行: npx vitest run src/lib/kernel/backend/__tests__/http-backend-wave3.test.ts
//
// 测试范围(mock 全局 fetch,零真实网络):
//   - URL/方法/请求体对齐 evorule-server 端点形状(源码级核实 server.rs)
//   - Bearer 头携带(authToken 构造)
//   - 响应解析(JSON 透传 / session_id 提取 / 裸数组与 {facts} 兜底)
//   - 错误纪律:非 2xx 抛 HttpBackendError(含 status/endpoint,消息含
//     server 指引原文);200+success=false 如实返回不静默
//
// 不测:
//   - 既有 28 方法(wave2 及既有覆盖)
//   - 真实 evorule-server 交互(集成测试范畴)

import { describe, test, expect, vi, afterEach } from "vitest";
import { HttpBackend, HttpBackendError } from "../http-backend";

const BASE = "http://127.0.0.1:18080";

/** mock 全局 fetch 返回 JSON 响应,并捕获请求参数 */
function mockFetchJson(
	payload: unknown,
	opts: { status?: number } = {},
): ReturnType<typeof vi.fn> {
	const fn = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(payload), {
			status: opts.status ?? 200,
			headers: { "content-type": "application/json" },
		}),
	);
	vi.stubGlobal("fetch", fn);
	return fn;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * 捕获 rejected promise 为 HttpBackendError(类型断言前置:
 * promise 意外 resolve 或错误类型不符时直接让测试失败,不静默通过)。
 */
async function expectHttpError(p: Promise<unknown>): Promise<HttpBackendError> {
	const err = await p.then(
		() => new Error("expected HttpBackendError but promise resolved"),
		(e) => e,
	);
	expect(err).toBeInstanceOf(HttpBackendError);
	return err as HttpBackendError;
}

// ============ A1:审计导入 ============

describe("UV-084 W1 HttpBackend - 审计导入", () => {
	test("importAudit:POST /audit/import,body 透传 + Bearer + 响应解析", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			imported: true,
			verify_ok: true,
			status: "ok",
		});
		const backend = new HttpBackend(BASE, "tok-1");
		const chainData = { entries: [{ fact_id: 1 }], fact_count: 1 };

		const result = await backend.importAudit(3, chainData);

		expect(result.status).toBe("ok");
		expect(result.verify_ok).toBe(true);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/audit/import`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
			"application/json",
		);
		expect(JSON.parse(init.body as string)).toEqual(chainData);
	});

	test("importAudit:verify_failed 形态如实返回(HTTP 200 + status=verify_failed,不静默)", async () => {
		mockFetchJson({
			session_id: 3,
			imported: true,
			verify_ok: false,
			status: "verify_failed",
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.importAudit(3, {});

		expect(result.imported).toBe(true);
		expect(result.verify_ok).toBe(false);
		expect(result.status).toBe("verify_failed");
	});

	test("importAudit:404 会话不存在抛 HttpBackendError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("session not found", { status: 404 })),
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.importAudit(99, {}));
		expect(err.status).toBe(404);
	});

	test("importAuditCompressed:POST application/gzip,Blob body + 响应解析", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			imported: true,
			verify_ok: true,
			status: "ok",
			format: "gzip",
		});
		const backend = new HttpBackend(BASE, "tok-1");
		const gzBlob = new Blob([new Uint8Array([0x1f, 0x8b, 0x00])]);

		const result = await backend.importAuditCompressed(3, gzBlob);

		expect(result.status).toBe("ok");
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/audit/import/compressed`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
			"application/gzip",
		);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
		expect(init.body).toBe(gzBlob);
	});

	test("importAuditCompressed:400(空 body/解析失败)抛 HttpBackendError", async () => {
		mockFetchJson({ error: "empty body" }, { status: 400 });
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(
			backend.importAuditCompressed(3, new Blob([])),
		);
		expect(err.status).toBe(400);
	});
});

// ============ A2:会话派生 ============

describe("UV-084 W1 HttpBackend - 会话派生", () => {
	test("createSessionFrom:POST /sessions/from/{pid},version query + session_id 提取", async () => {
		const fetchMock = mockFetchJson({
			session_id: 7,
			parent_session_id: 3,
			message: "Session created from parent",
			forked_from_version: 4,
		});
		const backend = new HttpBackend(BASE, "tok-1");

		const newId = await backend.createSessionFrom(3, 4);

		expect(newId).toBe(7);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/from/3?version=4`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("createSessionFrom:version 缺省 = 父最新版本(无 query)", async () => {
		const fetchMock = mockFetchJson({
			session_id: 8,
			parent_session_id: 3,
			message: "Session created from parent",
			forked_from_version: null,
		});
		const backend = new HttpBackend(BASE);

		const newId = await backend.createSessionFrom(3);

		expect(newId).toBe(8);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/from/3`);
	});

	test("createSessionFrom:404 父会话不存在抛 HttpBackendError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.createSessionFrom(99));
		expect(err.status).toBe(404);
	});

	test("createSessionFrom:429 超最大会话数抛 HttpBackendError", async () => {
		mockFetchJson({ error: "limit exceeded" }, { status: 429 });
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.createSessionFrom(3, 1));
		expect(err.status).toBe(429);
	});
});

// ============ A3:会话回收 ============

describe("UV-084 W1 HttpBackend - 会话回收", () => {
	test("reapSessions:POST /sessions/reap,返回计数", async () => {
		const fetchMock = mockFetchJson({ finished: 2, expired: 1, total: 3 });
		const backend = new HttpBackend(BASE, "tok-1");

		const result = await backend.reapSessions();

		expect(result.finished).toBe(2);
		expect(result.expired).toBe(1);
		expect(result.total).toBe(3);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/reap`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("reapSessions:0 计数如实返回(无可回收,不静默假装)", async () => {
		mockFetchJson({ finished: 0, expired: 0, total: 0 });
		const backend = new HttpBackend(BASE);

		const result = await backend.reapSessions();

		expect(result.total).toBe(0);
	});
});

// ============ A4:payload 注入 ============

describe("UV-084 W1 HttpBackend - payload 注入", () => {
	test("updatePayload:POST body { path, value },fact_id 返回", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			message: "PayloadUpdate submitted",
			fact_id: 30001,
		});
		const backend = new HttpBackend(BASE, "tok-1");

		const result = await backend.updatePayload(3, "shared.tenant.quota", 42);

		expect(result.success).toBe(true);
		expect(result.fact_id).toBe(30001);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/payload`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
		expect(JSON.parse(init.body as string)).toEqual({
			path: "shared.tenant.quota",
			value: 42,
		});
	});

	test("updatePayload:200 + success=false(命令通道关闭)如实返回,不静默", async () => {
		mockFetchJson({
			success: false,
			message: "Command channel closed (reactor exited)",
			fact_id: null,
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.updatePayload(3, "demo.path", 1);

		expect(result.success).toBe(false);
		expect(result.message).toContain("Command channel closed");
	});

	test("updatePayload:403 受保护域抛 HttpBackendError(消息含 server 指引)", async () => {
		mockFetchJson(
			{
				success: false,
				message:
					"写入受保护域 stable.llm 被拒绝:stable.llm / stable.system 仅受信服务管道可写。服务端需配置 EVORULE_SERVICE_TOKEN,调用方(如 evo-agent)需携带该 service token。",
				fact_id: null,
			},
			{ status: 403 },
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(
			backend.updatePayload(3, "shared.x.stable.llm.prompt", "hijack"),
		);
		expect(err.status).toBe(403);
		// 错误消息含响应体摘要(修复指引透出,不吞)
		expect(err.message).toContain("EVORULE_SERVICE_TOKEN");
	});

	test("updatePayload:404 会话不存在抛 HttpBackendError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.updatePayload(99, "p", 1));
		expect(err.status).toBe(404);
	});
});

// ============ A5:共享事实 ============

describe("UV-084 W1 HttpBackend - 共享事实", () => {
	test("getSharedFacts:GET /shared/facts,prefix 编码 + 裸数组解析", async () => {
		const fetchMock = mockFetchJson([
			{
				fact_id: 9101,
				path: "shared.platform.last_login.username",
				value: "demo-user",
				source_session_id: 1,
				version: 3,
			},
		]);
		const backend = new HttpBackend(BASE, "tok-1");

		const facts = await backend.getSharedFacts("shared.platform.");

		expect(facts).toHaveLength(1);
		expect(facts[0].fact_id).toBe(9101);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			`${BASE}/api/shared/facts?prefix=${encodeURIComponent("shared.platform.")}`,
		);
		expect(init.method).toBeUndefined(); // 默认 GET
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("getSharedFacts:prefix 缺省 = 全部(无 query)", async () => {
		const fetchMock = mockFetchJson([]);
		const backend = new HttpBackend(BASE);

		await backend.getSharedFacts();

		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/shared/facts`);
	});

	test("getSharedFacts:{ facts: [...] } 包装形态兜底解析", async () => {
		mockFetchJson({
			facts: [
				{
					fact_id: 9102,
					path: "shared.tenant.quota",
					value: 42,
					source_session_id: 2,
					version: 6,
				},
			],
		});
		const backend = new HttpBackend(BASE);

		const facts = await backend.getSharedFacts();

		expect(facts).toHaveLength(1);
		expect(facts[0].path).toBe("shared.tenant.quota");
	});

	test("getSharedFactsVersion:GET /shared/facts/version,返回 { version, history_len }", async () => {
		const fetchMock = mockFetchJson({ version: 9, history_len: 3 });
		const backend = new HttpBackend(BASE, "tok-1");

		const info = await backend.getSharedFactsVersion();

		expect(info.version).toBe(9);
		expect(info.history_len).toBe(3);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/shared/facts/version`);
	});
});
