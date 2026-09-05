// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理会话 store(Phase 2 F1)
//
// 职责:
//   - 持有 GovernanceBackend 实例(连接 evorule-rule REST)
//   - 连接态、数据集列表、选中数据集、条目列表、版本链
//   - 5 态生命周期 + 审批发布动作封装
//
// 生命周期:Draft → Candidate → Active → Published → Rejected
//   candidate/active/rejected → PATCH /datasets/{id}/lifecycle
//   published → POST /datasets/{id}/publish(独立发布审批,confirm=true)
//   Rejected(撤销发布) → POST /datasets/{id}/unpublish(管理端)
//
// 错误纪律:不静默吞错 —— 每个动作失败都会写入 state.error 并向上抛出,
//          UI 层捕获后 toast 展示后端 error.message。

import { writable, get } from 'svelte/store';
import { GovernanceBackend, GovernanceError } from './governance-backend';
import type {
	AddEntryRequest,
	AddKnowledgeEntryRequest,
	CreateDatasetRequest,
	GovernanceDataset,
	GovernanceEntry,
	KnowledgeEntry,
	LawRef,
	PatchKnowledgeEntryRequest,
	VersioningInfo
} from './types';

/** 条目（规则或数据资产，按选中数据集 dataset_kind 分流） */
export type GovernanceItem = GovernanceEntry | KnowledgeEntry;

export interface GovernanceState {
	backend: GovernanceBackend | null;
	baseUrl: string;
	tenantId: string;
	username: string;
	/** 当前登录用户角色(evorule-rule 四角色,用于 UI 提示动作可用性) */
	role: string | null;
	connected: boolean;
	connecting: boolean;
	error: string | null;
	datasets: GovernanceDataset[];
	loadingDatasets: boolean;
	selectedId: string | null;
	/** 条目列表（规则条目或数据资产条目，Q12 段2 P5 按数据集类型分流） */
	entries: GovernanceItem[];
	loadingEntries: boolean;
	versioning: VersioningInfo | null;
}

const initial: GovernanceState = {
	backend: null,
	baseUrl: '',
	tenantId: '',
	username: '',
	role: null,
	connected: false,
	connecting: false,
	error: null,
	datasets: [],
	loadingDatasets: false,
	selectedId: null,
	entries: [],
	loadingEntries: false,
	versioning: null
};

export const governanceStore = writable<GovernanceState>(initial);

/** 内部:取当前 backend,未连接则抛错(不静默) */
function backend(): GovernanceBackend {
	const s = get(governanceStore);
	if (!s.backend || !s.connected) {
		throw new GovernanceError('治理服务未连接', 'not_connected');
	}
	return s.backend;
}

function setError(err: unknown): void {
	const message = err instanceof GovernanceError ? err.message : err instanceof Error ? err.message : String(err);
	governanceStore.update((s) => ({ ...s, error: message }));
}

// ====================================================================
// 连接
// ====================================================================

/** 连接 evorule-rule:登录并拉取角色、数据集列表 */
export async function connect(
	baseUrl: string,
	tenantId: string,
	username: string,
	password: string
): Promise<void> {
	governanceStore.update((s) => ({
		...s,
		baseUrl,
		tenantId,
		username,
		connecting: true,
		error: null,
		connected: false
	}));
	try {
		const bk = new GovernanceBackend(baseUrl, tenantId);
		await bk.login(username, password);
		const me = await bk.me();
		governanceStore.update((s) => ({
			...s,
			backend: bk,
			role: me.role,
			connected: true,
			connecting: false
		}));
		await refreshDatasets();
	} catch (err) {
		governanceStore.update((s) => ({
			...s,
			backend: null,
			connected: false,
			connecting: false,
			error: err instanceof Error ? err.message : String(err)
		}));
		throw err;
	}
}

/** 断开(仅清内存 token,保留配置) */
export function disconnect(): void {
	governanceStore.set({ ...initial });
}

// ====================================================================
// 数据集
// ====================================================================

export async function refreshDatasets(): Promise<void> {
	const bk = backend();
	governanceStore.update((s) => ({ ...s, loadingDatasets: true, error: null }));
	try {
		const datasets = await bk.listDatasets();
		governanceStore.update((s) => ({
			...s,
			datasets,
			loadingDatasets: false,
			// 选中数据集可能被删,重新校验
			selectedId: datasets.some((d) => d.dataset_id === s.selectedId) ? s.selectedId : null
		}));
	} catch (err) {
		governanceStore.update((s) => ({ ...s, loadingDatasets: false }));
		setError(err);
		throw err;
	}
}

export async function createDataset(req: CreateDatasetRequest): Promise<GovernanceDataset> {
	const bk = backend();
	const ds = await bk.createDataset(req);
	await refreshDatasets();
	await selectDataset(ds.dataset_id);
	return ds;
}

export function selectDataset(id: string | null): void {
	governanceStore.update((s) => ({ ...s, selectedId: id, entries: [], versioning: null }));
	if (id) {
		void loadEntries(id);
		void loadVersioning(id);
	}
}

// ====================================================================
// 条目(规则)
// ====================================================================

async function loadEntries(datasetId: string): Promise<void> {
	const bk = backend();
	governanceStore.update((s) => ({ ...s, loadingEntries: true }));
	try {
		// Q12 段2 P5：按选中数据集类型分流取数（后端按 dataset_kind 分流返回对应条目）
		const s0 = get(governanceStore);
		const kind = s0.datasets.find((d) => d.dataset_id === datasetId)?.dataset_kind ?? 'rule_set';
		const entries: GovernanceItem[] =
			kind === 'knowledge' ? await bk.listKnowledgeEntries(datasetId) : await bk.listEntries(datasetId);
		governanceStore.update((s) => ({ ...s, entries, loadingEntries: false }));
	} catch (err) {
		governanceStore.update((s) => ({ ...s, loadingEntries: false }));
		setError(err);
		throw err;
	}
}

export async function addEntry(datasetId: string, req: AddEntryRequest): Promise<GovernanceEntry> {
	const bk = backend();
	const entry = await bk.addEntry(datasetId, req);
	await loadEntries(datasetId);
	return entry;
}

// ====================================================================
// 条目(knowledge 数据条目 — UV-086 在线编辑)
// ====================================================================

/** 添加 knowledge 数据条目（payload+schema_ref 必填），成功后刷新条目列表 */
export async function addKnowledgeEntry(
	datasetId: string,
	req: AddKnowledgeEntryRequest
): Promise<KnowledgeEntry> {
	const bk = backend();
	const entry = await bk.addKnowledgeEntry(datasetId, req);
	await loadEntries(datasetId);
	return entry;
}

/**
 * 编辑 knowledge 条目草稿（PATCH：仅 Draft 可原地改 payload/schema_ref/tags/provenance），
 * 成功后刷新条目列表。非 frozen 拒绝由 server 裁定，错误原文向上抛（不静默）。
 */
export async function patchKnowledgeEntry(
	datasetId: string,
	entryId: string,
	req: PatchKnowledgeEntryRequest
): Promise<KnowledgeEntry> {
	const bk = backend();
	const entry = await bk.patchKnowledgeEntry(entryId, req);
	await loadEntries(datasetId);
	return entry;
}

/**
 * 删除条目草稿（DELETE：仅显式 Draft 可删，规则/知识条目同构），
 * 成功后刷新条目列表。删除不可恢复（连带版本历史），UI 侧须二次确认。
 */
export async function deleteEntry(datasetId: string, entryId: string): Promise<void> {
	const bk = backend();
	await bk.deleteEntry(entryId);
	await loadEntries(datasetId);
}

/** 判断条目是否为数据资产条目（Q12 段2 P5：payload/schema_ref 形态） */
export function isKnowledgeEntry(e: GovernanceItem): e is KnowledgeEntry {
	return typeof (e as KnowledgeEntry).payload !== 'undefined';
}

// ====================================================================
// 生命周期 + 版本
// ====================================================================

/** candidate | active | rejected(Published 走独立发布端点) */
export async function transition(to: 'candidate' | 'active' | 'rejected'): Promise<void> {
	const s = get(governanceStore);
	if (!s.selectedId) throw new GovernanceError('未选中数据集', 'no_selection');
	const updated = await backend().transitionLifecycle(s.selectedId, to);
	await afterDatasetChanged(updated);
}

/** 独立发布审批(Active → Published,需审批者 + confirm=true) */
export async function publish(reason?: string): Promise<void> {
	const s = get(governanceStore);
	if (!s.selectedId) throw new GovernanceError('未选中数据集', 'no_selection');
	const updated = await backend().publishDataset(s.selectedId, reason);
	await afterDatasetChanged(updated);
}

/** 撤销发布(Published → Rejected,管理端) */
export async function unpublish(): Promise<void> {
	const s = get(governanceStore);
	if (!s.selectedId) throw new GovernanceError('未选中数据集', 'no_selection');
	const updated = await backend().unpublishDataset(s.selectedId);
	await afterDatasetChanged(updated);
}

/** 更新法规锚（PATCH /datasets/{id} 元数据通道；UV-051 部署闸门的 UI 修复路径） */
export async function updateLawRef(lawRef: LawRef): Promise<void> {
    const s = get(governanceStore);
    if (!s.selectedId) throw new GovernanceError('未选中数据集', 'no_selection');
    const updated = await backend().updateDatasetMeta(s.selectedId, { law_ref: lawRef });
    await afterDatasetChanged(updated);
}

/** 版本迁移:major(法规条款级) / patch(内部小改) */
export async function createVersion(kind: 'major' | 'patch'): Promise<void> {
	const s = get(governanceStore);
	if (!s.selectedId) throw new GovernanceError('未选中数据集', 'no_selection');
	await backend().createVersion(s.selectedId, kind);
	await refreshDatasets();
	if (s.selectedId) await loadVersioning(s.selectedId);
}

async function loadVersioning(datasetId: string): Promise<void> {
	const bk = backend();
	try {
		const versioning = await bk.listVersions(datasetId);
		governanceStore.update((s) => ({ ...s, versioning }));
	} catch (err) {
		setError(err);
	}
}

/** 数据集变化后刷新列表 + 选中集详情(条目/版本) */
async function afterDatasetChanged(updated: GovernanceDataset): Promise<void> {
	governanceStore.update((s) => ({
		...s,
		datasets: s.datasets.map((d) => (d.dataset_id === updated.dataset_id ? updated : d))
	}));
	const s = get(governanceStore);
	if (s.selectedId === updated.dataset_id) {
		await loadEntries(updated.dataset_id);
		await loadVersioning(updated.dataset_id);
	}
}
