// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// UV-062 W2 单测:HttpBackend 审计导出/自动验证/调试只读/因果深度 11 方法。
//
// 运行: npx vitest run src/lib/kernel/backend/__tests__/http-backend-wave2.test.ts
//
// 测试范围(mock 全局 fetch,零真实网络):
//   - URL/方法/请求体对齐 evorule-server 端点形状
//   - Bearer 头携带(authToken 构造)
//   - 响应解析(JSON 透传 / Blob 二进制 / snapshot 200+error 透传)
//   - 错误纪律:非 2xx 抛 HttpBackendError(含 status/endpoint),
//     网络错误 status=0,均不静默
//
// 不测:
//   - 既有 17 方法(既有覆盖,见 cloud-http-backend.test.ts 代理冒烟)
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

/** mock 全局 fetch 返回二进制响应(gzip 导出用) */
function mockFetchBlob(
	body: Blob,
	opts: { contentType?: string } = {},
): ReturnType<typeof vi.fn> {
	const fn = vi.fn().mockResolvedValue(
		new Response(body, {
			status: 200,
			headers: {
				"content-type": opts.contentType ?? "application/gzip",
			},
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

// ============ 接线1:审计导出 ============

describe("UV-062 W2 HttpBackend - 审计导出", () => {
	test("exportAudit:GET /audit/export,JSON 透传 + Bearer", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			fact_count: 6,
			entries: [{ fact_id: 1 }],
		});
		const backend = new HttpBackend(BASE, "tok-1");

		const data = (await backend.exportAudit(3)) as {
			session_id: number;
			fact_count: number;
		};

		expect(data.session_id).toBe(3);
		expect(data.fact_count).toBe(6);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/audit/export`);
		expect(init.method).toBeUndefined(); // 默认 GET
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("exportAuditCompressed:GET /audit/export/compressed,返回 Blob + Bearer", async () => {
		const gzBytes = new Blob([new Uint8Array([0x1f, 0x8b, 0x00, 0x01])]);
		const fetchMock = mockFetchBlob(gzBytes);
		const backend = new HttpBackend(BASE, "tok-1");

		const blob = await backend.exportAuditCompressed(3);

		expect(blob).toBeInstanceOf(Blob);
		expect(blob.size).toBe(4);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/audit/export/compressed`);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("exportAuditCompressed:非 2xx 抛 HttpBackendError(不静默返回空 Blob)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("session not found", { status: 404 })),
		);
		const backend = new HttpBackend(BASE);

		await expect(backend.exportAuditCompressed(99)).rejects.toThrow(
			HttpBackendError,
		);
		await expect(backend.exportAuditCompressed(99)).rejects.toThrow("HTTP 404");
	});

	test("exportAudit:网络错误 → status=0 的 HttpBackendError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("fetch failed")),
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.exportAudit(1));
		expect(err.status).toBe(0);
		expect(err.message).toContain("network error");
	});
});

// ============ 接线2:auto_verify 开关 ============

describe("UV-062 W2 HttpBackend - auto_verify", () => {
	test("getAutoVerify:GET /audit/auto_verify,返回开关状态", async () => {
		const fetchMock = mockFetchJson({ session_id: 3, auto_verify: true });
		const backend = new HttpBackend(BASE, "tok-1");

		const status = await backend.getAutoVerify(3);

		expect(status).toEqual({ session_id: 3, auto_verify: true });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/audit/auto_verify`);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("setAutoVerify:POST /audit/auto_verify,只带 enabled(缺省不传 threshold/interval)", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			success: true,
			auto_verify: true,
			threshold: 0,
			interval: 1,
			message: "ok",
		});
		const backend = new HttpBackend(BASE);

		await backend.setAutoVerify(3, true);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/audit/auto_verify`);
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
	});

	test("setAutoVerify:可选参数 threshold/interval 一并传入请求体", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			success: true,
			auto_verify: true,
			threshold: 100,
			interval: 5,
			message: "ok",
		});
		const backend = new HttpBackend(BASE);

		await backend.setAutoVerify(3, true, 100, 5);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			enabled: true,
			threshold: 100,
			interval: 5,
		});
	});

	test("setAutoVerify:配置结果透传(server 语义字段)", async () => {
		mockFetchJson({
			session_id: 3,
			success: true,
			auto_verify: false,
			threshold: 0,
			interval: 1,
			message: "disabled",
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.setAutoVerify(3, false);

		expect(result.success).toBe(true);
		expect(result.auto_verify).toBe(false);
		expect(result.message).toBe("disabled");
	});

	test("getAutoVerify:session 不存在 → 404 抛错(含 endpoint)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.getAutoVerify(99));
		expect(err.status).toBe(404);
		expect(err.endpoint).toBe("/api/sessions/99/audit/auto_verify");
	});
});

// ============ 接线3:调试六路只读 ============

describe("UV-062 W2 HttpBackend - 调试只读六路", () => {
	test("getStep:GET /step,返回 current_step", async () => {
		const fetchMock = mockFetchJson({ session_id: 3, current_step: 42 });
		const backend = new HttpBackend(BASE);

		const step = await backend.getStep(3);

		expect(step.current_step).toBe(42);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/step`);
	});

	test("getSessionSnapshot:成功态字段透传", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			finished: false,
			phase: "stable",
			version: 6,
			steps: 6,
			pending_io_count: 0,
			structural_invariant_violations: 0,
		});
		const backend = new HttpBackend(BASE);

		const snapshot = await backend.getSessionSnapshot(3);

		expect(snapshot.phase).toBe("stable");
		expect(snapshot.error).toBeUndefined();
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/snapshot`);
	});

	test("getSessionSnapshot:200 + 仅 error 字段 → 原样透传(不编造数值)", async () => {
		mockFetchJson({ session_id: 3, error: "reactor task finished" });
		const backend = new HttpBackend(BASE);

		const snapshot = await backend.getSessionSnapshot(3);

		expect(snapshot.error).toBe("reactor task finished");
		expect(snapshot.steps).toBeUndefined();
		expect(snapshot.phase).toBeUndefined();
	});

	test("getDebugPhase:GET /debug/phase,null 透传(未启动)", async () => {
		const fetchMock = mockFetchJson({ session_id: 3, phase: null });
		const backend = new HttpBackend(BASE);

		const info = await backend.getDebugPhase(3);

		expect(info.phase).toBeNull();
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/debug/phase`);
	});

	test("getDebugPhase:非 null 阶段透传", async () => {
		mockFetchJson({ session_id: 3, phase: "awaiting_io" });
		const backend = new HttpBackend(BASE);

		expect((await backend.getDebugPhase(3)).phase).toBe("awaiting_io");
	});

	test("getDebugQueue:GET /debug/queue,队列透传", async () => {
		const fetchMock = mockFetchJson({ session_id: 3, queue: [] });
		const backend = new HttpBackend(BASE);

		const q = await backend.getDebugQueue(3);

		expect(q.queue).toEqual([]);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/debug/queue`);
	});

	test("getDebugPendingIo:GET /debug/pending_io,计数与列表透传", async () => {
		const fetchMock = mockFetchJson({
			session_id: 3,
			pending_io_count: 2,
			pending_io: [{ id: 1 }, { id: 2 }],
		});
		const backend = new HttpBackend(BASE);

		const p = await backend.getDebugPendingIo(3);

		expect(p.pending_io_count).toBe(2);
		expect(p.pending_io).toHaveLength(2);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/debug/pending_io`);
	});

	test("getPendingIoCount:GET /pending_io_count", async () => {
		const fetchMock = mockFetchJson({ session_id: 3, pending_io_count: 7 });
		const backend = new HttpBackend(BASE);

		const c = await backend.getPendingIoCount(3);

		expect(c.pending_io_count).toBe(7);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/pending_io_count`);
	});

	test("调试端点 500 → HttpBackendError(六路独立错误由调用方按通道渲染)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("internal error", { status: 500 })),
		);
		const backend = new HttpBackend(BASE);

		await expect(backend.getStep(3)).rejects.toThrow("HTTP 500");
		await expect(backend.getDebugPhase(3)).rejects.toThrow(HttpBackendError);
	});
});

// ============ 接线4:因果深度 ============

describe("UV-062 W2 HttpBackend - causal_depth", () => {
	test("getCausalDepth:GET /causal_depth,返回深度值", async () => {
		const fetchMock = mockFetchJson({ session_id: 3, causal_depth: 6 });
		const backend = new HttpBackend(BASE, "tok-1");

		const info = await backend.getCausalDepth(3);

		expect(info.causal_depth).toBe(6);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/sessions/3/causal_depth`);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("getCausalDepth:404 抛错(含 endpoint)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.getCausalDepth(99));
		expect(err.status).toBe(404);
		expect(err.endpoint).toBe("/api/sessions/99/causal_depth");
	});
});
