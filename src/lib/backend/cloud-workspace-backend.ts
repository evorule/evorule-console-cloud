// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — CloudWorkspaceBackend:联网/离线双模式 workspace 后端
//
// 设计(与 CloudHttpBackend 同构,组合模式):
//   - online/offline 均指向"本地 evorule-server workspace API"(localBaseUrl),
//     online 额外可指向 remoteBaseUrl(远程 server)
//   - noServer 模式(纯离线演示,无 server 可达):内部使用 MockWorkspaceBackend,
//     数据纯内存,刷新即失(头部见 mock-workspace-backend.ts 明示)
//   - 实例不变:reconfigure 只替换内部实现,外部引用不变
//     → provideWorkspaceBackend 注入的引用不变,所有视图自动切换
//
// 模式语义(与 CloudHttpBackend 对齐):
//   - offline: localBaseUrl(默认 http://localhost:18080,用户本机 server)
//   - online:  remoteBaseUrl(用户配置的远程 server)
//   - 两者都要求 evorule-server 可达;纯离线演示用 noServer
//
// 为什么不继承 HttpWorkspaceBackend:
//   - 同 CloudHttpBackend 理由:baseUrl 不可变,组合优于继承

import {
	HttpWorkspaceBackend,
	type WorkspaceBackend,
	type WorkspaceRecord,
	type WorkspaceMemberRecord,
	type RuleRecord,
	type RuleVersionRecord,
	type SessionRecord,
	type SandboxSession,
	type TestDatasetRecord,
	type PublishQueueItem,
	type ProductionStateRecord,
	type ProductionAuditRecord,
	type VerdictContractRecord,
	type VersionClockMapRecord,
	type CreateWorkspaceRequest,
	type UpdateWorkspaceRequest,
	type AddMemberRequest,
	type CreateRuleRequest,
	type UpdateRuleContentRequest,
	type ForkRuleRequest,
	type CreateSessionRequest,
	type StartSandboxRequest,
	type StartSandboxResponse,
	type SubmitPublishRequest,
	type ReviewPublishRequest,
	type RollbackRequest,
	type ActorIdentity,
	type TranslateToTransformRequest,
	type TranslateToTransformResponse,
	type TranslateToConditionalRequest,
	type TranslateToConditionalResponse,
	type CreateVerdictContractRequest,
	type UpdateVerdictContractRequest,
	type EvaluateVerdictRequest,
	type EvaluateVerdictResult,
	type RecordClockRequest,
	type BundleImportResult,
	type BundleDryRunResult,
	type ActiveBundleInfo,
	type ValidateRulesResult,
	type SandboxTestReport,
	type ExecutionRulesResult
} from '$lib/kernel';
import { DEFAULT_LOCAL_BASE_URL, type CloudBackendConfig } from './types';
import { MockWorkspaceBackend } from './mock-workspace-backend';

/** CloudWorkspaceBackend 配置 — 比 CloudBackendConfig 多 noServer(纯离线演示) */
export interface CloudWorkspaceBackendConfig extends CloudBackendConfig {
	/** true 时不连任何 server,workspace 数据走内存 Mock(刷新即失) */
	noServer: boolean;
	/**
	 * Bearer token(evorule-server `EVORULE_AUTH_TOKEN`)。
	 * 旁路 store 收敛专项(2026-08-28):A1 接线——透传给内核
	 * HttpWorkspaceBackend(支持可选 token),workspace/发布队列/生产状态
	 * 全部端点随认证 server 闭环。留空 = 不带头(仅 dev)。
	 */
	authToken?: string;
	/**
	 * 操作者身份(D2 闭合 2026-08-28):透传给内核 HttpWorkspaceBackend,
	 * 发布链路审计字段(submitted_by/reviewed_by/operated_by + role)与
	 * 沙盒编排字段记录真实登录用户,不再硬编码 "console"。
	 * 未配置时内核回落 "console" 并 warn 一次。
	 */
	actor?: ActorIdentity | null;
}

// ============================================================================
// 模块级单例 — 供非组件层(store 模块)在任意调用点取用
//
// 为什么不用 useWorkspaceBackend(Svelte context):
//   Svelte 5 的 getContext 仅在组件初始化期可用,事件处理器/纯 store 模块内
//   调用会抛 lifecycle_outside_component。+layout.svelte 注入时同步登记到
//   此单例,store 层统一走 getActiveWorkspaceBackend()。
// ============================================================================

let activeWorkspaceBackend: WorkspaceBackend | null = null;

/** +layout.svelte 注入时登记(与 provideWorkspaceBackend 并行,同一实例) */
export function setActiveWorkspaceBackend(backend: WorkspaceBackend): void {
	activeWorkspaceBackend = backend;
}

/**
 * 取当前生效的 workspace backend(非组件层用)。
 * @throws 未初始化(+layout 未注入)时抛明确错误
 */
export function getActiveWorkspaceBackend(): WorkspaceBackend {
	if (!activeWorkspaceBackend) {
		throw new Error(
			'getActiveWorkspaceBackend: WorkspaceBackend 未初始化,请确认 +layout.svelte 已完成注入'
		);
	}
	return activeWorkspaceBackend;
}

export class CloudWorkspaceBackend implements WorkspaceBackend {
	private http: HttpWorkspaceBackend;
	private mock: MockWorkspaceBackend;
	private _config: CloudWorkspaceBackendConfig;

	constructor(config: Partial<CloudWorkspaceBackendConfig> = {}) {
		this._config = {
			mode: config.mode ?? 'offline',
			remoteBaseUrl: config.remoteBaseUrl ?? DEFAULT_LOCAL_BASE_URL,
			localBaseUrl: config.localBaseUrl ?? DEFAULT_LOCAL_BASE_URL,
			noServer: config.noServer ?? false,
			authToken: config.authToken,
			actor: config.actor
		};
		// A1 接线(旁路 store 收敛 2026-08-28):token 传入内核实现,
		// workspace 全部端点(含发布队列/生产状态/审计)凭据闭环
		// D2(2026-08-28):actor 传入内核实现,审计归属 = 真实登录用户
		this.http = new HttpWorkspaceBackend(
			this.resolveBaseUrl(),
			this._config.authToken ?? null,
			this._config.actor ?? null
		);
		this.mock = new MockWorkspaceBackend();
	}

	// === 配置访问器(只读) ===

	get config(): CloudWorkspaceBackendConfig {
		return { ...this._config };
	}

	get noServer(): boolean {
		return this._config.noServer;
	}

	get baseUrl(): string {
		return this.resolveBaseUrl();
	}

	// === 切换配置(核心) ===

	/**
	 * 重新配置 backend(切换 mode/noServer 或更新 baseUrl)。
	 * 之前注入的引用不变 — 视图无需重新取用。
	 */
	reconfigure(config: Partial<CloudWorkspaceBackendConfig>): void {
		this._config = { ...this._config, ...config };
		this.http = new HttpWorkspaceBackend(
			this.resolveBaseUrl(),
			this._config.authToken ?? null,
			this._config.actor ?? null
		);
	}

	private resolveBaseUrl(): string {
		const url =
			this._config.mode === 'online' ? this._config.remoteBaseUrl : this._config.localBaseUrl;
		return url.replace(/\/+$/, '');
	}

	/** 当前生效的内部实现(noServer → mock,否则 → http) */
	private get backend(): WorkspaceBackend {
		return this._config.noServer ? this.mock : this.http;
	}

	// === 代理全部 WorkspaceBackend 方法 ===

	listWorkspaces(): Promise<WorkspaceRecord[]> {
		return this.backend.listWorkspaces();
	}
	createWorkspace(req: CreateWorkspaceRequest): Promise<WorkspaceRecord> {
		return this.backend.createWorkspace(req);
	}
	getWorkspace(id: string): Promise<WorkspaceRecord> {
		return this.backend.getWorkspace(id);
	}
	updateWorkspace(id: string, req: UpdateWorkspaceRequest): Promise<WorkspaceRecord> {
		return this.backend.updateWorkspace(id, req);
	}
	archiveWorkspace(id: string): Promise<void> {
		return this.backend.archiveWorkspace(id);
	}
	listMembers(id: string): Promise<WorkspaceMemberRecord[]> {
		return this.backend.listMembers(id);
	}
	listRules(workspaceId: string): Promise<RuleRecord[]> {
		return this.backend.listRules(workspaceId);
	}
	createRule(workspaceId: string, req: CreateRuleRequest): Promise<RuleRecord> {
		return this.backend.createRule(workspaceId, req);
	}
	getRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.backend.getRule(workspaceId, ruleId);
	}
	updateRuleContent(
		workspaceId: string,
		ruleId: string,
		req: UpdateRuleContentRequest
	): Promise<RuleRecord> {
		return this.backend.updateRuleContent(workspaceId, ruleId, req);
	}
	activateRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.backend.activateRule(workspaceId, ruleId);
	}
	submitRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.backend.submitRule(workspaceId, ruleId);
	}
	blockRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.backend.blockRule(workspaceId, ruleId);
	}
	archiveRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.backend.archiveRule(workspaceId, ruleId);
	}
	forkRule(workspaceId: string, ruleId: string, req: ForkRuleRequest): Promise<RuleRecord> {
		return this.backend.forkRule(workspaceId, ruleId, req);
	}
	listRuleVersions(workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]> {
		return this.backend.listRuleVersions(workspaceId, ruleId);
	}
	getRuleVersion(
		workspaceId: string,
		ruleId: string,
		versionId: string
	): Promise<RuleVersionRecord> {
		return this.backend.getRuleVersion(workspaceId, ruleId, versionId);
	}
	createWorkspaceSession(workspaceId: string, req: CreateSessionRequest): Promise<SessionRecord> {
		return this.backend.createWorkspaceSession(workspaceId, req);
	}
	listWorkspaceSessions(workspaceId: string): Promise<SessionRecord[]> {
		return this.backend.listWorkspaceSessions(workspaceId);
	}
	startSandbox(workspaceId: string, req: StartSandboxRequest): Promise<StartSandboxResponse> {
		return this.backend.startSandbox(workspaceId, req);
	}
	listSandboxes(workspaceId: string): Promise<SandboxSession[]> {
		return this.backend.listSandboxes(workspaceId);
	}
	getSandbox(workspaceId: string, sandboxId: number): Promise<SandboxSession> {
		return this.backend.getSandbox(workspaceId, sandboxId);
	}
	closeSandbox(workspaceId: string, sandboxId: number): Promise<void> {
		return this.backend.closeSandbox(workspaceId, sandboxId);
	}
	listTestDatasets(workspaceId: string): Promise<TestDatasetRecord[]> {
		return this.backend.listTestDatasets(workspaceId);
	}
	listPublishQueue(status?: string): Promise<PublishQueueItem[]> {
		return this.backend.listPublishQueue(status);
	}
	submitPublish(req: SubmitPublishRequest): Promise<PublishQueueItem> {
		return this.backend.submitPublish(req);
	}
	reviewPublish(queueId: number, req: ReviewPublishRequest): Promise<PublishQueueItem> {
		return this.backend.reviewPublish(queueId, req);
	}
	emergencyRollback(req: RollbackRequest): Promise<void> {
		return this.backend.emergencyRollback(req);
	}
	getProductionState(): Promise<ProductionStateRecord> {
		return this.backend.getProductionState();
	}
	listProductionAudit(): Promise<ProductionAuditRecord[]> {
		return this.backend.listProductionAudit();
	}
	translateToTransform(req: TranslateToTransformRequest): Promise<TranslateToTransformResponse> {
		return this.backend.translateToTransform(req);
	}
	translateToConditional(
		req: TranslateToConditionalRequest
	): Promise<TranslateToConditionalResponse> {
		return this.backend.translateToConditional(req);
	}
	listVerdictContracts(workspaceId: string): Promise<VerdictContractRecord[]> {
		return this.backend.listVerdictContracts(workspaceId);
	}
	createVerdictContract(
		workspaceId: string,
		req: CreateVerdictContractRequest
	): Promise<VerdictContractRecord> {
		return this.backend.createVerdictContract(workspaceId, req);
	}
	getVerdictContract(workspaceId: string, cid: number): Promise<VerdictContractRecord> {
		return this.backend.getVerdictContract(workspaceId, cid);
	}
	updateVerdictContract(
		workspaceId: string,
		cid: number,
		req: UpdateVerdictContractRequest
	): Promise<VerdictContractRecord> {
		return this.backend.updateVerdictContract(workspaceId, cid, req);
	}
	deleteVerdictContract(workspaceId: string, cid: number): Promise<void> {
		return this.backend.deleteVerdictContract(workspaceId, cid);
	}
	evaluateVerdict(workspaceId: string, req: EvaluateVerdictRequest): Promise<EvaluateVerdictResult> {
		return this.backend.evaluateVerdict(workspaceId, req);
	}
	recordClock(sessionId: number, req: RecordClockRequest): Promise<void> {
		return this.backend.recordClock(sessionId, req);
	}
	lookupClock(sessionId: number, fromVersion?: number, toVersion?: number): Promise<VersionClockMapRecord[]> {
		return this.backend.lookupClock(sessionId, fromVersion, toVersion);
	}

	// === 快照包导入(治理→执行域部署通道,委托内部 backend) ===
	importBundle(bundle: unknown): Promise<BundleImportResult> {
		return this.backend.importBundle(bundle);
	}
	dryRunImportBundle(bundle: unknown): Promise<BundleDryRunResult> {
		return this.backend.dryRunImportBundle(bundle);
	}
	listActiveBundles(): Promise<ActiveBundleInfo[]> {
		return this.backend.listActiveBundles();
	}

	// === 治理域 API 接线(UV-062:执行域 server 直连端点,委托内部 backend) ===
	validateRules(content: string): Promise<ValidateRulesResult> {
		return this.backend.validateRules(content);
	}
	getSandboxReport(workspaceId: string, sandboxId: number): Promise<SandboxTestReport> {
		return this.backend.getSandboxReport(workspaceId, sandboxId);
	}
	getExecutionRules(): Promise<ExecutionRulesResult> {
		return this.backend.getExecutionRules();
	}
	getPublishQueueItem(queueId: number): Promise<PublishQueueItem> {
		return this.backend.getPublishQueueItem(queueId);
	}
	addMember(workspaceId: string, req: AddMemberRequest): Promise<WorkspaceMemberRecord> {
		return this.backend.addMember(workspaceId, req);
	}
	removeMember(workspaceId: string, userId: string): Promise<void> {
		return this.backend.removeMember(workspaceId, userId);
	}
}
