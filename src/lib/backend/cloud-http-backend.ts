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
	type SessionAudit,
	type VerifyResult,
	type Fact,
	type DiffResult,
	type CausalChain,
	type CommandResult
} from '@evorule/console';
import { DEFAULT_LOCAL_BASE_URL, type NetMode, type CloudBackendConfig } from './types';

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
	getFacts(id: SessionId, prefix?: string): Promise<Fact[]> {
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
	getStateAtVersion(id: SessionId, version: number): Promise<SessionState> {
		return this.backend.getStateAtVersion(id, version);
	}
	getDiff(id: SessionId, a: number, b: number): Promise<DiffResult> {
		return this.backend.getDiff(id, a, b);
	}
	forkSession(parentId: SessionId, version: number): Promise<SessionId> {
		return this.backend.forkSession(parentId, version);
	}
}
