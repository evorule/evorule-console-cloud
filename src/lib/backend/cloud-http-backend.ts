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
	type CommandResult
} from '@evorule/console';
import { DEFAULT_LOCAL_BASE_URL, type NetMode, type CloudBackendConfig } from './types';
import { fetchProductionState, type ProductionState } from '../stores/production-state';
import {
	fetchPublishQueue,
	reviewPublishRequest,
	emergencyRollbackRequest,
	type PublishQueueItemView,
	type PublishWriteResult,
} from '../stores/publish-queue-api';
import { fetchProductionAudit, type VersionHistoryEntry } from '../stores/production-audit';

export class CloudHttpBackend implements ExecutionBackend {
	private backend: HttpBackend;
	private _config: CloudBackendConfig;

	constructor(config: Partial<CloudBackendConfig> = {}) {
		this._config = {
			mode: config.mode ?? 'offline',
			remoteBaseUrl: config.remoteBaseUrl ?? DEFAULT_LOCAL_BASE_URL,
			localBaseUrl: config.localBaseUrl ?? DEFAULT_LOCAL_BASE_URL
		};
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
	 * 重新配置 backend(切换 mode 或更新 baseUrl)。
	 *
	 * 调用后,所有后续方法调用使用新 baseUrl。
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
	// 内核 ExecutionBackend 的 15 方法对齐 evorule-server 的会话/审计/时间旅行端点,
	// 不含第四梯队新增的 production state / publish queue / sandbox 端点(内核无此概念)。
	// cloud 版在此扩展这些方法,复用已解析的 this.baseUrl(随 mode 切换自动更新)。
	//
	// 视图层用法:
	//   const backend = useBackend();
	//   if (backend instanceof CloudHttpBackend) {
	//     const ps = await backend.getProductionState();
	//   }
	// T5 的 MockBackend(adapter-static 无后端场景)应实现同名方法返回 offline 默认值。

	/**
	 * 拉取生产运行状态(消费 evorule-server `GET /api/production/state`)。
	 *
	 * cloud 版 L1 监控大屏(P05) + HomeRouter 状态 C 默认层选择(T1 resolveDefaultLayer)
	 * 需要此数据。复用 `this.baseUrl`(随 mode 切换),错误容错见 [`fetchProductionState`]。
	 *
	 * @returns ProductionState;失败时返回 status="offline" 的默认值,不抛错
	 */
	async getProductionState(): Promise<ProductionState> {
		return fetchProductionState(this.baseUrl);
	}

	/**
	 * 拉取发布队列(消费 evorule-server `GET /api/publish/queue`)。
	 *
	 * 失败(网络错误 / 非 2xx / 响应非数组)→ 抛 Error,
	 * 由调用方 catch 后展示错误状态(不静默返回空数组,见 F3 偏差修正)。
	 */
	async getPublishQueue(): Promise<PublishQueueItemView[]> {
		return fetchPublishQueue(this.baseUrl);
	}

	/**
	 * 审批发布(消费 `POST /api/publish/queue/{queue_id}/review`)。
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
		return reviewPublishRequest(this.baseUrl, queueId, decision, comment, reviewedBy, role);
	}

	/**
	 * 紧急回滚(消费 `POST /api/publish/rollback`)。
	 * 版本号单调递增:回滚到 targetVersion 的规则集,新版本号 = 当前 + 1。
	 */
	async emergencyRollbackRequest(
		targetVersion: number,
		reason: string,
		operatedBy: string,
		role: string,
	): Promise<PublishWriteResult> {
		return emergencyRollbackRequest(this.baseUrl, targetVersion, reason, operatedBy, role);
	}

	/**
	 * 拉取发布审计 / 版本历史(消费 `GET /api/production/audit`)。
	 * 仅保留产生新版本的事件(ruleset_published / ruleset_rollback)。
	 *
	 * 失败(网络错误 / 非 2xx / 响应非数组)→ 抛 Error,
	 * 由调用方 catch 后展示错误状态(不静默返回空数组,见 F3 偏差修正)。
	 */
	async getProductionAudit(): Promise<VersionHistoryEntry[]> {
		return fetchProductionAudit(this.baseUrl);
	}
}
