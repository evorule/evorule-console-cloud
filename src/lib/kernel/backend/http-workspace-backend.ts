// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console workspace 后端 — HttpWorkspaceBackend 实现
//
// 依据: 实施文档_界面升级_v1.0.md §C.1
// 端点对齐: evorule-server core/workspace/src/api.rs build_workspace_router 全部路由
//
// 设计说明 (与 http-backend.ts 同构,独立实现避免跨依赖):
//   - baseUrl 默认 http://127.0.0.1:18080 (与 ExecutionBackend 同址)
//   - fetchJson 统一 fetch + JSON 解析 + 错误处理
//   - Bearer token: 可选构造参数;非空时每请求带 Authorization header
//     (loopback 开发模式不传 = 免认证;生产非 loopback 必须传 token)
//   - 浏览器端调用(SSR 不安全,SvelteKit onMount 后用)

import type {
  WorkspaceBackend,
  WorkspaceRecord,
  WorkspaceMemberRecord,
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
  CreateRuleRequest,
  UpdateRuleContentRequest,
  CreateSessionRequest,
  StartSandboxRequest,
  StartSandboxResponse,
  SubmitPublishRequest,
  ReviewPublishRequest,
  RollbackRequest,
  PublishRole,
  TranslateToTransformRequest,
  TranslateToTransformResponse,
  TranslateToConditionalRequest,
  TranslateToConditionalResponse,
  CreateVerdictContractRequest,
  UpdateVerdictContractRequest,
  EvaluateVerdictRequest,
  EvaluateVerdictResult,
  RecordClockRequest
} from './workspace-types';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18080';

/**
 * 默认请求者身份 (dev/loopback)。
 * server 沙盒 GET 端点要求 `?requester=` 做 workspace 成员权限校验;
 * POST start/close 要求 body 携带 `started_by` / `closed_by`。
 * 生产环境应由 auth token 派生;开发期统一用 "console"。
 */
const DEFAULT_REQUESTER = 'console';

/**
 * workspace 后端连接或响应异常的统一错误类型。
 * 与 HttpBackendError 同构,独立定义避免跨依赖。
 */
export class HttpWorkspaceBackendError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'HttpWorkspaceBackendError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

/**
 * HttpWorkspaceBackend — 调 evorule-server workspace HTTP API 实现 WorkspaceBackend。
 *
 * 用法:
 *   const wb = new HttpWorkspaceBackend();                        // loopback 免认证
 *   const wb = new HttpWorkspaceBackend('http://x:18080', token); // 生产带 token
 */
export class HttpWorkspaceBackend implements WorkspaceBackend {
  private readonly baseUrl: string;
  private readonly authToken: string | null;

  constructor(baseUrl: string = DEFAULT_BASE_URL, authToken: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  // ------------------------------------------------------------------------
  // 内部工具
  // ------------------------------------------------------------------------

  /** 构造请求头(含可选 Bearer token) */
  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.authToken) {
      h['Authorization'] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  /** 统一 fetch + JSON 解析 + 错误处理 (与 http-backend.ts fetchJson 同构) */
  private async fetchJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const url = this.baseUrl + path;
    let r: Response;
    try {
      r = await fetch(url, opts);
    } catch (e) {
      throw new HttpWorkspaceBackendError(
        `network error: ${(e as Error).message}`,
        0,
        path
      );
    }

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new HttpWorkspaceBackendError(
        `HTTP ${r.status}: ${text.slice(0, 200)}`,
        r.status,
        path
      );
    }

    // DELETE / 无内容响应
    if (r.status === 204) {
      return undefined as T;
    }
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) {
      return (await r.json()) as T;
    }
    return (await r.text()) as unknown as T;
  }

  /** 构造 POST application/json 请求 */
  private postJson(body?: unknown): RequestInit {
    return {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body)
    };
  }

  /** 构造 PATCH application/json 请求 */
  private patchJson(body: unknown): RequestInit {
    return {
      method: 'PATCH',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    };
  }

  /** 构造带 Authorization 的 DELETE 请求 */
  private delete(): RequestInit {
    return { method: 'DELETE', headers: this.headers() };
  }

  // ------------------------------------------------------------------------
  // === Workspace 管理 ===
  // ------------------------------------------------------------------------

  /** GET /api/workspaces */
  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const j = await this.fetchJson<WorkspaceRecord[] | { workspaces: WorkspaceRecord[] }>(
      '/api/workspaces',
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.workspaces ?? [];
  }

  /** POST /api/workspaces */
  async createWorkspace(req: CreateWorkspaceRequest): Promise<WorkspaceRecord> {
    return this.fetchJson<WorkspaceRecord>('/api/workspaces', this.postJson(req));
  }

  /** GET /api/workspaces/{id} */
  async getWorkspace(id: string): Promise<WorkspaceRecord> {
    return this.fetchJson<WorkspaceRecord>(
      `/api/workspaces/${encodeURIComponent(id)}`,
      { headers: this.headers() }
    );
  }

  /** PATCH /api/workspaces/{id} */
  async updateWorkspace(id: string, req: UpdateWorkspaceRequest): Promise<WorkspaceRecord> {
    return this.fetchJson<WorkspaceRecord>(
      `/api/workspaces/${encodeURIComponent(id)}`,
      this.patchJson(req)
    );
  }

  /** DELETE /api/workspaces/{id} (归档) */
  async archiveWorkspace(id: string): Promise<void> {
    await this.fetchJson<void>(
      `/api/workspaces/${encodeURIComponent(id)}`,
      this.delete()
    );
  }

  // ------------------------------------------------------------------------
  // === 成员 ===
  // ------------------------------------------------------------------------

  /** GET /api/workspaces/{id}/members */
  async listMembers(id: string): Promise<WorkspaceMemberRecord[]> {
    const j = await this.fetchJson<
      WorkspaceMemberRecord[] | { members: WorkspaceMemberRecord[] }
    >(`/api/workspaces/${encodeURIComponent(id)}/members`, { headers: this.headers() });
    return Array.isArray(j) ? j : j?.members ?? [];
  }

  // ------------------------------------------------------------------------
  // === 规则管理 ===
  // ------------------------------------------------------------------------

  /** GET /api/workspaces/{id}/rules */
  async listRules(workspaceId: string): Promise<RuleRecord[]> {
    const j = await this.fetchJson<RuleRecord[] | { rules: RuleRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules`,
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.rules ?? [];
  }

  /** POST /api/workspaces/{id}/rules */
  async createRule(workspaceId: string, req: CreateRuleRequest): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules`,
      this.postJson(req)
    );
  }

  /** GET /api/workspaces/{id}/rules/{rule_id} */
  async getRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}`,
      { headers: this.headers() }
    );
  }

  /** PATCH /api/workspaces/{id}/rules/{rule_id} (仅 Draft 状态) */
  async updateRuleContent(
    workspaceId: string,
    ruleId: string,
    req: UpdateRuleContentRequest
  ): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}`,
      this.patchJson(req)
    );
  }

  /** POST /api/workspaces/{id}/rules/{rule_id}/activate */
  async activateRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}/activate`,
      this.postJson()
    );
  }

  /** POST /api/workspaces/{id}/rules/{rule_id}/submit (Draft→Candidate) */
  async submitRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}/submit`,
      this.postJson()
    );
  }

  /** POST /api/workspaces/{id}/rules/{rule_id}/block (Active→Blocked) */
  async blockRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}/block`,
      this.postJson()
    );
  }

  /** POST /api/workspaces/{id}/rules/{rule_id}/archive */
  async archiveRule(workspaceId: string, ruleId: string): Promise<RuleRecord> {
    return this.fetchJson<RuleRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}/archive`,
      this.postJson()
    );
  }

  // ------------------------------------------------------------------------
  // === 规则版本查询 (阶段 D 新增, RuleRecord 不含 content, content 在 rule_versions 表) ===
  // ------------------------------------------------------------------------

  /** GET /api/workspaces/{id}/rules/{rule_id}/versions — 列出规则全部版本(含 content, 按 version 降序) */
  async listRuleVersions(workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]> {
    const j = await this.fetchJson<
      RuleVersionRecord[] | { versions: RuleVersionRecord[] }
    >(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}/versions`,
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.versions ?? [];
  }

  /** GET /api/workspaces/{id}/rules/{rule_id}/versions/{version_id} — 获取规则指定版本(含 content) */
  async getRuleVersion(
    workspaceId: string,
    ruleId: string,
    versionId: string
  ): Promise<RuleVersionRecord> {
    return this.fetchJson<RuleVersionRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(ruleId)}/versions/${encodeURIComponent(versionId)}`,
      { headers: this.headers() }
    );
  }

  // ------------------------------------------------------------------------
  // === 会话管理 (workspace 级) ===
  // ------------------------------------------------------------------------

  /** POST /api/workspaces/{id}/sessions */
  async createWorkspaceSession(
    workspaceId: string,
    req: CreateSessionRequest
  ): Promise<SessionRecord> {
    return this.fetchJson<SessionRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      this.postJson(req)
    );
  }

  /** GET /api/workspaces/{id}/sessions */
  async listWorkspaceSessions(workspaceId: string): Promise<SessionRecord[]> {
    const j = await this.fetchJson<SessionRecord[] | { sessions: SessionRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.sessions ?? [];
  }

  // ------------------------------------------------------------------------
  // === 沙盒编排 ===
  // ------------------------------------------------------------------------

  /** POST /api/workspaces/{id}/sandboxes */
  async startSandbox(
    workspaceId: string,
    req: StartSandboxRequest
  ): Promise<StartSandboxResponse> {
    // server StartSandboxHttpRequest = StartSandboxRequest (flatten) + started_by
    return this.fetchJson<StartSandboxResponse>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sandboxes`,
      this.postJson({ ...req, started_by: DEFAULT_REQUESTER })
    );
  }

  /** GET /api/workspaces/{id}/sandboxes?requester= */
  async listSandboxes(workspaceId: string): Promise<SandboxSession[]> {
    const j = await this.fetchJson<SandboxSession[] | { sandboxes: SandboxSession[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sandboxes?requester=${encodeURIComponent(DEFAULT_REQUESTER)}`,
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.sandboxes ?? [];
  }

  /** GET /api/workspaces/{id}/sandboxes/{sandbox_id}?requester= */
  async getSandbox(workspaceId: string, sandboxId: number): Promise<SandboxSession> {
    return this.fetchJson<SandboxSession>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sandboxes/${sandboxId}?requester=${encodeURIComponent(DEFAULT_REQUESTER)}`,
      { headers: this.headers() }
    );
  }

  /** POST /api/workspaces/{id}/sandboxes/{sandbox_id}/close (body: {closed_by}) */
  async closeSandbox(workspaceId: string, sandboxId: number): Promise<void> {
    await this.fetchJson<void>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sandboxes/${sandboxId}/close`,
      this.postJson({ closed_by: DEFAULT_REQUESTER })
    );
  }

  // ------------------------------------------------------------------------
  // === 测试数据集 ===
  // ------------------------------------------------------------------------

  /** GET /api/workspaces/{id}/test-datasets */
  async listTestDatasets(workspaceId: string): Promise<TestDatasetRecord[]> {
    const j = await this.fetchJson<
      TestDatasetRecord[] | { datasets: TestDatasetRecord[] }
    >(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/test-datasets`,
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.datasets ?? [];
  }

  // ------------------------------------------------------------------------
  // === 发布队列 ===
  // ------------------------------------------------------------------------

  /** GET /api/publish/queue?status= */
  async listPublishQueue(status?: string): Promise<PublishQueueItem[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const j = await this.fetchJson<
      PublishQueueItem[] | { items: PublishQueueItem[] }
    >(`/api/publish/queue${q}`, { headers: this.headers() });
    return Array.isArray(j) ? j : j?.items ?? [];
  }

  /** POST /api/publish/queue (body = SubmitPublishRequest + submitted_by + role) */
  async submitPublish(req: SubmitPublishRequest): Promise<PublishQueueItem> {
    // server SubmitPublishHttpRequest = SubmitPublishRequest (flatten) + submitted_by + role
    // 角色权限: doctor 不可提交 → 用 department_head
    return this.fetchJson<PublishQueueItem>(
      '/api/publish/queue',
      this.postJson({ ...req, submitted_by: DEFAULT_REQUESTER, role: 'department_head' as PublishRole })
    );
  }

  /** POST /api/publish/queue/{queue_id}/review (body = ReviewPublishRequest + reviewed_by + role) */
  async reviewPublish(
    queueId: number,
    req: ReviewPublishRequest
  ): Promise<PublishQueueItem> {
    // server ReviewPublishHttpRequest = ReviewPublishRequest (flatten) + reviewed_by + role
    // 角色权限: department_head 不可审批 → 用 admin
    return this.fetchJson<PublishQueueItem>(
      `/api/publish/queue/${queueId}/review`,
      this.postJson({ ...req, reviewed_by: DEFAULT_REQUESTER, role: 'admin' as PublishRole })
    );
  }

  /** POST /api/publish/rollback (body = RollbackRequest + operated_by + role, 紧急回滚) */
  async emergencyRollback(req: RollbackRequest): Promise<void> {
    // server RollbackHttpRequest = RollbackRequest (flatten) + operated_by + role (必须 admin)
    await this.fetchJson<void>(
      '/api/publish/rollback',
      this.postJson({ ...req, operated_by: DEFAULT_REQUESTER, role: 'admin' as PublishRole })
    );
  }

  // ------------------------------------------------------------------------
  // === 生产状态 + 审计 ===
  // ------------------------------------------------------------------------

  /** GET /api/production/state */
  async getProductionState(): Promise<ProductionStateRecord> {
    return this.fetchJson<ProductionStateRecord>('/api/production/state', {
      headers: this.headers()
    });
  }

  /** GET /api/production/audit */
  async listProductionAudit(): Promise<ProductionAuditRecord[]> {
    const j = await this.fetchJson<
      ProductionAuditRecord[] | { audit: ProductionAuditRecord[] }
    >('/api/production/audit', { headers: this.headers() });
    return Array.isArray(j) ? j : j?.audit ?? [];
  }

  // ------------------------------------------------------------------------
  // === 规则转译 (纯函数,阶段 A.2) ===
  // ------------------------------------------------------------------------

  /** POST /api/rules/translate/to_transform — condition+action_set → transform */
  async translateToTransform(
    req: TranslateToTransformRequest
  ): Promise<TranslateToTransformResponse> {
    return this.fetchJson<TranslateToTransformResponse>(
      '/api/rules/translate/to_transform',
      this.postJson(req)
    );
  }

  /** POST /api/rules/translate/to_conditional — transform → condition+action_set (可能 lossy) */
  async translateToConditional(
    req: TranslateToConditionalRequest
  ): Promise<TranslateToConditionalResponse> {
    return this.fetchJson<TranslateToConditionalResponse>(
      '/api/rules/translate/to_conditional',
      this.postJson(req)
    );
  }

  // ------------------------------------------------------------------------
  // === 判定契约 (阶段 A.3) ===
  // ------------------------------------------------------------------------

  /** GET /api/workspaces/{id}/verdict_contracts */
  async listVerdictContracts(workspaceId: string): Promise<VerdictContractRecord[]> {
    const j = await this.fetchJson<
      VerdictContractRecord[] | { contracts: VerdictContractRecord[] }
    >(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/verdict_contracts`,
      { headers: this.headers() }
    );
    return Array.isArray(j) ? j : j?.contracts ?? [];
  }

  /** POST /api/workspaces/{id}/verdict_contracts */
  async createVerdictContract(
    workspaceId: string,
    req: CreateVerdictContractRequest
  ): Promise<VerdictContractRecord> {
    return this.fetchJson<VerdictContractRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/verdict_contracts`,
      this.postJson(req)
    );
  }

  /** GET /api/workspaces/{id}/verdict_contracts/{cid} */
  async getVerdictContract(
    workspaceId: string,
    cid: number
  ): Promise<VerdictContractRecord> {
    return this.fetchJson<VerdictContractRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/verdict_contracts/${cid}`,
      { headers: this.headers() }
    );
  }

  /** PATCH /api/workspaces/{id}/verdict_contracts/{cid} */
  async updateVerdictContract(
    workspaceId: string,
    cid: number,
    req: UpdateVerdictContractRequest
  ): Promise<VerdictContractRecord> {
    return this.fetchJson<VerdictContractRecord>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/verdict_contracts/${cid}`,
      this.patchJson(req)
    );
  }

  /** DELETE /api/workspaces/{id}/verdict_contracts/{cid} */
  async deleteVerdictContract(workspaceId: string, cid: number): Promise<void> {
    await this.fetchJson<void>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/verdict_contracts/${cid}`,
      this.delete()
    );
  }

  /** POST /api/workspaces/{id}/verdict/evaluate (应用层判定,非 evorule 确定性) */
  async evaluateVerdict(
    workspaceId: string,
    req: EvaluateVerdictRequest
  ): Promise<EvaluateVerdictResult> {
    return this.fetchJson<EvaluateVerdictResult>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/verdict/evaluate`,
      this.postJson(req)
    );
  }

  // ------------------------------------------------------------------------
  // === wall-clock 旁路 (阶段 A.4,绝不进审计链哈希) ===
  // ------------------------------------------------------------------------

  /** POST /api/sessions/{id}/clock/record */
  async recordClock(sessionId: number, req: RecordClockRequest): Promise<void> {
    await this.fetchJson<void>(
      `/api/sessions/${sessionId}/clock/record`,
      this.postJson(req)
    );
  }

  /** GET /api/sessions/{id}/clock/lookup?from_version=&to_version= */
  async lookupClock(
    sessionId: number,
    fromVersion?: number,
    toVersion?: number
  ): Promise<VersionClockMapRecord[]> {
    const params = new URLSearchParams();
    if (fromVersion !== undefined) params.set('from_version', String(fromVersion));
    if (toVersion !== undefined) params.set('to_version', String(toVersion));
    const q = params.toString() ? `?${params.toString()}` : '';
    const j = await this.fetchJson<
      VersionClockMapRecord[] | { clocks: VersionClockMapRecord[] }
    >(`/api/sessions/${sessionId}/clock/lookup${q}`, { headers: this.headers() });
    return Array.isArray(j) ? j : j?.clocks ?? [];
  }
}
