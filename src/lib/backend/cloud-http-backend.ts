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
//   - 读方法(getProductionState/getPublishQueue/getProductionAudit)委托内核
//     WorkspaceBackend(带 Bearer token),本类只做视图模型映射
//   - 写方法(reviewPublishRequest/emergencyRollbackRequest)保留自建 fetch +
//     token:内核 WorkspaceBackend.reviewPublish/emergencyRollback 硬编码
//     DEFAULT_REQUESTER/role,会丢失 UI 传入的操作者身份与角色(上游内核局限,
//     登记为上游债务),待内核开放身份参数后收敛
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
		this.backend = new HttpBackend(this.resolveBaseUrl());
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
		this.backend = new HttpBackend(this.resolveBaseUrl());
	}

	// === 内部工具 ===

	private resolveBaseUrl(): string {
		const url =
			this._config.mode === 'online' ? this._config.remoteBaseUrl : this._config.localBaseUrl;
		// 去掉末尾斜杠(与内核 HttpBackend 构造行为一致,避免 path 拼接出现 //)
		return url.replace(/\/+$/, '');
	}

	/** Bearer 认证头(未配置 token 时空对象,仅 dev/免认证 server 可用) */
	private authHeaders(): Record<string, string> {
		return this._config.authToken
			? { Authorization: `Bearer ${this._config.authToken}` }
			: {};
	}

	// === 代理所有 15 方法到内部 HttpBackend ===

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
	 * cloud 版 L1 监控大屏(P05) + HomeRouter 状态 C 默认层选择(T1 resolveDefaultLayer)
	 * 需要此数据。
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
	 * 审批发布(消费 `POST /api/publish/queue/{queue_id}/review`)。
	 *
	 * 自建 fetch(带 Bearer token):内核 reviewPublish 硬编码操作者身份,
	 * 会丢失 UI 传入的审批者与角色,故暂不委托(见文件头"数据通道"说明)。
	 *
	 * @param decision 'approved' | 'rejected'
	 * @param comment 审批备注
	 * @param reviewedBy 审批者 userId
	 * @param role 前端角色(映射为后端 PublishRole)
	 */
	async reviewPublishRequest(
		queueId: number,
		decision: 'approved' | 'rejected',
		comment: string,
		reviewedBy: string,
		role: string,
	): Promise<PublishWriteResult> {
		const url = `${this.baseUrl}/api/publish/queue/${queueId}/review`;
		try {
			const r = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
				body: JSON.stringify({
					decision,
					comment,
					reviewed_by: reviewedBy,
					role,
				}),
			});
			if (!r.ok) {
				const text = await r.text().catch(() => '');
				return { ok: false, error: `审批失败(${r.status}): ${text.slice(0, 200)}` };
			}
			return { ok: true };
		} catch {
			return { ok: false, error: '审批失败:网络错误' };
		}
	}

	/**
	 * 紧急回滚(消费 `POST /api/publish/rollback`)。
	 * 版本号单调递增:回滚到 targetVersion 的规则集,新版本号 = 当前 + 1。
	 * 自建 fetch 理由同 reviewPublishRequest。
	 */
	async emergencyRollbackRequest(
		targetVersion: number,
		reason: string,
		operatedBy: string,
		role: string,
	): Promise<PublishWriteResult> {
		const url = `${this.baseUrl}/api/publish/rollback`;
		try {
			const r = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
				body: JSON.stringify({
					target_version: targetVersion,
					reason,
					operated_by: operatedBy,
					role,
				}),
			});
			if (!r.ok) {
				const text = await r.text().catch(() => '');
				return { ok: false, error: `回滚失败(${r.status}): ${text.slice(0, 200)}` };
			}
			return { ok: true };
		} catch {
			return { ok: false, error: '回滚失败:网络错误' };
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
}
