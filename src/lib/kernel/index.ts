// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// kernel/ — evorule-console 内核快照（v0.1.1 依赖闭包子集，2026-08-27 内联）
//
// 来源与边界：
//   - 本目录是从 evorule-console（gitee.com/evo-rule-lab/evorule-console）
//     复制而来的**快照**，仅包含本仓实际使用的依赖闭包。
//   - 快照后本仓不再依赖 @evorule/console npm 包，独立演进。
//     内核仓后续修复不会自动同步到本目录；反向亦然。
//   - 导出面对齐内核 src/lib/index.ts，仅省略未纳入快照的模块
//     （RuleLibraryView、HttpWorkspaceBackend、verdict store 等）。

// ============================================================================
// 1. 执行后端抽象
// ============================================================================
export type {
  SessionId,
  ReactorState,
  SessionState,
  HistoricalState,
  SessionAudit,
  VerifyResult,
  Fact,
  FactRecord,
  DiffResult,
  CausalChain,
  CausalEntry,
  CommandResult,
  InterruptResult,
  AutoVerifyStatus,
  AutoVerifyConfigResult,
  StepInfo,
  SessionSnapshot,
  DebugPhaseInfo,
  DebugQueueInfo,
  DebugPendingIoInfo,
  PendingIoCountInfo,
  CausalDepthInfo,
  AuditImportResult,
  ReapResult,
  PayloadUpdateResult,
  SharedFactEntry,
  SharedFactsVersionInfo,
  PermissionState,
  PermissionEffect,
  PermissionSubjectType,
  PermissionResourceType,
  PermissionSubject,
  PermissionResource,
  PermissionEntryRecord,
  PermissionListResult,
  PermissionWriteResult,
  PermissionVersionResult,
  PermissionEvaluateRequest,
  PermissionEvaluateResult,
  ExecutionBackend
} from './backend/types';

export { HttpBackend, HttpBackendError } from './backend/http-backend';
export {
  provideBackend,
  useBackend,
  useBackendOrNull
} from './backend/backend-context';

// ============================================================================
// 1.C Workspace 后端实现与注入（对齐 evorule-server core/workspace 路由）
// ============================================================================
export { HttpWorkspaceBackend, HttpWorkspaceBackendError } from './backend/http-workspace-backend';
export {
  provideWorkspaceBackend,
  useWorkspaceBackend,
  useWorkspaceBackendOrNull
} from './backend/workspace-context';
export type { WorkspaceBackend } from './backend/workspace-types';

// ============================================================================
// 1.B Workspace 后端抽象(仅类型;实现见上方 1.C 与本仓 CloudWorkspaceBackend)
// ============================================================================
export type {
  WorkspaceRecord,
  WorkspaceMemberRecord,
  RuleRecord,
  RuleVersionRecord,
  SessionRecord,
  RuleSessionBinding,
  SandboxSession,
  TestDatasetRecord,
  PublishQueueItem,
  ProductionStateRecord,
  ProductionAuditRecord,
  VerdictContractRecord,
  VersionClockMapRecord,
  WorkspaceState,
  RuleVersionState,
  SessionBindingState,
  SandboxStatus,
  PublishStatus,
  MemberRole,
  PublishRole,
  ActorIdentity,
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
  ValidationCheckItem,
  ValidateRulesResult,
  SandboxTestReport,
  ExecutionRulesResult
} from './backend/workspace-types';

// ============================================================================
// 2. AssistantProvider 扩展槽（默认 null，本仓注入 CloudLlmAssistant）
// ============================================================================
export type { AssistantProvider } from './assistant/types';
export { provideAssistant, useAssistantOrNull } from './assistant/assistant-context';

// ============================================================================
// 3. 状态 stores
// ============================================================================
export {
  rules,
  selectedRuleId,
  selectedRule,
  migrationNeeded,
  isOffline,
  lastError as rulesError,
  refreshRules,
  selectRule,
  selectRuleLocal,
  loadRuleContent,
  addRule,
  updateRule,
  duplicateRule,
  deleteRule,
  importRule,
  exportRule,
  checkMigrationNeeded,
  migrateLegacyRules,
  getAllRules,
  getSelectedRuleId,
  isRuleReadonly,
  resetRulesStore
} from './stores/rules';
export type { Rule, RuleState } from './stores/rules';

export {
  workspaces,
  currentWorkspace,
  currentWorkspaceId,
  workspaceSessions,
  workspaceSandboxes,
  publishQueue,
  productionState,
  isLoading as isWorkspaceLoading,
  lastError as workspaceError,
  refreshWorkspaces,
  ensureDefaultWorkspace,
  seedBuiltinRules,
  selectWorkspace,
  refreshPublishQueue,
  refreshProductionState,
  refreshSandboxes,
  resetWorkspaceStore
} from './stores/workspace';

export {
  sessions,
  currentSessionId,
  currentWorkspaceSession,
  sessionState,
  commandHistory,
  isLoading as isSessionLoading,
  lastError as sessionError,
  reactorPhase,
  reactorVersion,
  reactorCausalDepth,
  reactorPendingIO,
  refreshSessions,
  createSession,
  createWorkspaceSession,
  closeSession,
  selectSession,
  refreshSessionState,
  submitCommand,
  subscribeSessionSwitched,
  resetSessionStore
} from './stores/session';
export type { CommandHistoryEntry } from './stores/session';

export {
  auditData,
  verifyResult,
  causalSelection,
  auditLoading,
  auditError,
  refreshAudit,
  verifyAuditChain,
  fetchCausalChain,
  clearCausalSelection,
  resetAuditStore
} from './stores/audit';
export type { CausalSelection } from './stores/audit';

export {
  currentView,
  setView,
  restoreView,
  getViewMeta,
  VIEW_LIST
} from './stores/view';
export type { ViewId, ViewMeta } from './stores/view';

// ============================================================================
// 4. 视图组件（快照子集：执行台 / 状态 / 时间旅行 + 通用徽章）
// ============================================================================
export { default as RuleLibraryView } from './views/RuleLibrary/RuleLibrary.svelte';
export { default as ExecutionPadView } from './views/ExecutionPad/ExecutionPad.svelte';
export { default as StateView } from './views/StateView/StateView.svelte';
export { default as AuditView } from './views/AuditView/AuditView.svelte';
export { default as TimeTravelView } from './views/TimeTravel/TimeTravel.svelte';
export { default as VerdictBadge } from './components/VerdictBadge.svelte';

// ============================================================================
// 5. L_console 预校验（G1-G7，与核心仓 TCB 对齐）
// ============================================================================
export { RuleValidator } from './validators/ruleValidator';
export type { ValidationError, ValidationResult } from './validators/ruleValidator';

// ============================================================================
// 6. 版本信息（内核快照版本，非本仓版本）
// ============================================================================
export const CONSOLE_VERSION = '0.2.0';
