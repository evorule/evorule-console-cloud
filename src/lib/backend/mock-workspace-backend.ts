// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — MockWorkspaceBackend:离线内存版 workspace 后端
//
// 设计:
//   - 实现 kernel WorkspaceBackend 全部 37 方法,供离线模式/单元测试注入
//   - 数据纯内存,刷新即失 — 头部明示:离线演示数据不持久化(决策 2026-08-27)
//   - 规则/版本语义对齐 evorule-server rule_meta_service.rs(权威):
//       createRule → state=draft, version=1(current), current_version_id 指向 v1
//       updateRuleContent → 仅 draft 可编辑;旧版本 superseded,新版本 version+1
//       submit/activate/block/archive → 状态机转换
//   - 只读写操作(submitPublish/startSandbox/translate/verdict/clock 等)不臆造语义,
//     如实抛错提示连接 evorule-server(fail-fast 原则)
//   - 只读空集合(listSandboxes/listTestDatasets/listPublishQueue 等)返回空,
//     属"演示数据为空",非静默掩盖

import type {
	WorkspaceBackend,
	WorkspaceMemberRecord,
	WorkspaceRecord,
	RuleRecord,
	RuleVersionRecord,
	SessionRecord,
	SandboxSession,
	TestDatasetRecord,
	PublishQueueItem,
	ProductionStateRecord,
	ProductionAuditRecord,
	VerdictContractRecord,
	VersionClockMapRecord,
	CreateWorkspaceRequest,
	UpdateWorkspaceRequest,
	AddMemberRequest,
	CreateRuleRequest,
	UpdateRuleContentRequest,
	ForkRuleRequest,
	CreateSessionRequest,
	StartSandboxRequest,
	StartSandboxResponse,
	CreateTestDatasetRequest,
	SubmitPublishRequest,
	ReviewPublishRequest,
	RollbackRequest,
	TranslateToTransformRequest,
	TranslateToTransformResponse,
	TranslateToConditionalRequest,
	TranslateToConditionalResponse,
	CreateVerdictContractRequest,
	UpdateVerdictContractRequest,
	EvaluateVerdictRequest,
	EvaluateVerdictResult,
	RecordClockRequest,
	BundleImportResult,
	BundleDryRunResult,
	ActiveBundleInfo,
	ValidateRulesResult,
	SandboxTestReport,
	ExecutionRulesResult
} from '$lib/kernel';

/** 离线演示模式不支持的操作的统一错误(fail-fast,不静默掩盖) */
function unsupported(op: string): never {
	throw new Error(
		`MockWorkspaceBackend: 离线演示模式不支持 "${op}",请连接 evorule-server 使用完整功能`
	);
}

export class MockWorkspaceBackend implements WorkspaceBackend {
	private workspaces = new Map<string, WorkspaceRecord>();
	private rules = new Map<string, RuleRecord>();
	private versions = new Map<string, RuleVersionRecord[]>();
	private seq = 0;

	private nextId(prefix: string): string {
		this.seq += 1;
		return `${prefix}-${this.seq.toString().padStart(4, '0')}`;
	}

	private now(): string {
		return new Date().toISOString();
	}

	// === Workspace 管理 ===

	async listWorkspaces(): Promise<WorkspaceRecord[]> {
		return [...this.workspaces.values()];
	}

	async createWorkspace(req: CreateWorkspaceRequest): Promise<WorkspaceRecord> {
		const id = this.nextId('ws');
		const now = this.now();
		const ws: WorkspaceRecord = {
			id,
			name: req.name,
			owner_id: req.owner_id,
			created_at: now,
			updated_at: now,
			archived_at: null,
			state: 'active',
			description: req.description ?? null
		};
		this.workspaces.set(id, ws);
		return ws;
	}

	async getWorkspace(id: string): Promise<WorkspaceRecord> {
		const ws = this.workspaces.get(id);
		if (!ws) throw new Error(`workspace "${id}" 不存在`);
		return ws;
	}

	async updateWorkspace(id: string, req: UpdateWorkspaceRequest): Promise<WorkspaceRecord> {
		const ws = await this.getWorkspace(id);
		if (req.name !== undefined) ws.name = req.name;
		if (req.description !== undefined) ws.description = req.description;
		ws.updated_at = this.now();
		return ws;
	}

	async archiveWorkspace(id: string): Promise<void> {
		const ws = await this.getWorkspace(id);
		ws.state = 'archived';
		ws.archived_at = this.now();
	}

	// === 成员 ===

	async listMembers(id: string): Promise<WorkspaceMemberRecord[]> {
		const ws = await this.getWorkspace(id);
		return [
			{
				workspace_id: ws.id,
				user_id: ws.owner_id,
				role: 'owner',
				joined_at: ws.created_at
			}
		];
	}

	// === 规则管理 ===

	private requireWs(workspaceId: string): void {
		if (!this.workspaces.has(workspaceId)) {
			throw new Error(`workspace "${workspaceId}" 不存在`);
		}
	}

	async listRules(workspaceId: string): Promise<RuleRecord[]> {
		this.requireWs(workspaceId);
		return [...this.rules.values()].filter((r) => r.workspace_id === workspaceId);
	}

	async createRule(workspaceId: string, req: CreateRuleRequest): Promise<RuleRecord> {
		this.requireWs(workspaceId);
		if (!req.name.trim()) throw new Error('rule name must not be empty');
		JSON.parse(req.content); // 合法性校验,与 server 对齐(非法 JSON 抛错)

		const id = this.nextId('rule');
		const now = this.now();
		const versionId = `${id}-v1`;
		const rule: RuleRecord = {
			id,
			workspace_id: workspaceId,
			name: req.name,
			current_version_id: versionId,
			state: 'draft',
			created_at: now,
			updated_at: now,
			archived_at: null,
			description: req.description ?? null,
			created_by: req.created_by,
			metadata: '{}'
		};
		this.rules.set(id, rule);
		this.versions.set(id, [
			{
				id: versionId,
				rule_id: id,
				version: 1,
				content_hash: `mock-${id}`,
				content: req.content,
				created_at: now,
				state: 'current',
				created_by: req.created_by
			}
		]);
		return rule;
	}

	async getRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		const rule = this.rules.get(ruleId);
		if (!rule || rule.workspace_id !== workspaceId) {
			throw new Error(`rule "${ruleId}" 不存在`);
		}
		return rule;
	}

	async updateRuleContent(
		workspaceId: string,
		ruleId: string,
		req: UpdateRuleContentRequest
	): Promise<RuleRecord> {
		const rule = await this.getRule(workspaceId, ruleId);
		if (rule.state !== 'draft') {
			throw new Error(`规则 "${rule.name}" 状态为 ${rule.state},仅 draft 允许编辑内容`);
		}
		JSON.parse(req.content);
		const list = this.versions.get(ruleId) ?? [];
		const prev = list[0];
		if (prev) prev.state = 'superseded';
		const now = this.now();
		const nextNum = prev ? prev.version + 1 : 1;
		const versionId = `${ruleId}-v${nextNum}`;
		list.unshift({
			id: versionId,
			rule_id: ruleId,
			version: nextNum,
			content_hash: `mock-${versionId}`,
			content: req.content,
			created_at: now,
			state: 'current',
			created_by: req.updated_by
		});
		this.versions.set(ruleId, list);
		rule.current_version_id = versionId;
		rule.updated_at = now;
		return rule;
	}

	private transition(workspaceId: string, ruleId: string, to: RuleRecord['state']): RuleRecord {
		const rule = this.rules.get(ruleId);
		if (!rule || rule.workspace_id !== workspaceId) {
			throw new Error(`rule "${ruleId}" 不存在`);
		}
		if (to !== 'archived' && rule.state === 'archived') {
			throw new Error(`InvalidStateTransition: archived → ${to}`);
		}
		rule.state = to;
		if (to === 'archived') rule.archived_at = this.now();
		rule.updated_at = this.now();
		return rule;
	}

	async activateRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.transition(workspaceId, ruleId, 'active');
	}

	async submitRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.transition(workspaceId, ruleId, 'candidate');
	}

	async blockRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.transition(workspaceId, ruleId, 'blocked');
	}

	async archiveRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
		return this.transition(workspaceId, ruleId, 'archived');
	}

	/**
	 * Fork 规则 — 离线不支持,如实抛错。
	 * server fork 语义(复制当前版本内容为新规则 + 独立版本历史)不在 mock 复制,
	 * 静默返回假数据或静默缺省均被禁止。
	 */
	async forkRule(
		_workspaceId: string,
		_ruleId: string,
		_req: ForkRuleRequest
	): Promise<RuleRecord> {
		unsupported('forkRule');
	}

	// === 规则版本 ===

	async listRuleVersions(workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]> {
		await this.getRule(workspaceId, ruleId);
		return [...(this.versions.get(ruleId) ?? [])].sort((a, b) => b.version - a.version);
	}

	async getRuleVersion(
		workspaceId: string,
		ruleId: string,
		versionId: string
	): Promise<RuleVersionRecord> {
		await this.getRule(workspaceId, ruleId);
		const found = (this.versions.get(ruleId) ?? []).find((v) => v.id === versionId);
		if (!found) throw new Error(`rule version "${versionId}" 不存在`);
		return found;
	}

	// === 会话管理 ===

	async createWorkspaceSession(
		_workspaceId: string,
		req: CreateSessionRequest
	): Promise<SessionRecord> {
		unsupported('createWorkspaceSession');
	}

	async listWorkspaceSessions(_workspaceId: string): Promise<SessionRecord[]> {
		return [];
	}

	// === 沙盒编排 ===

	async startSandbox(_workspaceId: string, _req: StartSandboxRequest): Promise<StartSandboxResponse> {
		unsupported('startSandbox');
	}

	async listSandboxes(_workspaceId: string): Promise<SandboxSession[]> {
		return [];
	}

	async getSandbox(_workspaceId: string, _sandboxId: number): Promise<SandboxSession> {
		unsupported('getSandbox');
	}

	async closeSandbox(_workspaceId: string, _sandboxId: number): Promise<void> {
		unsupported('closeSandbox');
	}

	// === 测试数据集 ===

	async listTestDatasets(_workspaceId: string): Promise<TestDatasetRecord[]> {
		return [];
	}

	// 写操作:创建合成数据集需 server sandbox_service 落库,离线不支持(不臆造语义)
	async createTestDataset(
		_workspaceId: string,
		_req: CreateTestDatasetRequest
	): Promise<TestDatasetRecord> {
		unsupported('createTestDataset');
	}

	// === 发布队列(写操作属多人审批流程,离线不支持) ===

	async listPublishQueue(_status?: string): Promise<PublishQueueItem[]> {
		return [];
	}

	async submitPublish(_req: SubmitPublishRequest): Promise<PublishQueueItem> {
		unsupported('submitPublish');
	}

	async reviewPublish(_queueId: number, _req: ReviewPublishRequest): Promise<PublishQueueItem> {
		unsupported('reviewPublish');
	}

	async emergencyRollback(_req: RollbackRequest): Promise<void> {
		unsupported('emergencyRollback');
	}

	// === 生产状态 + 审计 ===

	async getProductionState(): Promise<ProductionStateRecord> {
		return {
			id: 1,
			current_session_id: null,
			ruleset_version: 0,
			ruleset_hash: null,
			last_operated_by: null,
			updated_at: this.now()
		};
	}

	async listProductionAudit(): Promise<ProductionAuditRecord[]> {
		return [];
	}

	// === 规则转译(server 端纯函数,离线不复制实现) ===

	async translateToTransform(_req: TranslateToTransformRequest): Promise<TranslateToTransformResponse> {
		unsupported('translateToTransform');
	}

	async translateToConditional(
		_req: TranslateToConditionalRequest
	): Promise<TranslateToConditionalResponse> {
		unsupported('translateToConditional');
	}

	// === 判定契约 ===

	async listVerdictContracts(_workspaceId: string): Promise<VerdictContractRecord[]> {
		return [];
	}

	async createVerdictContract(
		_workspaceId: string,
		_req: CreateVerdictContractRequest
	): Promise<VerdictContractRecord> {
		unsupported('createVerdictContract');
	}

	async getVerdictContract(_workspaceId: string, _cid: number): Promise<VerdictContractRecord> {
		unsupported('getVerdictContract');
	}

	async updateVerdictContract(
		_workspaceId: string,
		_cid: number,
		_req: UpdateVerdictContractRequest
	): Promise<VerdictContractRecord> {
		unsupported('updateVerdictContract');
	}

	async deleteVerdictContract(_workspaceId: string, _cid: number): Promise<void> {
		unsupported('deleteVerdictContract');
	}

	async evaluateVerdict(
		_workspaceId: string,
		_req: EvaluateVerdictRequest
	): Promise<EvaluateVerdictResult> {
		unsupported('evaluateVerdict');
	}

	// === wall-clock 旁路 ===

	async recordClock(_sessionId: number, _req: RecordClockRequest): Promise<void> {
		unsupported('recordClock');
	}

	async lookupClock(_sessionId: number, _fromVersion?: number, _toVersion?: number): Promise<VersionClockMapRecord[]> {
		return [];
	}

	// === 快照包导入(治理→执行域部署通道) ===

	async importBundle(_bundle: unknown): Promise<BundleImportResult> {
		unsupported('importBundle');
	}

	async dryRunImportBundle(_bundle: unknown): Promise<BundleDryRunResult> {
		unsupported('dryRunImportBundle');
	}

	async listActiveBundles(): Promise<ActiveBundleInfo[]> {
		return [];
	}

	// === 治理域 API 接线(UV-062:执行域 server 直连端点) ===

	/**
	 * 规则体校验 — 离线不支持:server 校验语义(静态+安全分析)不在 mock 复制,
	 * 如实抛错(fabricating passed=true 属静默通过,禁止)。
	 */
	async validateRules(_content: string): Promise<ValidateRulesResult> {
		unsupported('validateRules');
	}

	/** 沙盒测试报告 — 离线无沙盒编排,如实抛错 */
	async getSandboxReport(
		_workspaceId: string,
		_sandboxId: number
	): Promise<SandboxTestReport> {
		unsupported('getSandboxReport');
	}

	/** 执行域生效规则 — 离线演示为空(与 listSandboxes 等只读空集合同口径) */
	async getExecutionRules(): Promise<ExecutionRulesResult> {
		return { count: 0, core_eval: [] };
	}

	/** 发布队列项详情 — 离线队列为空,详情查询如实抛错 */
	async getPublishQueueItem(_queueId: number): Promise<PublishQueueItem> {
		unsupported('getPublishQueueItem');
	}

	/** 添加成员 — 写操作,离线不支持 */
	async addMember(
		_workspaceId: string,
		_req: AddMemberRequest
	): Promise<WorkspaceMemberRecord> {
		unsupported('addMember');
	}

	/** 移除成员 — 写操作,离线不支持 */
	async removeMember(_workspaceId: string, _userId: string): Promise<void> {
		unsupported('removeMember');
	}
}
