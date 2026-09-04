// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// UV-084 W3 单测:HttpBackend A-流权限策略族 9 方法
// (list/get/create/update/delete/submit/review/version/evaluate)。
//
// 运行: npx vitest run src/lib/kernel/backend/__tests__/http-backend-wave4.test.ts
//
// 测试范围(mock 全局 fetch,零真实网络):
//   - URL/方法/请求体对齐 evorule-server permissions.rs 端点形状(源码级核实)
//   - Bearer 头携带(authToken 构造)
//   - 响应解析(getPermission 的 {success, entry} 解包)
//   - 错误纪律:非 2xx 抛 HttpBackendError(含 status/endpoint,消息含
//     server {"message"} 原文,LLM/用户可自诊断)
//
// 不测:
//   - 既有 42 方法(wave2/wave3 及既有覆盖)
//   - 真实 evorule-server 交互(集成测试范畴)

import { describe, test, expect, vi, afterEach } from "vitest";
import { HttpBackend, HttpBackendError } from "../http-backend";
import type { PermissionEntryRecord } from "../types";

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

/** 构造一条最小合法权限条目(对齐 PermissionEntryRecord) */
function sampleEntry(
	overrides: Partial<PermissionEntryRecord> = {},
): PermissionEntryRecord {
	return {
		id: "allow-human-read",
		version: 0,
		state: "draft",
		subject: { subject_type: "user", id: "human" },
		resource: { resource_type: "shared", path: "shared.platform.*" },
		action: "*",
		effect: "allow",
		scope: {},
		updated_by: "console",
		...overrides,
	};
}

describe("UV-084 W3 HttpBackend - 权限策略族", () => {
	test("listPermissions:GET /api/permissions,响应透传", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			version: 7,
			count: 2,
			entries: [sampleEntry(), sampleEntry({ id: "x2" })],
		});
		const backend = new HttpBackend(BASE, "tok-p");

		const result = await backend.listPermissions();

		expect(result.success).toBe(true);
		expect(result.version).toBe(7);
		expect(result.entries).toHaveLength(2);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions`);
		expect(init.method).toBeUndefined(); // GET 缺省
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-p",
		);
	});

	test("getPermission:GET /api/permissions/{id},{success, entry} 解包 + id 编码", async () => {
		const entry = sampleEntry({ id: "allow human/read" });
		const fetchMock = mockFetchJson({ success: true, entry });
		const backend = new HttpBackend(BASE);

		const result = await backend.getPermission("allow human/read");

		expect(result.id).toBe("allow human/read");
		expect(result.subject.id).toBe("human");
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			`${BASE}/api/permissions/${encodeURIComponent("allow human/read")}`,
		);
	});

	test("getPermission:404 抛 HttpBackendError,消息含 server 原文", async () => {
		mockFetchJson(
			{ success: false, message: "permission entry not found: nope" },
			{ status: 404 },
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.getPermission("nope"));

		expect(err.status).toBe(404);
		expect(err.message).toContain("permission entry not found: nope");
	});

	test("createPermission:POST /api/permissions,body 透传 + Bearer", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			id: "allow-human-read",
			state: "draft",
			version: 8,
		});
		const backend = new HttpBackend(BASE, "tok-p");
		const entry = sampleEntry();

		const result = await backend.createPermission(entry);

		expect(result.state).toBe("draft");
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions`);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-p",
		);
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body.id).toBe("allow-human-read");
	});

	test("createPermission:409 id 冲突抛错,消息含 server 原文(自诊断)", async () => {
		mockFetchJson(
			{ success: false, message: "duplicate permission id: allow-human-read" },
			{ status: 409 },
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(
			backend.createPermission(sampleEntry()),
		);

		expect(err.status).toBe(409);
		expect(err.message).toContain("duplicate permission id");
	});

	test("updatePermission:PUT /api/permissions/{id},path 与 body 一致透传", async () => {
		const fetchMock = mockFetchJson({ success: true, id: "e1", version: 9 });
		const backend = new HttpBackend(BASE);
		const entry = sampleEntry({ id: "e1" });

		await backend.updatePermission("e1", entry);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions/e1`);
		expect(init.method).toBe("PUT");
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body.id).toBe("e1");
	});

	test("deletePermission:DELETE /api/permissions/{id},无请求体", async () => {
		const fetchMock = mockFetchJson({ success: true, id: "e1" });
		const backend = new HttpBackend(BASE);

		const result = await backend.deletePermission("e1");

		expect(result.success).toBe(true);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions/e1`);
		expect(init.method).toBe("DELETE");
	});

	test("submitPermission:POST /api/permissions/{id}/submit,空 body POST", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			id: "e1",
			state: "candidate",
			version: 10,
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.submitPermission("e1");

		expect(result.state).toBe("candidate");
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions/e1/submit`);
		expect(init.method).toBe("POST");
	});

	test("submitPermission:400 状态不满足抛错(非 Draft 不可提交)", async () => {
		mockFetchJson(
			{
				success: false,
				message: "invalid permission state: only Draft can be submitted",
			},
			{ status: 400 },
		);
		const backend = new HttpBackend(BASE);

		const err = await expectHttpError(backend.submitPermission("e1"));

		expect(err.status).toBe(400);
		expect(err.message).toContain("only Draft can be submitted");
	});

	test("reviewPermission:POST /api/permissions/{id}/review,body {approve}", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			id: "e1",
			state: "active",
			version: 11,
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.reviewPermission("e1", true);

		expect(result.state).toBe("active");
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions/e1/review`);
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body.approve).toBe(true);
	});

	test("getPermissionsVersion:GET /api/permissions/version", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			version: 12,
			count: 3,
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.getPermissionsVersion();

		expect(result.version).toBe(12);
		expect(result.count).toBe(3);
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions/version`);
	});

	test("evaluatePermission:POST /api/permissions/evaluate,body 形状", async () => {
		const fetchMock = mockFetchJson({
			success: true,
			caller_role: "human",
			resource: "shared.platform.x",
			action: "*",
			v_trigger: 12,
			verdict: "allow",
		});
		const backend = new HttpBackend(BASE);

		const result = await backend.evaluatePermission({
			resource: "shared.platform.x",
			action: "*",
			caller_role: "human",
		});

		expect(result.verdict).toBe("allow");
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${BASE}/api/permissions/evaluate`);
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body.resource).toBe("shared.platform.x");
		expect(body.caller_role).toBe("human");
	});
});
