// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理数据契约（对齐 evorule-rule REST JSON，Phase 2 F1）
//
// 数据源:evorule-rule REST API。
// 对齐声明:字段名/枚举值逐一与 evorule-rule Rust serde 序列化一致
// （lifecycle.status 为 PascalCase；visibility 为 snake_case；分页封装 {items, next_cursor}）。
// 若 evorule-rule 改契约，此处与后端会漂移 —— 该文件是契约锚点（SSOT），需同步。

/** 生命周期 5 态（决策点④）：Draft → Candidate → Active → Published → Rejected */
export type LifecycleStatus = 'Draft' | 'Candidate' | 'Active' | 'Published' | 'Rejected';

/** 生命周期状态变更审计（只增不改，state_history） */
export interface LifecycleStateChange {
	from: string;
	to: string;
	/** ISO-8601 UTC */
	at: string;
	by: string;
	cause: string;
	/** 发布版本标识 `{dataset_id}@{version}`（仅 Published 记录） */
	published_as?: string;
}

/** 数据集（RuleDataset）—— 治理单元 / 版本单元 */
export interface GovernanceDataset {
	/** 租户内唯一 */
	dataset_id: string;
	name: string;
	description?: string | null;
	domain: string[];
	tags: string[];
	tenant_id: string;
	visibility: 'private' | 'public';
	/** 生命周期（决策点④） */
	lifecycle: {
		status: LifecycleStatus;
		state_history: LifecycleStateChange[];
	};
	/** 版本链（决策点③） */
	versioning: {
		current: string;
		chain: string[];
	};
	/** 法规锚（可选） */
	law_ref?: unknown;
	/** 版本选择双模式（可选） */
	version_selection?: unknown;
	/** 数据依赖声明（可选） */
	data_dependencies?: unknown;
	meta: {
		created_at: string;
		created_by: string;
		updated_at?: string | null;
		updated_by?: string | null;
	};
	/** 预留：后端可能扩展字段 */
	[key: string]: unknown;
}

/** 规则条目（RuleEntry）—— 数据集内的规则（evorule 原生 JSON 零转译） */
export interface GovernanceEntry {
	entry_id: string;
	dataset_id: string;
	/** 条目治理版本：整型单调递增 */
	version: number;
	/** 顶层状态：默认继承数据集，允许条目级 Draft */
	status?: LifecycleStatus;
	provenance: {
		source: string;
		clause?: string | null;
		document_id?: string | null;
		effective_from?: string | null;
		effective_to?: string | null;
		last_verified?: string | null;
		verified_by?: string | null;
	};
	domain: string;
	tags: string[];
	data_source_binding?: unknown[];
	consumed_inputs?: string[];
	/** evorule 原生 JSON（零转译） */
	rule_body: unknown;
	governance?: unknown;
	[key: string]: unknown;
}

/** 添加条目请求体（POST /v1/datasets/{id}/entries） */
export interface AddEntryRequest {
	entry_id: string;
	/** 治理版本：必填，递增 */
	version: number;
	domain?: string;
	tags?: string[];
	consumed_inputs?: string[];
	rule_body: unknown;
}

/** 创建数据集请求体（POST /v1/datasets） */
export interface CreateDatasetRequest {
	dataset_id: string;
	name: string;
	description?: string;
	domain?: string[];
	tags?: string[];
	visibility?: 'private' | 'public';
}

/** 版本链响应（GET /v1/datasets/{id}/versions） */
export interface VersioningInfo {
	current: string;
	chain: string[];
}

/** 通用分页封装（44 号 §3.3） */
export interface Page<T> {
	items: T[];
	next_cursor?: string | null;
}
