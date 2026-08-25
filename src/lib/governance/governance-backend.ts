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
	CreateDatasetRequest,
	GovernanceDataset,
	GovernanceEntry,
	LifecycleStatus,
	Page,
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

	/** 添加条目（rule_body 为 evorule 原生 JSON，零转译） */
	async addEntry(datasetId: string, req: AddEntryRequest): Promise<GovernanceEntry> {
		return this.request<GovernanceEntry>({
			method: 'POST',
			path: `/v1/datasets/${encodeURIComponent(datasetId)}/entries`,
			body: req
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
