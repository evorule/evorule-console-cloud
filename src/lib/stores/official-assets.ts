// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 官方资产 store — marketplace「官方资产」分区的数据与动作层(47 号接线专项)。
//
// 数据源:治理服务(evorule-rule :18081)经 governanceStore 单例会话,零新端点:
//   - 发现 = GET /v1/datasets(governanceStore.refreshDatasets 既有实现)
//   - 官方资产准入 = visibility === 'public' && lifecycle.status === 'Published'
//     (运营方公开声明 + 独立发布审批通过;Draft/Candidate 等未审批形态不对市场暴露)
// 动作(全部复用既有通道,不绕任何闸门):
//   - 下载预览包:exportBundle(id, current, {kind:'none'}) —— 无证据预览包,
//     verdict=fail,执行域闸门一必拒导入;语义如实标注为"预览",不伪装可部署
//   - 部署到执行域:selectDataset + 导航 /governance?deploy=<id>,落进治理页
//     既有证据门禁部署面板(沙盒机器背书默认/人工确认显式降级 + 部署确认勾选
//     + dry-run 预检),市场内不复刻证据 UX,更不提供零证据直达导入
// 错误纪律:全部显式上屏/上抛(未连接报错带连接指引),拒绝静默回落。

import { derived, get, writable } from 'svelte/store';
import { goto } from '$app/navigation';
import {
	connect,
	governanceStore,
	refreshDatasets,
	selectDataset
} from '$lib/governance/governance-store';
import { governanceConfig } from '$lib/config/governance-config';
import type { GovernanceDataset } from '$lib/governance/types';

// ============================================================================
// 1. 官方资产判定与派生列表
// ============================================================================

/** 官方资产准入谓词:公开 + 已发布(独立审批通过) */
export function isOfficialAsset(d: GovernanceDataset): boolean {
	return d.visibility === 'public' && d.lifecycle?.status === 'Published';
}

/** 官方资产列表(派生自治理会话;未连接/无资产时为空数组,由 UI 空态表达) */
export const officialAssets = derived(governanceStore, ($g) =>
	$g.datasets.filter(isOfficialAsset),
);

// ============================================================================
// 2. 分区 UI 状态(loading / 下载中 / 错误原文)
// ============================================================================

export interface OfficialAssetsUiState {
	/** 正在刷新资产列表 */
	loading: boolean;
	/** 正在导出预览包的数据集 ID(卡片按钮忙态) */
	downloadingId: string | null;
	/** 最近一次动作错误原文(显式上屏,不静默) */
	error: string | null;
}

const initialUi: OfficialAssetsUiState = { loading: false, downloadingId: null, error: null };
export const officialAssetsUi = writable<OfficialAssetsUiState>(initialUi);

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

// ============================================================================
// 3. 动作
// ============================================================================

/**
 * 刷新官方资产列表(转发治理会话 refreshDatasets)。
 * 未连接治理服务时显式抛错(带连接指引);失败原文写入 UI 态并上抛。
 */
export async function refreshOfficialAssets(): Promise<void> {
	const s = get(governanceStore);
	if (!s.connected) {
		const message = '治理服务未连接:请先在治理中心连接 evorule-rule(:18081)';
		officialAssetsUi.update((u) => ({ ...u, error: message }));
		throw new Error(message);
	}
	officialAssetsUi.update((u) => ({ ...u, loading: true, error: null }));
	try {
		await refreshDatasets();
	} catch (e) {
		officialAssetsUi.update((u) => ({ ...u, error: errorMessage(e) }));
		throw e;
	} finally {
		officialAssetsUi.update((u) => ({ ...u, loading: false }));
	}
}

/** 预览包文件名:{name}-{version}-preview.json(去除文件系统非法字符) */
export function previewBundleFilename(d: GovernanceDataset): string {
	const safeName = d.name.replace(/[\\/:*?"<>|]+/g, '_');
	return `${safeName}-${d.versioning.current}-preview.json`;
}

/**
 * 构建资产预览包(evidence=none):无证据导出,执行域闸门一必拒导入,
 * 仅用于本地检视 bundle 形态。返回 { filename, blob } 由调用方触发浏览器保存
 * (DOM 触发器保持薄,便于单测聚焦导出语义)。
 */
export async function buildAssetPreviewBundle(
	d: GovernanceDataset
): Promise<{ filename: string; blob: Blob }> {
	const s = get(governanceStore);
	if (!s.connected || !s.backend) {
		const message = '治理服务未连接:请先在治理中心连接 evorule-rule';
		officialAssetsUi.update((u) => ({ ...u, error: message }));
		throw new Error(message);
	}
	officialAssetsUi.update((u) => ({ ...u, downloadingId: d.dataset_id, error: null }));
	try {
		const bundle = await s.backend.exportBundle(d.dataset_id, d.versioning.current, {
			kind: 'none'
		});
		return {
			filename: previewBundleFilename(d),
			blob: new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
		};
	} catch (e) {
		officialAssetsUi.update((u) => ({ ...u, error: errorMessage(e) }));
		throw e;
	} finally {
		officialAssetsUi.update((u) => ({ ...u, downloadingId: null }));
	}
}

/**
 * 部署官方资产:选中数据集并导航至治理中心部署面板(?deploy=<id>)。
 * 部署动作本身在治理页既有证据门禁面板内完成 —— 市场只负责发现与跳转。
 */
export function deployOfficialAsset(d: GovernanceDataset): void {
	const s = get(governanceStore);
	if (!s.connected) {
		const message = '治理服务未连接:请先在治理中心连接 evorule-rule';
		officialAssetsUi.update((u) => ({ ...u, error: message }));
		throw new Error(message);
	}
	selectDataset(d.dataset_id);
	void goto(`/governance?deploy=${encodeURIComponent(d.dataset_id)}`);
}

/** 重置 UI 态(测试用;不动治理会话) */
export function resetOfficialAssetsUi(): void {
	officialAssetsUi.set({ ...initialUi });
}

// ============================================================================
// 4. 已存凭据一键重连(整页刷新后治理会话丢失的 UX 摩擦收敛)
// ============================================================================

/**
 * 是否存在可用的已存治理凭据(governanceConfig 本地持久化,见 governance-config.ts)。
 * 仅作 UI 显隐判定;不预判凭据有效性——连接失败照常显式报错。
 */
export function hasSavedGovernanceConfig(): boolean {
	const cfg = get(governanceConfig);
	return cfg.username.trim() !== '' && cfg.password !== '';
}

/**
 * 用已存凭据重连治理服务(转发治理页同一 connect() 通道,不新造登录逻辑)。
 * 无已存凭据时显式抛错带指引(不静默);失败原文写入 UI 态并上抛。
 * 语义等同用户回到治理中心表单点"连接"——不改变任何安全模型。
 */
export async function reconnectWithSavedConfig(): Promise<void> {
	const cfg = get(governanceConfig);
	if (!hasSavedGovernanceConfig()) {
		const message = '无已存治理凭据:请到治理中心手动输入连接';
		officialAssetsUi.update((u) => ({ ...u, error: message }));
		throw new Error(message);
	}
	officialAssetsUi.update((u) => ({ ...u, loading: true, error: null }));
	try {
		await connect(cfg.baseUrl, cfg.tenantId, cfg.username, cfg.password);
	} catch (e) {
		officialAssetsUi.update((u) => ({ ...u, error: errorMessage(e) }));
		throw e;
	} finally {
		officialAssetsUi.update((u) => ({ ...u, loading: false }));
	}
}
