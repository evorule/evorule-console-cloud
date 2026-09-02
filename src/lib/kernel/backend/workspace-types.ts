// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console workspace 后端 — 数据契约 + WorkspaceBackend 抽象接口
//
// 依据: 设计文档/00_架构边界原则.md §1.2(server 公共层接口)
//       实施文档_界面升级_v1.0.md §C.1
// 对齐来源: evorule-server core/workspace/src/models.rs(权威模型)
//           evorule-server core/workspace/src/api.rs(权威路由)
//           evorule-server core/workspace/src/rule_translate.rs(转译契约)
//           evorule-server core/workspace/src/verdict_service.rs(判定契约)
//
// 设计原则: 与 ExecutionBackend(types.ts) 并列的第二个后端抽象。
//   - ExecutionBackend: evorule 核心执行态(会话/命令/审计/时间旅行),15 方法
//   - WorkspaceBackend: server 应用层 workspace 能力(规则/沙盒/发布/判定/转译/旁路),~35 方法
//   两者并列,各自独立 context 注入,均不绑定 HTTP/TAuri/WASM 实现。

// ============================================================================
// 1. 状态机枚举 (对齐 models.rs,serde rename_all = "snake_case")
// ============================================================================

/** 规则状态机 (models.rs RuleState) */
export type RuleState = 'draft' | 'candidate' | 'active' | 'blocked' | 'archived';

/** 工作空间状态机 (models.rs WorkspaceState) */
export type WorkspaceState = 'active' | 'archived';

/** 规则版本状态机 (models.rs RuleVersionState) */
export type RuleVersionState = 'current' | 'superseded';

/** 会话-规则绑定状态机 (models.rs SessionBindingState) */
export type SessionBindingState = 'bound' | 'closed';

/** 沙盒状态机 (models.rs SandboxStatus) */
export type SandboxStatus = 'running' | 'closed';

/** 发布队列状态机 (models.rs PublishStatus) */
export type PublishStatus =
  | 'pending'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'cancelled';

/** 成员角色 (models.rs MemberRole) */
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** 发布角色 (models.rs PublishRole, serde rename_all = "snake_case") */
export type PublishRole = 'doctor' | 'department_head' | 'admin';

/**
 * 操作者身份 — 审计归属的真实来源。
 *
 * server 发布链路审计字段 (submitted_by / reviewed_by / operated_by + role)
 * 与沙盒编排字段 (started_by / closed_by / ?requester=) 均由请求体/查询参数
 * 显式携带,后端不派生。调用方应把"当前登录用户 + 其发布角色"通过
 * HttpWorkspaceBackend 构造参数传入,使 server 审计链记录真实操作者。
 *
 * role 仅发布侧三方法 (submitPublish / reviewPublish / emergencyRollback)
 * 需要;未配置时这些方法会抛错 (见 http-workspace-backend.ts)。
 */
export interface ActorIdentity {
	/** 操作者显示名 (写入 server 审计字段,如 'zhang.san') */
	name: string;
	/** 操作者发布角色 (仅发布侧方法必需) */
	role?: PublishRole;
}

// ============================================================================
// 2. Record 类型 (对齐 models.rs 结构体,字段名 snake_case,DateTime→string)
// ============================================================================

/** 工作空间记录 (models.rs WorkspaceRecord) */
export interface WorkspaceRecord {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  state: WorkspaceState;
  description: string | null;
}

/** 工作空间成员记录 (models.rs WorkspaceMemberRecord) */
export interface WorkspaceMemberRecord {
  workspace_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

/** 规则记录 (models.rs RuleRecord) — metadata 为 JSON 字符串(v3 schema 新增列) */
export interface RuleRecord {
  id: string;
  workspace_id: string;
  name: string;
  current_version_id: string | null;
  state: RuleState;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  description: string | null;
  created_by: string;
  /** 扩展元数据 JSON 文本,空时为 "{}" */
  metadata: string;
}

/** 规则版本记录 (models.rs RuleVersionRecord) */
export interface RuleVersionRecord {
  id: string;
  rule_id: string;
  version: number;
  content_hash: string;
  /** 规则内容 JSON 字符串 */
  content: string;
  created_at: string;
  state: RuleVersionState;
  created_by: string;
}

/** 会话记录 (models.rs SessionRecord) */
export interface SessionRecord {
  id: number;
  workspace_id: string;
  rule_id: string | null;
  rule_version_id: string | null;
  created_at: string;
  closed_at: string | null;
  created_by: string;
}

/** 规则-会话绑定记录 (models.rs RuleSessionBinding) */
export interface RuleSessionBinding {
  id: string;
  rule_version_id: string;
  session_id: number;
  workspace_id: string;
  bound_at: string;
  unbound_at: string | null;
  state: SessionBindingState;
}

/** 沙盒会话记录 (models.rs SandboxSession) */
export interface SandboxSession {
  id: number;
  workspace_id: string;
  tcb_session_id: number | null;
  parent_session_id: number;
  draft_ruleset_hash: string | null;
  test_dataset_id: number;
  status: SandboxStatus;
  started_at: string;
  closed_at: string | null;
  started_by: string;
  export_path: string | null;
}

/** 测试数据集记录 (models.rs TestDatasetRecord) */
export interface TestDatasetRecord {
  id: number;
  name: string;
  workspace_id: string | null;
  /** 测试 case 列表 JSON 数组字符串 */
  cases_json: string;
  case_count: number;
  created_at: string;
  created_by: string;
  description: string | null;
}

/** 发布队列记录 (models.rs PublishQueueItem) */
export interface PublishQueueItem {
  id: number;
  workspace_id: string;
  /** 待发布规则集 JSON 数组字符串 */
  final_candidate_rules: string;
  ruleset_hash: string;
  test_report_sandbox_id: number | null;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  published_version: number | null;
  published_at: string | null;
  status: PublishStatus;
  description: string | null;
}

/** 生产状态记录 (models.rs ProductionStateRecord,单行表 id=1) */
export interface ProductionStateRecord {
  id: number;
  current_session_id: number | null;
  ruleset_version: number;
  ruleset_hash: string | null;
  last_operated_by: string | null;
  updated_at: string;
}

/** 生产审计记录 (models.rs ProductionAuditRecord) */
export interface ProductionAuditRecord {
  id: number;
  event_type: string;
  ruleset_version: number;
  previous_version: number | null;
  ruleset_hash: string;
  tcb_session_id: number;
  source_workspace_ids: string;
  operated_by: string;
  operated_at: string;
  reason: string | null;
  test_report_paths: string | null;
  ruleset_snapshot: string | null;
}

/** 判定契约记录 (models.rs VerdictContractRecord) — 阶段 A.1 新增 */
export interface VerdictContractRecord {
  id: number;
  workspace_id: string;
  name: string;
  version: number;
  /** 条件集合 JSON 文本: [{field, op, value, verdict}] */
  rules_json: string;
  is_default: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** 版本↔墙钟 旁路映射 (models.rs VersionClockMapRecord) — 阶段 A.1 新增,不进审计链哈希 */
export interface VersionClockMapRecord {
  id: number;
  session_id: number;
  version: number;
  wall_clock: string;
  source: string;
}

// ============================================================================
// 3. 请求/响应 DTO (对齐 models.rs API DTO + rule_translate.rs + verdict_service.rs)
// ============================================================================

/** 创建工作空间请求 */
export interface CreateWorkspaceRequest {
  name: string;
  owner_id: string;
  description?: string;
}

/** 更新工作空间请求 */
export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
}

/** 添加成员请求 */
export interface AddMemberRequest {
  user_id: string;
  role: string;
}

/** 创建规则请求 */
export interface CreateRuleRequest {
  name: string;
  /** 初始内容 JSON 字符串 */
  content: string;
  created_by: string;
  description?: string;
}

/** 更新规则内容请求 (仅 Draft 状态允许) */
export interface UpdateRuleContentRequest {
  content: string;
  updated_by: string;
}

/** 创建会话请求 */
export interface CreateSessionRequest {
  rule_id?: string;
  rule_version_id?: string;
  created_by: string;
}

/** 启动沙盒测试请求 */
export interface StartSandboxRequest {
  rule_version_ids: string[];
  test_dataset_id: number;
  parent_version?: number;
}

/** 启动沙盒测试响应 */
export interface StartSandboxResponse {
  sandbox_id: number;
  tcb_session_id: number;
  draft_ruleset_hash: string;
  test_case_count: number;
}

/** 创建测试数据集请求 */
export interface CreateTestDatasetRequest {
  name: string;
  cases_json: string;
  created_by: string;
  workspace_id?: string;
  description?: string;
}

/** 提交发布请求 */
export interface SubmitPublishRequest {
  workspace_id: string;
  rule_version_ids: string[];
  test_report_sandbox_id?: number;
  description?: string;
}

/** 审批请求 */
export interface ReviewPublishRequest {
  /** 'approved' | 'rejected' */
  decision: string;
  comment?: string;
}

/** 紧急回滚请求 */
export interface RollbackRequest {
  target_version: number;
  reason: string;
}

// --- 规则转译 (rule_translate.rs) ---

/** 校验错误 (对齐 TS ruleValidator G1-G7) */
export interface ValidationError {
  gate: string;
  message: string;
  path?: string;
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** to_transform 请求: condition + action_set → transform */
export interface TranslateToTransformRequest {
  /** condition 列表: [{field, op, value}] */
  condition: unknown[];
  /** action_set 列表: [{attr, operation, value}] */
  action_set: unknown[];
  metadata?: unknown;
}

/** to_transform 响应 */
export interface TranslateToTransformResponse {
  transform: unknown[];
  g1_g7_pass: boolean;
  warnings: string[];
}

/** to_conditional 请求: transform → condition + action_set */
export interface TranslateToConditionalRequest {
  transform: unknown[];
}

/** to_conditional 响应 (lossy=true 时 lost_items 列出无法回译项) */
export interface TranslateToConditionalResponse {
  condition: unknown[];
  action_set: unknown[];
  lossy: boolean;
  lost_items: string[];
}

// --- 判定契约 (verdict_service.rs) ---

/** 创建判定契约请求 */
export interface CreateVerdictContractRequest {
  name: string;
  /** 条件集合 JSON 文本: [{field, op, value, verdict}] */
  rules_json: string;
  is_default?: boolean;
  created_by: string;
}

/** 更新判定契约请求 (PATCH,全字段可选) */
export interface UpdateVerdictContractRequest {
  name?: string;
  rules_json?: string;
  is_default?: boolean;
}

/** evaluate 请求 */
export interface EvaluateVerdictRequest {
  payload: unknown;
  contract_id?: number;
}

/** evaluate 响应 (应用层判定,非 evorule 确定性) */
export interface EvaluateVerdictResult {
  verdict: string;
  matched_rule_id?: string;
  source_workspace_ids: string[];
  note: string;
}

// --- wall-clock 旁路 (verdict_service.rs) ---

/** clock/record 请求 */
export interface RecordClockRequest {
  version: number;
  /** RFC3339 墙钟时间 */
  wall_clock: string;
  source?: string;
}

// --- 快照包导入 (evorule-server /api/bundles/*,治理→执行域部署通道) ---

/** POST /api/bundles/import 201 响应(对齐 evorule-server api/bundles.rs ImportResponse) */
export interface BundleImportResult {
  imported: boolean;
  bundle_id: string;
  dataset_id: string;
  activated_version: string;
  entry_count: number;
  /** 硬失败原则:校验链已拦截缺失服务,成功导入即空数组 */
  missing_services: string[];
}

/** POST /api/bundles/import/dry-run 200 响应(校验链全跑,不落盘不 reload) */
export interface BundleDryRunResult {
  valid: boolean;
  bundle_id: string;
  dataset_id: string;
  source_version: string;
  selection_mode: string;
  resolved_version: string | null;
  entry_count: number;
  verdict: string;
  missing_services: string[];
}

/** GET /api/bundles/active 单项(rules/bundles manifest 精简视图) */
export interface ActiveBundleInfo {
  bundle_id: string;
  dataset_id: string;
  source_version: string;
  selection_mode: string;
  resolved_version: string | null;
  effective_from: string | null;
  content_hash: string;
  entry_count: number;
}

// ============================================================================
// 4. WorkspaceBackend 抽象接口 (~35 方法,对齐 api.rs build_workspace_router 全部路由)
// ============================================================================

/**
 * evorule-console 的 workspace 后端抽象接口。
 *
 * 与 ExecutionBackend 并列,封装 server 应用层 workspace 能力。
 * - 大众版: HttpWorkspaceBackend (调 evorule-server HTTP)
 * - 高级版: 可替换为 EmbeddedWorkspaceBackend (Tauri + Rust)
 *
 * 方法分组(对齐 api.rs 路由表):
 *   - Workspace 管理(5): listWorkspaces/createWorkspace/getWorkspace/updateWorkspace/archiveWorkspace
 *   - 成员(1): listMembers
 *   - 规则(8): listRules/createRule/getRule/updateRuleContent/activateRule/submitRule/blockRule/archiveRule
 *   - 规则版本(2): listRuleVersions/getRuleVersion (阶段 D 新增,暴露规则内容)
 *   - 会话(2): createWorkspaceSession/listWorkspaceSessions
 *   - 沙盒(4): startSandbox/listSandboxes/getSandbox/closeSandbox
 *   - 测试数据集(1): listTestDatasets
 *   - 发布队列(4): listPublishQueue/submitPublish/reviewPublish/emergencyRollback
 *   - 生产状态(2): getProductionState/listProductionAudit
 *   - 规则转译(2): translateToTransform/translateToConditional
 *   - 判定契约(6): listVerdictContracts/createVerdictContract/getVerdictContract/updateVerdictContract/deleteVerdictContract/evaluateVerdict
 *   - wall-clock 旁路(2): recordClock/lookupClock
 *   - 快照包导入(3): importBundle/dryRunImportBundle/listActiveBundles (evorule-server /api/bundles/*)
 */
export interface WorkspaceBackend {
  // === Workspace 管理 ===
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  createWorkspace(req: CreateWorkspaceRequest): Promise<WorkspaceRecord>;
  getWorkspace(id: string): Promise<WorkspaceRecord>;
  updateWorkspace(id: string, req: UpdateWorkspaceRequest): Promise<WorkspaceRecord>;
  archiveWorkspace(id: string): Promise<void>;

  // === 成员 ===
  listMembers(id: string): Promise<WorkspaceMemberRecord[]>;

  // === 规则管理 ===
  listRules(workspaceId: string): Promise<RuleRecord[]>;
  createRule(workspaceId: string, req: CreateRuleRequest): Promise<RuleRecord>;
  getRule(workspaceId: string, ruleId: string): Promise<RuleRecord>;
  updateRuleContent(
    workspaceId: string,
    ruleId: string,
    req: UpdateRuleContentRequest
  ): Promise<RuleRecord>;
  activateRule(workspaceId: string, ruleId: string): Promise<RuleRecord>;
  submitRule(workspaceId: string, ruleId: string): Promise<RuleRecord>;
  blockRule(workspaceId: string, ruleId: string): Promise<RuleRecord>;
  archiveRule(workspaceId: string, ruleId: string): Promise<RuleRecord>;

  // === 规则版本查询 (阶段 D 新增, RuleRecord 不含 content, content 在 rule_versions 表) ===
  /** GET /api/workspaces/{id}/rules/{rule_id}/versions — 列出规则全部版本(含 content, 按 version 降序) */
  listRuleVersions(workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]>;
  /** GET /api/workspaces/{id}/rules/{rule_id}/versions/{version_id} — 获取规则指定版本(含 content) */
  getRuleVersion(
    workspaceId: string,
    ruleId: string,
    versionId: string
  ): Promise<RuleVersionRecord>;

  // === 会话管理 (workspace 级,与 ExecutionBackend 的 session 运行态端点互补) ===
  createWorkspaceSession(
    workspaceId: string,
    req: CreateSessionRequest
  ): Promise<SessionRecord>;
  listWorkspaceSessions(workspaceId: string): Promise<SessionRecord[]>;

  // === 沙盒编排 ===
  startSandbox(workspaceId: string, req: StartSandboxRequest): Promise<StartSandboxResponse>;
  listSandboxes(workspaceId: string): Promise<SandboxSession[]>;
  getSandbox(workspaceId: string, sandboxId: number): Promise<SandboxSession>;
  closeSandbox(workspaceId: string, sandboxId: number): Promise<void>;

  // === 测试数据集 ===
  listTestDatasets(workspaceId: string): Promise<TestDatasetRecord[]>;

  // === 发布队列 ===
  listPublishQueue(status?: string): Promise<PublishQueueItem[]>;
  submitPublish(req: SubmitPublishRequest): Promise<PublishQueueItem>;
  reviewPublish(queueId: number, req: ReviewPublishRequest): Promise<PublishQueueItem>;
  emergencyRollback(req: RollbackRequest): Promise<void>;

  // === 生产状态 + 审计 ===
  getProductionState(): Promise<ProductionStateRecord>;
  listProductionAudit(): Promise<ProductionAuditRecord[]>;

  // === 规则转译 (纯函数,阶段 A.2) ===
  translateToTransform(
    req: TranslateToTransformRequest
  ): Promise<TranslateToTransformResponse>;
  translateToConditional(
    req: TranslateToConditionalRequest
  ): Promise<TranslateToConditionalResponse>;

  // === 判定契约 (阶段 A.3,应用层判定非 evorule 确定性) ===
  listVerdictContracts(workspaceId: string): Promise<VerdictContractRecord[]>;
  createVerdictContract(
    workspaceId: string,
    req: CreateVerdictContractRequest
  ): Promise<VerdictContractRecord>;
  getVerdictContract(workspaceId: string, cid: number): Promise<VerdictContractRecord>;
  updateVerdictContract(
    workspaceId: string,
    cid: number,
    req: UpdateVerdictContractRequest
  ): Promise<VerdictContractRecord>;
  deleteVerdictContract(workspaceId: string, cid: number): Promise<void>;
  evaluateVerdict(
    workspaceId: string,
    req: EvaluateVerdictRequest
  ): Promise<EvaluateVerdictResult>;

  // === wall-clock 旁路 (阶段 A.4,绝不进审计链哈希) ===
  recordClock(sessionId: number, req: RecordClockRequest): Promise<void>;
  lookupClock(
    sessionId: number,
    fromVersion?: number,
    toVersion?: number
  ): Promise<VersionClockMapRecord[]>;

  // === 快照包导入 (治理→执行域部署通道,evorule-server /api/bundles/*) ===
  /** POST /api/bundles/import — 6 项校验+原子落盘+reload;失败 400 显式错误 */
  importBundle(bundle: unknown): Promise<BundleImportResult>;
  /** POST /api/bundles/import/dry-run — 校验链全跑,不落盘不 reload */
  dryRunImportBundle(bundle: unknown): Promise<BundleDryRunResult>;
  /** GET /api/bundles/active — 当前激活 bundle 列表(部署徽标数据源) */
  listActiveBundles(): Promise<ActiveBundleInfo[]>;
}
