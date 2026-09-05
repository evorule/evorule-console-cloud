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

/**
 * 数据集类型（Q12 数据资产化 R1 / 段2 P5）
 * - `rule_set`：规则集，条目为 transform 指令集 → 进 TCB 确定性执行；
 * - `knowledge`：数据资产集，条目为领域结构化 payload + schema_ref → 不进 TCB。
 * 后端 serde default = rule_set（旧数据集缺省该字段）。
 */
export type DatasetKind = 'rule_set' | 'knowledge';

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

/** 法规锚（合规数据集核心锚；UV-051：auto_by_effective_date 模式须含 effective_from） */
export interface LawRef {
    document_id: string;
    law_version?: string | null;
    effective_from?: string | null;
    effective_to?: string | null;
}

/** 更新数据集元数据请求体（PATCH /v1/datasets/{id}；字段缺省 = 不修改） */
export interface UpdateDatasetMetaRequest {
    name?: string;
    description?: string;
    domain?: string[];
    tags?: string[];
    visibility?: 'private' | 'public';
    law_ref?: LawRef;
}

/** 数据集（RuleDataset）—— 治理单元 / 版本单元 */
export interface GovernanceDataset {
	/** 租户内唯一 */
	dataset_id: string;
	name: string;
	description?: string | null;
	/** 数据集类型（Q12 R1；后端缺省 = rule_set） */
	dataset_kind?: DatasetKind;
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
	law_ref?: LawRef | null;
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

/**
 * 添加 knowledge 数据条目请求体（POST /v1/datasets/{id}/entries，knowledge 数据集分流）
 *
 * UV-086：payload + schema_ref 必填，与 rule_body 互斥（server 显式 400）。
 * schema_ref 须为 domain_schemas 已注册引用（$id 或文件名），resolver 未命中 = 拒绝入库（D3 强校验）。
 */
export interface AddKnowledgeEntryRequest {
	entry_id: string;
	/** 治理版本：必填，递增 */
	version: number;
	domain?: string;
	tags?: string[];
	/** 领域结构化数据本体（任意 JSON，过 schema_ref 领域 schema 强校验） */
	payload: unknown;
	/** 领域 JSON Schema 引用（D3 强校验锚） */
	schema_ref: string;
	provenance?: GovernanceProvenanceInput;
}

/**
 * 编辑条目草稿请求体（PATCH /v1/entries/{id}，knowledge 分流字段）
 *
 * UV-086：仅 payload/schema_ref/tags/provenance 可改（PATCH 契约无 domain/version）；
 * 仅非 frozen 条目可改（Draft；Active/Published 拒绝原地修改，修改=创建新版本）。
 * 字段缺省 = 不修改；全部缺省 = 无操作（server 逐字段 if-let）。
 */
export interface PatchKnowledgeEntryRequest {
	payload?: unknown;
	schema_ref?: string;
	tags?: string[];
	provenance?: GovernanceProvenanceInput;
}

/** 治理溯源输入（条目创建/编辑时的 provenance 形状，对齐 server Provenance serde） */
export interface GovernanceProvenanceInput {
	source: string;
	clause?: string | null;
	document_id?: string | null;
	effective_from?: string | null;
	effective_to?: string | null;
	last_verified?: string | null;
	verified_by?: string | null;
}

/**
 * 数据资产条目（KnowledgeEntry，Q12 数据资产化 R2 / 段2 P5）
 *
 * knowledge 数据集专属载荷：`payload` 为领域结构化 JSON（零转译），
 * `schema_ref` 为领域 JSON Schema 引用（D3 强校验锚）。不进 TCB。
 * 治理元数据（entry_id/version/status/provenance/domain/tags）与规则条目同构。
 */
export interface KnowledgeEntry {
	entry_id: string;
	dataset_id: string;
	/** 条目治理版本：整型单调递增（同规则条目） */
	version: number;
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
	/** 领域结构化数据本体（任意 JSON，零转译） */
	payload: unknown;
	/** 领域 JSON Schema 引用 URI（D3） */
	schema_ref: string;
	governance?: unknown;
	[key: string]: unknown;
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

// ====================================================================
// 条目版本链与内容级 diff（44 号 §5/§9；规则与 knowledge 条目后端同构分流）
// ====================================================================

/** 条目版本摘要（GET /v1/entries/{id}/versions 的 versions[] 元素） */
export interface EntryVersionSummary {
	version: number;
	status: LifecycleStatus | null;
	/** BLAKE3 内容哈希（content_hash 刻定内容，跨版本共享快照行去重） */
	content_hash: string;
}

/** 条目版本链响应（GET /v1/entries/{id}/versions） */
export interface EntryVersionsResponse {
	dataset_id: string;
	entry_id: string;
	versions: EntryVersionSummary[];
}

/**
 * 条目内容级 diff 响应（GET /v1/entries/{id}/diff?from=&to=）
 *
 * 后端为键级归因（顶层路径 added/removed/changed 列表），非逐字符文本 diff；
 * 内容以 content_hash 刻定，双版本完整载荷经 GET /v1/entries/{id}/versions/{version} 回查。
 */
export interface EntryDiffResponse {
	dataset_id: string;
	entry_id: string;
	from: number;
	to: number;
	from_content_hash: string;
	to_content_hash: string;
	changed: boolean;
	note?: string;
	keys?: {
		added: string[];
		removed: string[];
		changed: string[];
	};
}

/** 条目指定版本完整载荷响应（GET /v1/entries/{id}/versions/{version}；历史版本载荷回查） */
export interface EntryVersionPayloadResponse {
	dataset_id: string;
	entry_id: string;
	version: number;
	/** 规则条目含 rule_body，数据条目含 payload（全版本留痕，33 号 §6） */
	entry: Record<string, unknown>;
}
