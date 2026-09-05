// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 部署通道单测 — 治理 Published → 执行域导入激活(32 号 UI 接线)
//
// 运行: npx vitest run src/lib/backend/__tests__/bundle-deploy-channel.test.ts
//
// 测试范围:
//   - HttpWorkspaceBackend.importBundle/dryRunImportBundle/listActiveBundles
//     (端点、请求体 {bundle} 包裹、响应形态兼容)
//   - CloudWorkspaceBackend 透传(委托内核实现)
//   - GovernanceBackend.exportBundle(POST /v1/bundles/export;
//     人工确认 → verdict=pass,未确认 → verdict=fail,不伪造)
//
// 不测:
//   - server 侧 6 项校验链(见 evorule-server 仓 90 项测试)
//   - 对话框交互(svelte 组件渲染,e2e 覆盖)

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HttpWorkspaceBackend } from '$lib/kernel';
import { CloudWorkspaceBackend } from '../cloud-workspace-backend';
import { GovernanceBackend } from '../../governance/governance-backend';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okResponse(body: unknown, status = 200): Response {
	return {
		ok: true,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe('HttpWorkspaceBackend 快照包导入(执行域通道)', () => {
	test('importBundle → POST /api/bundles/import,body 包裹 {bundle}', async () => {
		const hb = new HttpWorkspaceBackend();
		const bundle = { dataset_id: 'ds-1', version: 'V2' };
		mockFetch.mockResolvedValue(
			okResponse(
				{
					imported: true,
					bundle_id: 'b1',
					dataset_id: 'ds-1',
					activated_version: 'V2',
					entry_count: 5,
					missing_services: [],
				},
				201
			)
		);

		const r = await hb.importBundle(bundle);

		expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:18080/api/bundles/import');
		const init = mockFetch.mock.calls[0][1] as RequestInit;
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ bundle });
		expect(r.imported).toBe(true);
		expect(r.activated_version).toBe('V2');
	});

	test('importBundle 失败 → 抛错携带 server 错误原文(不静默)', async () => {
		const hb = new HttpWorkspaceBackend();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({}),
			text: async () => '{"error":"闸门一:沙箱验证未通过"}',
		} as unknown as Response);

		await expect(hb.importBundle({})).rejects.toThrow(/闸门一/);
	});

	test('dryRunImportBundle → POST /api/bundles/import/dry-run', async () => {
		const hb = new HttpWorkspaceBackend();
		mockFetch.mockResolvedValue(
			okResponse({
				valid: true,
				bundle_id: 'b1',
				dataset_id: 'ds-1',
				source_version: 'V2',
				selection_mode: 'pinned',
				resolved_version: 'V2',
				entry_count: 5,
				verdict: 'pass',
				missing_services: [],
			})
		);

		const r = await hb.dryRunImportBundle({ dataset_id: 'ds-1' });

		expect(mockFetch.mock.calls[0][0]).toContain('/api/bundles/import/dry-run');
		expect(r.valid).toBe(true);
		expect(r.entry_count).toBe(5);
	});

	test('listActiveBundles → GET /api/bundles/active,兼容数组与 {bundles} 两种形态', async () => {
		const hb = new HttpWorkspaceBackend();
		const item = {
			bundle_id: 'b1',
			dataset_id: 'ds-1',
			source_version: 'V2',
			selection_mode: 'pinned',
			resolved_version: 'V2',
			effective_from: null,
			content_hash: 'abc123',
			entry_count: 5,
		};

		mockFetch.mockResolvedValueOnce(okResponse([item]));
		expect(await hb.listActiveBundles()).toHaveLength(1);

		mockFetch.mockResolvedValueOnce(okResponse({ bundles: [item] }));
		expect(await hb.listActiveBundles()).toHaveLength(1);
	});
});

describe('CloudWorkspaceBackend 透传(部署通道)', () => {
	test('importBundle 委托内核 → 相同端点与请求体', async () => {
		const wb = new CloudWorkspaceBackend({
			mode: 'offline',
			localBaseUrl: 'http://localhost:18080',
		});
		mockFetch.mockResolvedValue(
			okResponse(
				{
					imported: true,
					bundle_id: 'b1',
					dataset_id: 'ds-1',
					activated_version: 'V1',
					entry_count: 3,
					missing_services: [],
				},
				201
			)
		);

		const r = await wb.importBundle({ dataset_id: 'ds-1', version: 'V1' });

		expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:18080/api/bundles/import');
		expect(r.imported).toBe(true);
	});
});

describe('GovernanceBackend.buildTestsForEvidence(证据三形态构造,UV-058 W1.3)', () => {
	test('sandbox-report 机器背书 → subset 引用沙盒 ID + verdict 透传(不伪造:fail 报告如实 fail)', () => {
		expect(
			GovernanceBackend.buildTestsForEvidence({ kind: 'sandbox-report', sandboxId: 7, verdict: 'pass' })
		).toEqual({ subset: ['sandbox:7'], verdict: 'pass' });
		expect(
			GovernanceBackend.buildTestsForEvidence({ kind: 'sandbox-report', sandboxId: 9, verdict: 'fail' })
		).toEqual({ subset: ['sandbox:9'], verdict: 'fail' });
	});

	test('human-confirmed 人工降级 → subset 带 human:<actor> 标记(降级可追溯)+ verdict=pass', () => {
		expect(
			GovernanceBackend.buildTestsForEvidence({ kind: 'human-confirmed', actor: 'admin' })
		).toEqual({ subset: ['human:admin'], verdict: 'pass' });
	});

	test('none 无证据 → verdict=fail(执行侧闸门一硬拒,不静默)', () => {
		expect(GovernanceBackend.buildTestsForEvidence({ kind: 'none' })).toEqual({ verdict: 'fail' });
	});
});

describe('GovernanceBackend.exportBundle(带证据导出)', () => {
	const gb = new GovernanceBackend('http://localhost:18081', 't1');

	/** 先 mock 登录拿 token(exportBundle 走认证请求) */
	async function login(): Promise<void> {
		mockFetch.mockResolvedValueOnce(okResponse({ access_token: 'jwt-test' }));
		await gb.login('u1', 'pw');
	}

	test('sandbox-report 机器背书 → POST /v1/bundles/export 且 tests={subset:[sandbox:id],verdict:pass}', async () => {
		await login();
		mockFetch.mockResolvedValue(okResponse({ bundle: { dataset_id: 'ds-1' } }));

		await gb.exportBundle('ds-1', 'V2', { kind: 'sandbox-report', sandboxId: 7, verdict: 'pass' });

		const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
		expect(url).toBe('http://localhost:18081/v1/bundles/export');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({
			dataset_id: 'ds-1',
			version: 'V2',
			tests: { subset: ['sandbox:7'], verdict: 'pass' }
		});
	});

	test('human-confirmed 人工降级 → tests={subset:[human:actor],verdict:pass}(显式降级可追溯)', async () => {
		await login();
		mockFetch.mockResolvedValue(okResponse({ bundle: {} }));

		await gb.exportBundle('ds-1', 'V2', { kind: 'human-confirmed', actor: 'admin' });

		const init = mockFetch.mock.calls[1][1] as RequestInit;
		expect(JSON.parse(init.body as string).tests).toEqual({
			subset: ['human:admin'],
			verdict: 'pass'
		});
	});

	test('none 无证据 → verdict=fail(导出不可导入执行域的预览包,不伪造)', async () => {
		await login();
		mockFetch.mockResolvedValue(okResponse({ bundle: {} }));

		await gb.exportBundle('ds-1', 'V2', { kind: 'none' });

		const init = mockFetch.mock.calls[1][1] as RequestInit;
		expect(JSON.parse(init.body as string).tests.verdict).toBe('fail');
	});
});

describe('GovernanceBackend knowledge 条目在线编辑(UV-086)', () => {
	const gb = new GovernanceBackend('http://localhost:18081', 't1');

	/** 先 mock 登录拿 token(条目操作走认证请求) */
	async function login(): Promise<void> {
		mockFetch.mockResolvedValueOnce(okResponse({ access_token: 'jwt-test' }));
		await gb.login('u1', 'pw');
	}

	test('addKnowledgeEntry → POST /v1/datasets/{id}/entries,body 为 knowledge 分流形状(payload+schema_ref)', async () => {
		await login();
		mockFetch.mockResolvedValue(
			okResponse({ entry_id: 'kn-1', version: 1, payload: { a: 1 }, schema_ref: 's.json' })
		);

		await gb.addKnowledgeEntry('ds-kn', {
			entry_id: 'kn-1',
			version: 1,
			payload: { a: 1 },
			schema_ref: 's.json',
			tags: ['t']
		});

		const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
		expect(url).toBe('http://localhost:18081/v1/datasets/ds-kn/entries');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({
			entry_id: 'kn-1',
			version: 1,
			payload: { a: 1 },
			schema_ref: 's.json',
			tags: ['t']
		});
	});

	test('addKnowledgeEntry schema 未命中 → 抛错携带 server 错误原文(不静默)', async () => {
		await login();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({ error: { code: 'schema_not_found', message: 'schema_ref 未注册: s.json' } }),
			text: async () => '',
		} as unknown as Response);

		await expect(
			gb.addKnowledgeEntry('ds-kn', { entry_id: 'kn-1', version: 1, payload: {}, schema_ref: 's.json' })
		).rejects.toThrow(/schema_ref 未注册/);
	});

	test('patchKnowledgeEntry → PATCH /v1/entries/{id},缺省字段不携带(server 逐字段 if-let)', async () => {
		await login();
		mockFetch.mockResolvedValue(
			okResponse({ entry_id: 'kn-1', version: 1, payload: { a: 2 }, schema_ref: 's.json' })
		);

		await gb.patchKnowledgeEntry('kn-1', { payload: { a: 2 } });

		const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
		expect(url).toBe('http://localhost:18081/v1/entries/kn-1');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body as string)).toEqual({ payload: { a: 2 } });
	});

	test('patchKnowledgeEntry 原地改已生效条目 → server 400 拒绝原文透出(frozen 语义不静默)', async () => {
		await login();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({ error: { code: 'entry_frozen', message: '已生效条目不可原地修改,请创建新版本' } }),
			text: async () => '',
		} as unknown as Response);

		await expect(gb.patchKnowledgeEntry('kn-1', { tags: ['x'] })).rejects.toThrow(/不可原地修改/);
	});

	test('deleteEntry → DELETE /v1/entries/{id},204 无 body 正常返回', async () => {
		await login();
		mockFetch.mockResolvedValue({
			ok: true,
			status: 204,
			headers: new Headers(),
			json: async () => {
				throw new Error('204 不应有 body');
			},
			text: async () => '',
		} as unknown as Response);

		await gb.deleteEntry('kn-1');

		const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
		expect(url).toBe('http://localhost:18081/v1/entries/kn-1');
		expect(init.method).toBe('DELETE');
	});

	test('deleteEntry 删非 Draft 条目 → server 400 拒绝原文透出(status 缺省视同 Active)', async () => {
		await login();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({ error: { code: 'not_draft', message: '仅 Draft 条目可删除' } }),
			text: async () => '',
		} as unknown as Response);

		await expect(gb.deleteEntry('kn-1')).rejects.toThrow(/仅 Draft 条目可删除/);
	});
});
