// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — GovernanceBackend:调 evorule-rule REST 的治理客户端（Phase 2 F1）
//
// 设计:
//   - 独立于执行后端（CloudHttpBackend）：治理数据来自 evorule-rule（资产库），
//     执行数据来自 evorule-server（运行时），二者解耦、可分别可达。
//   - 认证:走 evorule-rule 的 JWT（/v1/auth/login），token 存于实例内存（不落 localStorage，
//     密码由用户每次连接输入或由页面持有 —— 见 governance-config.ts 的说明）。
//   - 错误处理:evorule-rule 非 2xx 返回 `{ "error": { "code", "message" } }`，
//     本客户端抛出带 message 的 Error，不静默吞错（对齐"不静默降级"纪律）。
//   - 分页:list 端点返回 { items, next_cursor }，MVP 取全量（limit=100）。

import type {
	AddEntryRequest,
	AddKnowledgeEntryRequest,
	CreateDatasetRequest,
	EntryDiffResponse,
	EntryVersionPayloadResponse,
	EntryVersionsResponse,
	GovernanceDataset,
	GovernanceEntry,
	KnowledgeEntry,
	LifecycleStatus,
	Page,
	PatchKnowledgeEntryRequest,
	UpdateDatasetMetaRequest,
	VersioningInfo
} from './types';

/** 统一错误：message 取自后端 error.message，网络错误标注来源 */
export class GovernanceError extends Error {
	readonly code: string | null;
	constructor(message: string, code: string | null = null) {
		super(message);
		this.name = 'GovernanceError';
		this.code = code;
	}
}

/** 连接配置（由页面/配置 store 提供） */
export interface GovernanceConnectionConfig {
	baseUrl: string;
	tenantId: string;
	username: string;
	password: string;
}

/**
 * 导出证据三形态（UV-058 W1.3/W1.4，42 号方案 §1.3）。
 *
 * - sandbox-report：机器背书（首选路径）——verdict 从沙盒报告派生
 *   （调用方以 reportVerdict() 从报告 summary 派生，不手填不伪造），
 *   subset 引用沙盒 ID 使机器证据在 bundle 内可追溯；
 * - human-confirmed：人工降级（显式路径）——操作者选择未经沙盒验证的人工
 *   背书，subset 带 human:<actor> 标记，降级在 bundle 内可追溯（W1.4 阶段一）；
 * - none：无证据 —— verdict=fail，执行侧闸门一硬拒导入（evorule-bundle
 *   L359-363 enforcement，非 console 侧拦截）。
 */
export type ExportEvidence =
	| { kind: 'sandbox-report'; sandboxId: number; verdict: 'pass' | 'fail' }
	| { kind: 'human-confirmed'; actor: string }
	| { kind: 'none' };

interface RequestOptions {
	method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	path: string;
	body?: unknown;
	/** 不需要认证头（仅 /v1/auth/login） */
	noAuth?: boolean;
}

export class GovernanceBackend {
	private baseUrl: string;
	private tenantId: string;
	private token: string | null = null;

	constructor(baseUrl: string, tenantId = 'default') {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.tenantId = tenantId;
	}

	/** 是否已登录 evorule-rule */
	get connected(): boolean {
		return this.token !== null;
	}

	get currentBaseUrl(): string {
		return this.baseUrl;
	}

	get currentTenant(): string {
		return this.tenantId;
	}

	/** 登录（JWT）。成功后在实例内持有 access_token。 */
	async login(username: string, password: string): Promise<void> {
		const res = await this.request<{ access_token: string }>({
			method: 'POST',
			path: '/v1/auth/login',
			body: { tenant_id: this.tenantId, username, password },
			noAuth: true
		});
		if (!res.access_token) {
			throw new GovernanceError('登录响应缺少 access_token', 'login_no_token');
		}
		this.token = res.access_token;
	}

	/** 断开连接（仅清空内存 token） */
	logout(): void {
		this.token = null;
	}

	/** 健康检查：治理服务是否可达（不登录，探测登录端点返回结构即可判活） */
	async health(): Promise<boolean> {
		try {
			const r = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ refresh_token: 'probe' })
			});
			// 服务在响应即视为可达：缺字段/坏 token 会得到 4xx（401/400/422），网络失败才会抛错
			return r.status >= 400 && r.status < 500;
		} catch {
			return false;
		}
	}

	/** 当前登录用户信息（含角色，用于 UI 提示哪些生命周期动作可用） */
	async me(): Promise<{ user_id: string; username: string; tenant_id: string; role: string }> {
		return this.request<{ user_id: string; username: string; tenant_id: string; role: string }>({
			method: 'GET',
			path: '/v1/auth/me'
		});
	}

	// ====================================================================
	// 数据集（RuleDataset）
	// ====================================================================

	/** 列出数据集（取全量，MVP limit=100） */
	async listDatasets(): Promise<GovernanceDataset[]> {
		const page = await this.request<Page<GovernanceDataset>>({
			method: 'GET',
			path: '/v1/datasets?limit=100'
		});
		return page.items ?? [];
	}

	/** 创建数据集 */
	async createDataset(req: CreateDatasetRequest): Promise<GovernanceDataset> {
		return this.request<GovernanceDataset>({
			method: 'POST',
			path: '/v1/datasets',
			body: req
		});
	}

	/** 获取数据集详情 */
	async getDataset(id: string): Promise<GovernanceDataset> {
		return this.request<GovernanceDataset>({
			method: 'GET',
			path: `/v1/datasets/${encodeURIComponent(id)}`
		});
	}

	/** 生命周期迁移（candidate | active | rejected；published 走独立发布端点） */
	async transitionLifecycle(id: string, to: 'candidate' | 'active' | 'rejected'): Promise<GovernanceDataset> {
		return this.request<GovernanceDataset>({
			method: 'PATCH',
			path: `/v1/datasets/${encodeURIComponent(id)}/lifecycle`,
			body: { to }
		});
	}

	/** 独立发布审批（Active → Published，需二次确认 confirm=true） */
	async publishDataset(id: string, reason?: string): Promise<GovernanceDataset> {
		return this.request<GovernanceDataset>({
			method: 'POST',
			path: `/v1/datasets/${encodeURIComponent(id)}/publish`,
			body: { confirm: true, reason }
		});
	}

	/** 撤销发布（Published → Rejected，管理端） */
	async unpublishDataset(id: string): Promise<GovernanceDataset> {
		return this.request<GovernanceDataset>({
			method: 'POST',
			path: `/v1/datasets/${encodeURIComponent(id)}/unpublish`
		});
	}

	/** 更新数据集元数据（PATCH /v1/datasets/{id}；字段缺省 = 不修改，UV-051 法规锚编辑通道） */
	async updateDatasetMeta(id: string, req: UpdateDatasetMetaRequest): Promise<GovernanceDataset> {
		return this.request<GovernanceDataset>({
			method: 'PATCH',
			path: `/v1/datasets/${encodeURIComponent(id)}`,
			body: req
		});
	}

	/** 删除数据集（仅 Draft/Rejected，admin） */
	async deleteDataset(id: string): Promise<void> {
		await this.request<null>({
			method: 'DELETE',
			path: `/v1/datasets/${encodeURIComponent(id)}`
		});
	}

	// ====================================================================
	// 条目（RuleEntry）
	// ====================================================================

	/** 列出数据集内条目 */
	async listEntries(datasetId: string): Promise<GovernanceEntry[]> {
		const page = await this.request<Page<GovernanceEntry>>({
			method: 'GET',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/entries?limit=100`
		});
		return page.items ?? [];
	}

	/**
	 * 列出 knowledge 数据集内的数据资产条目（Q12 段2 P5）
	 *
	 * 后端 `GET /datasets/{id}/entries` 按数据集类型分流（rule_set → 规则条目；
	 * knowledge → 数据条目），本方法为 knowledge 数据集的类型化取数入口。
	 */
	async listKnowledgeEntries(datasetId: string): Promise<KnowledgeEntry[]> {
		const page = await this.request<Page<KnowledgeEntry>>({
			method: 'GET',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/entries?limit=100`
		});
		return page.items ?? [];
	}

	/** 添加条目（rule_body 为 evorule 原生 JSON，零转译） */
	async addEntry(datasetId: string, req: AddEntryRequest): Promise<GovernanceEntry> {
		return this.request<GovernanceEntry>({
			method: 'POST',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/entries`,
			body: req
		});
	}

	/**
	 * 添加 knowledge 数据条目（UV-086；POST /v1/datasets/{id}/entries，knowledge 数据集分流）
	 *
	 * 同一端点按数据集类型分流（server 侧 Q12 R4）：knowledge 数据集收
	 * {entry_id, version, payload, schema_ref, ...}，payload+schema_ref 必填、与 rule_body 互斥。
	 * schema_ref 须为 domain_schemas 已注册引用，resolver 未命中 = 400 拒绝（D3）。
	 */
	async addKnowledgeEntry(
		datasetId: string,
		req: AddKnowledgeEntryRequest
	): Promise<KnowledgeEntry> {
		return this.request<KnowledgeEntry>({
			method: 'POST',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/entries`,
			body: req
		});
	}

	/**
	 * 编辑 knowledge 条目草稿（UV-086；PATCH /v1/entries/{id}）
	 *
	 * 仅非 frozen 条目可改（Draft；Active/Published 原地修改被 server 拒绝——
	 * 修改已生效内容须创建新版本）。字段缺省 = 不修改。
	 * 返回更新后的条目（server 回读最新状态）。
	 */
	async patchKnowledgeEntry(
		entryId: string,
		req: PatchKnowledgeEntryRequest
	): Promise<KnowledgeEntry> {
		return this.request<KnowledgeEntry>({
			method: 'PATCH',
			path: `/v1/entries/${encodeURIComponent(entryId)}`,
			body: req
		});
	}

	/**
	 * 删除条目草稿（UV-086；DELETE /v1/entries/{id}，204）
	 *
	 * 仅显式 Draft 可删（status 缺省视同 Active，server 拒删）；
	 * 规则/知识条目后端同构分流。删除不可恢复（连带版本历史）。
	 */
	async deleteEntry(entryId: string): Promise<void> {
		await this.request<null>({
			method: 'DELETE',
			path: `/v1/entries/${encodeURIComponent(entryId)}`
		});
	}

	/**
	 * 条目版本链（44 号 §5 C1；GET /v1/entries/{id}/versions）
	 *
	 * 规则与 knowledge 条目后端同构分流（Q12 R4），摘要均为 version/status/content_hash。
	 */
	async entryVersions(entryId: string): Promise<EntryVersionsResponse> {
		return this.request<EntryVersionsResponse>({
			method: 'GET',
			path: `/v1/entries/${encodeURIComponent(entryId)}/versions`
		});
	}

	/**
	 * 条目内容级 diff（44 号 §9 C2；GET /v1/entries/{id}/diff?from=&to=）
	 *
	 * 键级归因（keys added/removed/changed）+ content_hash 口径；
	 * 双版本完整载荷经 entryVersionPayload(entryId, version) 回查。from 须小于 to 且版本存在。
	 */
	async entryDiff(entryId: string, from: number, to: number): Promise<EntryDiffResponse> {
		return this.request<EntryDiffResponse>({
			method: 'GET',
			path: `/v1/entries/${encodeURIComponent(entryId)}/diff?from=${from}&to=${to}`
		});
	}

	/**
	 * 条目指定版本完整载荷（条目 diff 工具 D-B③；GET /v1/entries/{id}/versions/{version}）
	 *
	 * 版本链端点仅给摘要（version/status/content_hash）；本端点回查逐版本载荷
	 * （entries/knowledge_entries 全版本留痕，33 号 §6），规则条目含 rule_body，数据条目含 payload。
	 */
	async entryVersionPayload(entryId: string, version: number): Promise<EntryVersionPayloadResponse> {
		return this.request<EntryVersionPayloadResponse>({
			method: 'GET',
			path: `/v1/entries/${encodeURIComponent(entryId)}/versions/${version}`
		});
	}

	// ====================================================================
	// 版本链
	// ====================================================================

	/** 版本链（current + chain） */
	async listVersions(datasetId: string): Promise<VersioningInfo> {
		return this.request<VersioningInfo>({
			method: 'GET',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/versions`
		});
	}

	// ====================================================================
	// 快照包导出（治理→执行域部署通道；36 号集成契约）
	// ====================================================================

	/**
	 * 由 ExportEvidence 构造导出请求的 tests 段（BundleTests 形状：
	 * subset: Vec<String> + verdict: pass|fail，evorule-bundle 0.3.0 SSOT）。
	 */
	static buildTestsForEvidence(ev: ExportEvidence): {
		subset?: string[];
		verdict: 'pass' | 'fail';
	} {
		switch (ev.kind) {
			case 'sandbox-report':
				// 机器背书:verdict 从报告派生传入;引用沙盒 ID 可追溯
				return {
					subset: [`sandbox:${ev.sandboxId}`],
					verdict: ev.verdict
				};
			case 'human-confirmed':
				// 人工降级:显式选择才可到达,actor 进 subset 使降级可追溯
				return { subset: [`human:${ev.actor}`], verdict: 'pass' };
			case 'none':
				// 无证据:verdict=fail,导入侧硬拒(fail-fast,不静默)
				return { verdict: 'fail' };
		}
	}

	/**
	 * 带证据导出快照包（POST /v1/bundles/export）。
	 *
	 * 部署到执行域必须走本端点（带证据）：GET 导出固定 unverified()
	 * （verdict=fail），执行侧闸门一会拒绝导入（T0 决策：未验证不得默认 Pass）。
	 *
	 * 证据语义（UV-058 W1.3 升级，取代 32 号方案 B 的单一人工背书）：
	 * evidence 为结构化三形态（ExportEvidence）——sandbox-report 机器背书为
	 * 默认路径，human-confirmed 为显式降级路径，none 导出不可导入的预览包。
	 * 本客户端如实按 evidence 构造 tests 段（buildTestsForEvidence），
	 * 不伪造沙箱验证产出；机器证据的 verdict 必须由调用方从真实报告派生。
	 *
	 * @param datasetId 数据集 ID
	 * @param version 要导出的版本（如 "V1"）
	 * @param evidence 结构化导出证据（三形态见 ExportEvidence）
	 */
	async exportBundle(
		datasetId: string,
		version: string,
		evidence: ExportEvidence
	): Promise<unknown> {
		return this.request<unknown>({
			method: 'POST',
			path: '/v1/bundles/export',
			body: {
				dataset_id: datasetId,
				version,
				tests: GovernanceBackend.buildTestsForEvidence(evidence)
			}
		});
	}

	/** 创建新版本（major=法规条款级升版 / patch=内部小改） */
	async createVersion(datasetId: string, kind: 'major' | 'patch'): Promise<{ new_version: string; current: string; chain: string[] }> {
		return this.request<{ new_version: string; current: string; chain: string[] }>({
			method: 'POST',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/versions`,
			body: { kind }
		});
	}

	// ====================================================================
	// 内部：统一请求
	// ====================================================================

	private async request<T>(opts: RequestOptions): Promise<T> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (!opts.noAuth) {
			if (!this.token) {
				throw new GovernanceError('未登录 evorule-rule，请先连接', 'not_authenticated');
			}
			headers['Authorization'] = `Bearer ${this.token}`;
		}

		let r: Response;
		try {
			r = await fetch(`${this.baseUrl}${opts.path}`, {
				method: opts.method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
			});
		} catch (e) {
			throw new GovernanceError(`无法连接治理服务 ${this.baseUrl}（网络错误）`, 'network_error');
		}

		if (!r.ok) {
			let message = `HTTP ${r.status}`;
			let code: string | null = null;
			try {
				const body = (await r.json()) as { error?: { code?: string; message?: string } };
				if (body?.error?.message) message = body.error.message;
				code = body?.error?.code ?? null;
			} catch {
				// 响应体非 JSON：保留 HTTP 状态信息
			}
			throw new GovernanceError(message, code);
		}

		if (r.status === 204) {
			return undefined as T;
		}
		try {
			return (await r.json()) as T;
		} catch {
			throw new GovernanceError('治理服务返回了非 JSON 响应', 'bad_response');
		}
	}
}
