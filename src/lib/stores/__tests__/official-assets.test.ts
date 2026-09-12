// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 官方资产 store 单测(47 号接线专项)— 准入判定 / 发现刷新 / 预览包导出 / 部署导航
//
// 覆盖:
//   - isOfficialAsset 准入谓词:public+Published 通过;private/未审批形态拒绝
//   - officialAssets 派生列表按准入过滤
//   - refreshOfficialAssets:未连接显式报错(带指引);连接态转发 refreshDatasets
//   - buildAssetPreviewBundle:evidence=none 语义坐实(执行域必拒导入的预览包);
//     未连接显式报错;忙态 downloadingId 收敛
//   - deployOfficialAsset:未连接显式报错;连接态 selectDataset + 导航治理页
//   - reconnectWithSavedConfig:无已存凭据显式报错带指引;凭据判定谓词

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	isOfficialAsset,
	officialAssets,
	officialAssetsUi,
	refreshOfficialAssets,
	buildAssetPreviewBundle,
	previewBundleFilename,
	deployOfficialAsset,
	resetOfficialAssetsUi,
	hasSavedGovernanceConfig,
	reconnectWithSavedConfig
} from '../official-assets';
import { governanceStore, disconnect } from '$lib/governance/governance-store';
import { governanceConfig } from '$lib/config/governance-config';
import type { GovernanceDataset } from '$lib/governance/types';

// mock $app/navigation 的 goto(部署导航跳转用)
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

// mock $app/environment:browser=false 让 store 跳过 localStorage(SSR/test 安全)
vi.mock('$app/environment', () => ({
	browser: false
}));

import { goto } from '$app/navigation';

function makeDataset(overrides: Partial<GovernanceDataset> = {}): GovernanceDataset {
	return {
		dataset_id: 'ds-finance',
		name: '财务合规数据集',
		description: '官方财务数据集',
		dataset_kind: 'rule_set',
		domain: ['finance'],
		tags: ['官方'],
		tenant_id: 'default',
		visibility: 'public',
		lifecycle: { status: 'Published', state_history: [] },
		versioning: { current: 'V3', chain: ['V1', 'V2', 'V3'] },
		meta: { created_at: '2026-09-06T00:00:00Z', created_by: 'admin' },
		...overrides
	} as GovernanceDataset;
}

function connectFakeBackend(backend: Record<string, unknown>): void {
	governanceStore.set({
		backend: backend as never,
		baseUrl: 'http://127.0.0.1:18081',
		tenantId: 'default',
		username: 'admin',
		role: 'admin',
		connected: true,
		connecting: false,
		error: null,
		datasets: [],
		loadingDatasets: false,
		selectedId: null,
		entries: [],
		loadingEntries: false,
		versioning: null
	});
}

describe('isOfficialAsset — 官方资产准入谓词', () => {
	test('public + Published 通过', () => {
		expect(isOfficialAsset(makeDataset())).toBe(true);
	});

	test('private 拒绝(未公开声明)', () => {
		expect(isOfficialAsset(makeDataset({ visibility: 'private' }))).toBe(false);
	});

	test('未审批生命周期拒绝(Draft/Candidate/Active/Rejected 均不对市场暴露)', () => {
		for (const status of ['Draft', 'Candidate', 'Active', 'Rejected'] as const) {
			expect(
				isOfficialAsset(makeDataset({ lifecycle: { status, state_history: [] } }))
			).toBe(false);
		}
	});
});

describe('officialAssets — 派生列表过滤', () => {
	afterEach(() => {
		disconnect();
		resetOfficialAssetsUi();
	});

	test('只保留 public+Published 资产', () => {
		connectFakeBackend({});
		governanceStore.update((s) => ({
			...s,
			datasets: [
				makeDataset(),
				makeDataset({ dataset_id: 'ds-draft', visibility: 'public', lifecycle: { status: 'Draft', state_history: [] } }),
				makeDataset({ dataset_id: 'ds-private', visibility: 'private' })
			]
		}));
		const assets = get(officialAssets);
		expect(assets.map((d) => d.dataset_id)).toEqual(['ds-finance']);
	});
});

describe('refreshOfficialAssets — 发现刷新', () => {
	afterEach(() => {
		disconnect();
		resetOfficialAssetsUi();
	});

	test('未连接:显式报错带连接指引,不静默', async () => {
		disconnect();
		await expect(refreshOfficialAssets()).rejects.toThrow(/治理服务未连接/);
		expect(get(officialAssetsUi).error).toContain('18081');
	});

	test('连接态:转发 refreshDatasets,列表与派生资产同步', async () => {
		const listDatasets = vi
			.fn()
			.mockResolvedValue([makeDataset(), makeDataset({ dataset_id: 'ds-x', visibility: 'private' })]);
		connectFakeBackend({ listDatasets });
		await refreshOfficialAssets();
		expect(listDatasets).toHaveBeenCalledTimes(1);
		expect(get(governanceStore).datasets).toHaveLength(2);
		expect(get(officialAssets).map((d) => d.dataset_id)).toEqual(['ds-finance']);
		expect(get(officialAssetsUi).error).toBeNull();
	});

	test('刷新失败:错误原文写入 UI 态并上抛', async () => {
		connectFakeBackend({ listDatasets: vi.fn().mockRejectedValue(new Error('HTTP 500')) });
		await expect(refreshOfficialAssets()).rejects.toThrow('HTTP 500');
		expect(get(officialAssetsUi).error).toBe('HTTP 500');
	});
});

describe('buildAssetPreviewBundle — 无证据预览包导出', () => {
	afterEach(() => {
		disconnect();
		resetOfficialAssetsUi();
	});

	test('evidence=none 语义坐实:exportBundle 收到 {kind:"none"} + 当前版本', async () => {
		const exportBundle = vi.fn().mockResolvedValue({ bundle_version: '1.0', dataset_id: 'ds-finance' });
		connectFakeBackend({ exportBundle });
		const ds = makeDataset();
		const { filename, blob } = await buildAssetPreviewBundle(ds);
		expect(exportBundle).toHaveBeenCalledWith('ds-finance', 'V3', { kind: 'none' });
		expect(filename).toBe('财务合规数据集-V3-preview.json');
		const text = await blob.text();
		expect(JSON.parse(text)).toMatchObject({ dataset_id: 'ds-finance' });
		// 忙态收敛
		expect(get(officialAssetsUi).downloadingId).toBeNull();
	});

	test('文件名净化:非法字符替换为下划线', () => {
		const ds = makeDataset({ name: 'a/b:c*?<>|"d' });
		expect(previewBundleFilename(ds)).toBe('a_b_c_d-V3-preview.json');
	});

	test('未连接:显式报错不静默', async () => {
		disconnect();
		await expect(buildAssetPreviewBundle(makeDataset())).rejects.toThrow(/治理服务未连接/);
		expect(get(officialAssetsUi).error).toContain('治理服务未连接');
	});

	test('导出失败:错误原文写入 UI 态,忙态收敛', async () => {
		connectFakeBackend({ exportBundle: vi.fn().mockRejectedValue(new Error('HTTP 403')) });
		await expect(buildAssetPreviewBundle(makeDataset())).rejects.toThrow('HTTP 403');
		expect(get(officialAssetsUi).error).toBe('HTTP 403');
		expect(get(officialAssetsUi).downloadingId).toBeNull();
	});
});

describe('deployOfficialAsset — 部署导航(接既有证据门禁面板)', () => {
	afterEach(() => {
		disconnect();
		resetOfficialAssetsUi();
		vi.clearAllMocks();
	});

	test('未连接:显式报错不导航', () => {
		disconnect();
		expect(() => deployOfficialAsset(makeDataset())).toThrow(/治理服务未连接/);
		expect(goto).not.toHaveBeenCalled();
	});

	test('连接态:选中数据集 + 导航 /governance?deploy=<id>', async () => {
		const listEntries = vi.fn().mockResolvedValue([]);
		const listVersions = vi.fn().mockResolvedValue({ current: 'V3', chain: ['V3'] });
		connectFakeBackend({ listEntries, listVersions, listKnowledgeEntries: vi.fn() });
		deployOfficialAsset(makeDataset());
		expect(goto).toHaveBeenCalledWith('/governance?deploy=ds-finance');
		// selectDataset 触发条目/版本加载(异步落地后选中态成立)
		await vi.waitFor(() => {
			expect(get(governanceStore).selectedId).toBe('ds-finance');
		});
	});
});

describe('reconnectWithSavedConfig — 已存凭据一键重连', () => {
	// UV-178 批次E+:GovernanceConfig 增 passwordStorage/locked(plain 形态即旧版行为)
	const fullConfig = {
		baseUrl: 'http://127.0.0.1:18081',
		tenantId: 'default',
		username: 'admin',
		password: 'secret',
		passwordStorage: 'plain' as const,
		locked: false
	};

	afterEach(() => {
		governanceConfig.set({
			baseUrl: 'http://127.0.0.1:18081',
			tenantId: 'default',
			username: '',
			password: '',
			passwordStorage: 'none',
			locked: false
		});
		resetOfficialAssetsUi();
	});

	test('hasSavedGovernanceConfig:用户名与密码齐备才为 true', () => {
		governanceConfig.set(fullConfig);
		expect(hasSavedGovernanceConfig()).toBe(true);
		governanceConfig.set({ ...fullConfig, password: '' });
		expect(hasSavedGovernanceConfig()).toBe(false);
		governanceConfig.set({ ...fullConfig, username: '   ' });
		expect(hasSavedGovernanceConfig()).toBe(false);
	});

	test('无已存凭据:显式报错带指引,不发起连接', async () => {
		governanceConfig.set({
			baseUrl: 'http://127.0.0.1:18081',
			tenantId: 'default',
			username: '',
			password: '',
			passwordStorage: 'none',
			locked: false
		});
		await expect(reconnectWithSavedConfig()).rejects.toThrow(/已存治理凭据/);
		expect(get(officialAssetsUi).error).toContain('手动输入连接');
	});
});
