// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — CloudHttpBackend:联网/离线双模式执行后端
//
// 设计:
//   - 组合模式:持有内核 HttpBackend 实例,代理所有 15 方法
//   - 实例不变:reconfigure 只替换内部 HttpBackend,外部引用不变
//     → provideBackend 注入的引用不变,所有视图自动用新 baseUrl
//   - 切换 mode 时重建 HttpBackend(baseUrl 是 readonly,需重新构造)
//
// 为什么不继承 HttpBackend:
//   - HttpBackend.baseUrl 是 private readonly,不可变
//   - 组合优于继承:reconfigure 时替换整个内部实例,干净利落
//
// Cloud 专属方法的数据通道(旁路 store 收敛专项 2026-08-28):
//   - 全部读写方法委托内核 WorkspaceBackend(带 Bearer token + actor 身份),
//     本类只做视图模型映射或结果包装;自建 fetch 旁路已删除
//   - D2 闭合(2026-08-28):内核 reviewPublish/emergencyRollback 支持
//     ActorIdentity 注入后,写方法回归单通道,审计归属 = 真实登录用户
//   - 原三条旁路 store(publish-queue-api/production-state/production-audit)
//     的直连 fetch 已删除;localStorage 本地发布状态机(stores/publish-queue.ts)
//     已废弃,审批链路单通道走 server

import {
	HttpBackend,
	type ExecutionBackend,
	type SessionId,
	type SessionState,
	type HistoricalState,
	type SessionAudit,
	type VerifyResult,
	type Fact,
	type FactRecord,
	type DiffResult,
	type CausalChain,
	type CommandResult,
	type InterruptResult,
	type WorkspaceBackend
} from '$lib/kernel';
import { DEFAULT_LOCAL_BASE_URL, type NetMode, type CloudBackendConfig } from './types';
import {
	DEFAULT_PRODUCTION_STATE,
	mapProductionAuditRecords,
	mapProductionStateRecord,
	mapPublishQueueItem,
	type ProductionState,
	type PublishQueueItemView,
	type PublishWriteResult,
	type VersionHistoryEntry,
} from './production-views';

// UV-016:审计档案(只读)响应类型(对齐 evorule-server audit_archive.rs)
export interface ArchiveSessionMeta {
	session_id: number;
	fact_count: number;
	first_fact_type: string;
	last_fact_type: string;
	/** LLM 侧车审计会话(首条 LLM 形态 Command 为 call_external 且带 messages) */
	is_llm_sidecar: boolean;
	/** 侧车审计用途(audit_purpose 标签,非侧车为 null) */
	audit_purpose: string | null;
	/** WAL 文件总字节数(含轮换分片) */
	wal_bytes: number;
}

export interface ArchiveAuditEntry {
	fact_id: number;
	fact_type: string;
	/** 1-based 审计链条目序号 */
	logical_time: number;
	prev_hash: string;
	content_hash: string;
	cause: number | null;
	/** include_content=true 时的完整 Fact 内容(IoRequest params / IoResponse result 等) */
	content_json?: unknown;
}

export interface ArchiveAudit {
	session_id: number;
	fact_count: number;
	last_hash: string;
	verified: boolean;
	/** 旧格式无哈希记录数(不参与验证,如实上报) */
	unhashed_records: number;
	entries: ArchiveAuditEntry[];
}

export interface ArchiveSessionsResponse {
	sessions: ArchiveSessionMeta[];
	/** 仍活跃(内存中)的会话 ID,用于列表标记 */
	active_session_ids: number[];
}

// UV-018:平台认证事件(只读)响应类型(对齐 evorule-server platform_events_handler)
export interface PlatformEventEntry {
	/** 共享事实 ID(链序 = 写入时间序) */
	fact_id: number;
	/** 事实路径(完整,取证定位用) */
	path: string;
	/** 事件类型(login_success / user_created / role_updated / ...) */
	kind: string;
	/** 事件时间(Unix 毫秒,自路径内嵌时间戳解析;畸形路径为 null) */
	ts_ms: number | null;
	/** 事件详情(kind 特定:username / role / by / ...;缺失为 null) */
	detail: Record<string, unknown> | null;
}

export interface PlatformEventsResponse {
	/** 事件列表(fact_id 链序) */
	events: PlatformEventEntry[];
	/** 过滤后总数(limit 截断前) */
	total: number;
}

// UV-062 ④:bundle 导入溯源(部署历史)响应类型
// (对齐 evorule-server bundles.rs BundleImportsResponse + evorule-workspace models.rs BundleImportRecord)
export interface BundleImportRecord {
	/** 记录 ID(自增) */
	id: number;
	/** 快照包 ID */
	bundle_id: string;
	/** 数据集 ID */
	dataset_id: string;
	/** 快照源版本(v1 / v2 / v2.p1) */
	source_version: string;
	/** 版本选择模式(auto_by_effective_date | pinned) */
	selection_mode: string;
	/** pinned 已解析版本(auto 模式为 null) */
	resolved_version: string | null;
	/** 快照全包防篡改哈希(blake3: 前缀) */
	content_hash: string;
	/** 条目数 */
	entry_count: number;
	/** 导入时间(RFC3339;管理元数据,墙钟旁路,不入审计验证链) */
	imported_at: string;
	/** 溯源主体:治理侧导出者 exported_by(fallback "system") */
	imported_by: string;
}

export interface BundleImportsResponse {
	/** 溯源记录(按导入时间倒序) */
	imports: BundleImportRecord[];
	/** 本次返回条数 */
	count: number;
}

// UV-062 ⑨:执行侧已绑定服务能力(对齐 evorule-server server.rs BoundServiceInfo,C5 能力对账)
export interface BoundServiceInfo {
	/** 服务名 */
	name: string;
	/** `native`(内嵌 demo-services 叶子能力)| `registry`(service_registry.json 显式绑定) */
	source: string;
	/** 服务版本(native 固定 1.0.0;registry 取配置,可能缺省) */
	version?: string;
	/** 服务描述(registry 配置,可能缺省) */
	description?: string;
}

export class CloudHttpBackend implements ExecutionBackend {
	private backend: HttpBackend;
	/** 内核 WorkspaceBackend 引用(读方法委托;+layout 注入同一实例) */
	private workspace: WorkspaceBackend | null;
	private _config: CloudBackendConfig;

	constructor(
		config: Partial<CloudBackendConfig> = {},
		workspace: WorkspaceBackend | null = null
	) {
		this._config = {
			mode: config.mode ?? 'offline',
			remoteBaseUrl: config.remoteBaseUrl ?? DEFAULT_LOCAL_BASE_URL,
			localBaseUrl: config.localBaseUrl ?? DEFAULT_LOCAL_BASE_URL,
			authToken: config.authToken
		};
		this.workspace = workspace;
		// authToken 传给内核 HttpBackend(2026-08-28 快照同步上游 0073a0c):
		// 执行侧会话 API 请求统一携带 Authorization: Bearer
		this.backend = new HttpBackend(this.resolveBaseUrl(), this._config.authToken ?? null);
	}

	// === 配置访问器(只读) ===

	/** 当前配置(返回副本,外部修改不影响内部) */
	get config(): CloudBackendConfig {
		return { ...this._config };
	}

	/** 当前网络模式 */
	get mode(): NetMode {
		return this._config.mode;
	}

	/** 当前实际使用的 baseUrl(根据 mode 解析) */
	get baseUrl(): string {
		return this.resolveBaseUrl();
	}

	// === 切换配置(核心) ===

	/**
	 * 重新配置 backend(切换 mode 或更新 baseUrl/authToken)。
	 *
	 * 调用后,所有后续方法调用使用新配置。
	 * 之前注入的 backend 引用不变 — 视图无需重新取用。
	 *
	 * @param config 部分配置,只更新传入的字段
	 */
	reconfigure(config: Partial<CloudBackendConfig>): void {
		this._config = { ...this._config, ...config };
		this.backend = new HttpBackend(this.resolveBaseUrl(), this._config.authToken ?? null);
	}

	// === 内部工具 ===

	private resolveBaseUrl(): string {
		const url =
			this._config.mode === 'online' ? this._config.remoteBaseUrl : this._config.localBaseUrl;
		// 去掉末尾斜杠(与内核 HttpBackend 构造行为一致,避免 path 拼接出现 //)
		return url.replace(/\/+$/, '');
	}

	// === 代理所有 17 方法到内部 HttpBackend ===

	health(): Promise<boolean> {
		return this.backend.health();
	}
	createSession(): Promise<SessionId> {
		return this.backend.createSession();
	}
	listSessions(): Promise<SessionId[]> {
		return this.backend.listSessions();
	}
	closeSession(id: SessionId): Promise<void> {
		return this.backend.closeSession(id);
	}
	getSessionState(id: SessionId): Promise<SessionState> {
		return this.backend.getSessionState(id);
	}
	submitCommand(id: SessionId, instruction: object): Promise<CommandResult> {
		return this.backend.submitCommand(id, instruction);
	}
	getHistory(id: SessionId): Promise<unknown> {
		return this.backend.getHistory(id);
	}
	getReplay(id: SessionId, from?: number, to?: number | null): Promise<Fact[]> {
		return this.backend.getReplay(id, from, to);
	}
	// C4 修复(2026-08-03):对齐内核 HttpBackend,返回 FactRecord[](非 Fact[])
	getFacts(id: SessionId, prefix?: string): Promise<FactRecord[]> {
		return this.backend.getFacts(id, prefix);
	}
	getAudit(id: SessionId): Promise<SessionAudit> {
		return this.backend.getAudit(id);
	}
	verifyAudit(id: SessionId): Promise<VerifyResult> {
		return this.backend.verifyAudit(id);
	}
	getCausalChain(id: SessionId, factId: number): Promise<CausalChain> {
		return this.backend.getCausalChain(id, factId);
	}
	// D2-A 修复(2026-08-03):对齐内核 HttpBackend,返回 HistoricalState(无 reactor)
	getStateAtVersion(id: SessionId, version: number): Promise<HistoricalState> {
		return this.backend.getStateAtVersion(id, version);
	}
	getDiff(id: SessionId, a: number, b: number): Promise<DiffResult> {
		return this.backend.getDiff(id, a, b);
	}
	forkSession(parentId: SessionId, version: number): Promise<SessionId> {
		return this.backend.forkSession(parentId, version);
	}
	// UV-062:停止/中止(abort 为条件挂载端点,server 未启用 --allow-abort 时 404)
	interruptSession(id: SessionId): Promise<InterruptResult> {
		return this.backend.interruptSession(id);
	}
	abortSession(id: SessionId): Promise<InterruptResult> {
		return this.backend.abortSession(id);
	}

	// === Cloud 专属方法(不在内核 ExecutionBackend 接口内) ===
	//
	// 视图层用法:
	//   const backend = useBackend();
	//   if (backend instanceof CloudHttpBackend) {
	//     const ps = await backend.getProductionState();
	//   }
	// mock 模式(?mock=1)由 MockBackend 实现同名方法返回演示数据。

	/**
	 * 拉取生产运行状态(委托内核 WorkspaceBackend.getProductionState)。
	 *
	 * cloud 版 L1 监控大屏(P05,现 /monitor 直达页)与总览 monitor-summary
	 * widget(UV-021)需要此数据。
	 *
	 * # 错误容错(大屏不因一次拉取失败而崩)
	 * 任何失败(网络 / 401 凭据 / 404 未初始化)→ 返回 status="offline" 默认值,
	 * 不抛错;失败原因经 console.warn 可观测(不静默,凭据问题可据此定位)。
	 */
	async getProductionState(): Promise<ProductionState> {
		if (!this.workspace) return { ...DEFAULT_PRODUCTION_STATE };
		try {
			const rec = await this.workspace.getProductionState();
			return mapProductionStateRecord(rec);
		} catch (e) {
			console.warn('[CloudHttpBackend] getProductionState 失败,降级为 offline:', e);
			return { ...DEFAULT_PRODUCTION_STATE };
		}
	}

	/**
	 * 拉取发布队列(委托内核 WorkspaceBackend.listPublishQueue)。
	 *
	 * 失败(网络错误 / 401 凭据 / 非 2xx)→ 抛 Error,
	 * 由调用方 catch 后展示错误状态(不静默返回空数组,见 F3 偏差修正)。
	 */
	async getPublishQueue(): Promise<PublishQueueItemView[]> {
		if (!this.workspace) {
			throw new Error('发布队列不可用:未注入 WorkspaceBackend');
		}
		const items = await this.workspace.listPublishQueue();
		return items.map(mapPublishQueueItem);
	}

	/**
	 * 审批发布(委托内核 WorkspaceBackend.reviewPublish,
	 * 消费 `POST /api/publish/queue/{queue_id}/review`)。
	 *
	 * 操作者身份/角色来自 backend actor(+layout 按登录用户注入),
	 * 本方法不再逐调用传入(D2 闭合:内核已支持身份注入)。
	 *
	 * @param decision 'approved' | 'rejected'
	 * @param comment 审批备注
	 */
	async reviewPublishRequest(
		queueId: number,
		decision: 'approved' | 'rejected',
		comment: string,
	): Promise<PublishWriteResult> {
		if (!this.workspace) {
			return { ok: false, error: '发布审批不可用:未注入 WorkspaceBackend' };
		}
		try {
			await this.workspace.reviewPublish(queueId, { decision, comment });
			return { ok: true };
		} catch (e) {
			return { ok: false, error: `审批失败:${(e as Error).message}` };
		}
	}

	/**
	 * 紧急回滚(委托内核 WorkspaceBackend.emergencyRollback,
	 * 消费 `POST /api/publish/rollback`)。
	 * 版本号单调递增:回滚到 targetVersion 的规则集,新版本号 = 当前 + 1。
	 * 操作者身份/角色来源同 reviewPublishRequest。
	 */
	async emergencyRollbackRequest(
		targetVersion: number,
		reason: string,
	): Promise<PublishWriteResult> {
		if (!this.workspace) {
			return { ok: false, error: '紧急回滚不可用:未注入 WorkspaceBackend' };
		}
		try {
			await this.workspace.emergencyRollback({ target_version: targetVersion, reason });
			return { ok: true };
		} catch (e) {
			return { ok: false, error: `回滚失败:${(e as Error).message}` };
		}
	}

	/**
	 * 拉取发布审计 / 版本历史(委托内核 WorkspaceBackend.listProductionAudit)。
	 * 仅保留产生新版本的事件(ruleset_published / ruleset_rollback)。
	 *
	 * 失败(网络错误 / 401 凭据 / 非 2xx)→ 抛 Error,
	 * 由调用方 catch 后展示错误状态(不静默返回空数组,见 F3 偏差修正)。
	 */
	async getProductionAudit(): Promise<VersionHistoryEntry[]> {
		if (!this.workspace) {
			throw new Error('版本历史不可用:未注入 WorkspaceBackend');
		}
		const records = await this.workspace.listProductionAudit();
		return mapProductionAuditRecords(records);
	}

	/**
	 * 拉取历史会话审计档案列表(UV-016,消费 `GET /api/audit-archive/sessions`)。
	 *
	 * 只读档案:服务器重启后活跃会话清空,WAL 文件中的历史会话(含 LLM 侧车
	 * 审计会话)经此回看。失败直接抛 Error,由调用方展示错误状态。
	 */
	async listArchiveSessions(): Promise<ArchiveSessionsResponse> {
		return this.backend.getJson<ArchiveSessionsResponse>(
			'/api/audit-archive/sessions'
		);
	}

	/**
	 * 读取单会话档案审计链(UV-016,消费
	 * `GET /api/audit-archive/sessions/{id}/audit?include_content=`)。
	 *
	 * @param includeContent true 时每条附 content_json 完整 Fact 内容
	 *   (含 IoRequest params / IoResponse result,LLM 审计详情依赖此参数)
	 */
	async getArchiveAudit(
		id: SessionId,
		includeContent: boolean = false
	): Promise<ArchiveAudit> {
		const q = includeContent ? '?include_content=true' : '';
		return this.backend.getJson<ArchiveAudit>(
			`/api/audit-archive/sessions/${id}/audit${q}`
		);
	}

	/**
	 * 拉取平台认证事件(UV-018,消费 `GET /api/audit/platform-events`)。
	 *
	 * 只读报表:登录/改密/用户与角色管理事件已入共享事实 WAL(prev_hash 链),
	 * 经此回看。失败直接抛 Error,由调用方展示错误状态(不静默返回空)。
	 *
	 * @param kind 可选,按事件类型过滤(如 login_failed)
	 * @param limit 可选,最多返回条数(链序取前 N)
	 */
	async listPlatformEvents(
		kind?: string,
		limit?: number
	): Promise<PlatformEventsResponse> {
		const q = new URLSearchParams();
		if (kind) q.set('kind', kind);
		if (limit !== undefined) q.set('limit', String(limit));
		const qs = q.toString();
		return this.backend.getJson<PlatformEventsResponse>(
			`/api/audit/platform-events${qs ? `?${qs}` : ''}`
		);
	}

	/**
	 * 拉取 bundle 导入溯源历史(UV-062 ④,消费 `GET /api/bundles/imports`)。
	 *
	 * 部署溯源:每次治理侧快照包导入执行域的记录(bundle/dataset/版本/防篡改
	 * 哈希/导入者/导入时间)。按导入时间倒序;workspace 元数据库未接线时
	 * 返回 200 空列表(空 ≠ 失败)。查询失败(500)→ 抛 Error,由调用方
	 * 展示错误状态(不静默返回空,空列表与失败必须可区分)。
	 *
	 * @param limit 返回条数上限(默认 100,server 侧 clamp 1..1000)
	 */
	async listBundleImports(limit?: number): Promise<BundleImportsResponse> {
		const qs = limit !== undefined ? `?limit=${limit}` : '';
		return this.backend.getJson<BundleImportsResponse>(
			`/api/bundles/imports${qs}`
		);
	}

	/**
	 * 拉取执行侧已绑定服务清单(UV-062 ⑨,消费 `GET /api/services`)。
	 *
	 * 能力对账:原生叶子能力(native,version=1.0.0)+ service_registry.json
	 * 显式绑定(registry)。失败(网络 / 401 / 非 2xx)→ 抛 Error,由调用方
	 * 展示「服务清单不可用」态(不阻塞既有连接状态显示)。
	 */
	async listServices(): Promise<BoundServiceInfo[]> {
		return this.backend.getJson<BoundServiceInfo[]>('/api/services');
	}
}
