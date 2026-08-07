# T5 执行计划:协作 + 导入导出 + 任务流 + UX 收尾

## 摘要

T5 是 evorule-console-cloud P0 的最后一个梯队,覆盖 P08(5 角色协作)+ P09(导入导出基础设施)+ P10(任务流 + MockBackend + 在线 demo)+ P11(UX 缺口收尾)。T1-T4 已完成并通过验证(407 vitest 通过、svelte-check 0 error、build 成功)。

**目标**:交付可在线 demo 的完整 P0 产品,最终跑通 P0 总验收 11 步功能流(建库→加规则→整理→组合数据集→导入运行→看运行时→看指标→处理运行时→查看结果→导出→回放审计)。

## 当前状态分析

经 Explore agent 核实(2026-08-07),T5 全部代码从零开始——stores/ 目录仅有 T1-T4 的 36 个文件,以下 22+ 个 T5 候选文件**全部缺失**:

- P08:auth/permission-matrix/workspace-members/publish-queue/production-audit/comments/notifications/edit-lock/activity-log(9 store)+ 9 组件 + 4 路由
- P09:import-export-types/format-converter/rule-import-export/dataset-import-export/form-import-export/library-schema-import/marketplace/ruleset-types/ruleset-import/import-snapshot(10 store)+ 8 组件 + 2 路由 + 1 数据文件
- P10:task-flow-types/task-flow/task-history-types/task-history/guided-tasks/view-mode/guided-task-progress(7 store)+ 3 数据文件 + mock-backend + 4 组件 + CI workflow + README 决策者章节
- P11:GuidedHint/OnboardingBanner/DecisionMakerView(3 组件)+ 贯穿修改

## 架构决策(已与用户确认,不再更改)

1. **P08 后端策略 = localStorage mock**:所有 P08 数据(auth/users/members/publish-queue/comments/notifications/edit-lock/activity-log)全部 mock + localStorage,不连真实 evorule-server。设计文档 P08 §6 的 fetch-based 实现需**改写为 localStorage-based**(保留接口签名,替换内部实现)。
2. **GitHub Pages = 现在建 workflow**:`.github/workflows/deploy-demo.yml` main push 触发 → adapter-static 构建 → Pages 部署。
3. **推进方式 = 4 子阶段顺序实施**:T5a P08 → T5b P09 → T5c P10 → T5d P11。每子阶段独立验证(`npm run check && npx vitest run && npm run build`),通过后再进下一个。
4. **MockBackend 复用 export-mock-data.ts 模式**:vi.fn + 真实 ReactorState 契约(phase/causal_depth/current_step/pending_io_count/structural_invariant_violations)+ BLAKE3 审计链。
5. **P09 复用 P07 渲染器**:format-converter.ts 在 export-renderers.ts(JSON/CSV/PDF/XML 4 格式)上扩展 +YAML +Markdown,不修改 P07 原文件。

## 复用约定(沿用 T1-T4 已验证模式)

- **Store 模式**:`writable` + `$app/environment` browser 守卫 + localStorage 持久化。STORAGE_KEY 命名 `evorule-console-cloud:<name>`。参考 `src/lib/stores/session.ts`、`src/lib/stores/business-terms.ts`、`src/lib/stores/dataset.ts`。
- **组件模式**:Svelte 5 runes(`$state`/`$derived`/`$props`/`$effect`)+ store 自动订阅(`$store`)。参考 `ExportDialog.svelte`、`MonitorDashboard.svelte`。a11y:label 关联控件、交互元素用 `<button>`。
- **Backend 注入**:`provideBackend`/`useBackend`(`@evorule/console`)。MockBackend 实现 `ExecutionBackend` 15 方法,按 `cloud-http-backend.ts:147` 注释的契约。
- **路由守卫**:`src/routes/+layout.ts` 的 login guard 模式(T4 已为 /export 加过)。
- **测试**:`vi.fn` mock backend + `beforeEach` 重置 store(参考 `export-store.test.ts`、`export-mock-data.ts`)。
- **内核不修改**:包装优于继承,业务化层全在 console-cloud。

---

## T5a:P08 协作工作流(9 store + 9 组件 + 4 路由 + 3 修改)

**设计依据**:`docs/P08_COLLAB_WORKFLOW_DESIGN.md`(§5 权限矩阵 / §6 Store / §7 组件 / §12 实施路径)

### 新增 Store(9 个,`src/lib/stores/`)

#### 1. `permission-matrix.ts`(纯数据 + 谓词,无 localStorage)
```typescript
export type PermissionAction =
  | 'view_monitor' | 'view_audit_chain' | 'intervene_runtime' | 'rollback_ruleset'
  | 'create_workspace' | 'edit_draft' | 'review_in_workspace' | 'submit_to_publish'
  | 'start_sandbox' | 'approve_publish' | 'view_publish_queue' | 'view_test_report';
export type Role = 'user' | 'lead' | 'it' | 'exec' | 'auditor';
export const ROLE_PERMISSIONS: Record<Role, Set<PermissionAction>>; // §5.2 矩阵
export function checkPermission(role: Role, action: PermissionAction): boolean;
export const ROLE_LABELS: Record<Role, string>; // 普通用户/科室主任/信息科/院领导/审计员
```

#### 2. `auth.ts`(扩展 session.ts,localStorage)
```typescript
export interface User {
  id: string; username: string; displayName: string;
  role: Role; department?: string; status: 'active' | 'disabled';
}
export const currentUser = writable<User | null>(loadUser());
export const isLoggedIn = derived(currentUser, ($u) => $u !== null);
// mock login:5 预置用户(admin/lead/doctor/it/auditor),按 username 匹配,不校验密码(P0 mock)
export function loginAs(username: string): { success: boolean; error?: string };
export function logout(): void;
export function can(action: PermissionAction): boolean; // 调 checkPermission
```
**与 session.ts 协同**:loginAs 同步调 `session.login(user.id, user.displayName)`,logout 调 `session.logout()`。保留 session.ts 的 loggedIn/userId/username 字段作为 HomeRouter 决策依据。

#### 3. `workspace-members.ts`(localStorage)
```typescript
export type WorkspaceRole = 'author' | 'reviewer' | 'observer';
export interface WorkspaceMember { userId: string; username: string; displayName: string; role: WorkspaceRole; addedAt: string; addedBy: string; }
export const workspaceMembersStore = writable<WorkspaceMember[]>(loadMembers());
export function addMember(m: Omit<WorkspaceMember, 'addedAt'>): void;
export function updateMemberRole(userId: string, role: WorkspaceRole): void;
export function removeMember(userId: string): void;
```

#### 4. `publish-queue.ts`(localStorage,状态机)
```typescript
export type PublishStatus = 'draft' | 'submitted' | 'reviewing' | 'approved' | 'rejected' | 'published' | 'rolled_back';
export interface PublishRequest {
  id: string; rulesetVersion: number; submittedBy: string; submittedAt: string;
  status: PublishStatus; reviewedBy?: string; reviewedAt?: string; reviewComment?: string;
  publishedAt?: string; emergencyRollbackAt?: string;
}
export const publishQueueStore = writable<PublishRequest[]>(loadQueue());
export function submitPublish(rulesetVersion: number, submittedBy: string): string;
export function approvePublish(id: string, reviewedBy: string, comment: string): void;
export function rejectPublish(id: string, reviewedBy: string, comment: string): void;
export function emergencyRollback(id: string, by: string): void;
```

#### 5. `production-audit.ts`(mock 数据,对齐第四梯队 production_audit 表)
```typescript
export interface VersionHistoryEntry {
  version: number; rulesetHash: string; publishedAt: string; publishedBy: string;
  publishRequestId: string; rollbackOf?: number; notes: string;
}
export const productionAuditStore = writable<VersionHistoryEntry[]>(loadHistory());
export function appendVersion(entry: Omit<VersionHistoryEntry, 'version'>): void;
```

#### 6. `comments.ts`(localStorage)
```typescript
export interface Comment {
  id: string; targetId: string; targetType: 'rule' | 'workspace' | 'publish_request';
  authorId: string; authorName: string; content: string; mentions: string[];
  createdAt: string; resolved: boolean;
}
export const commentsStore = writable<Comment[]>(loadComments());
export function addComment(c: Omit<Comment, 'id' | 'createdAt' | 'mentions'>): string; // 自动解析 @提及
export function resolveComment(id: string): void;
export function getCommentsByTarget(targetId: string): Comment[];
```

#### 7. `notifications.ts`(localStorage)
```typescript
export interface Notification {
  id: string; type: 'mention' | 'review_request' | 'publish_status' | 'system';
  title: string; body: string; createdAt: string; read: boolean; link?: string;
}
export const notificationsStore = writable<Notification[]>(loadNotifications());
export function pushNotification(n: Omit<Notification, 'id' | 'createdAt' | 'read'>): string;
export function markAsRead(id: string): void;
export function markAllAsRead(): void;
export const unreadCount = derived(notificationsStore, ($n) => $n.filter((x) => !x.read).length);
```

#### 8. `edit-lock.ts`(localStorage,模拟悲观锁)
```typescript
export interface EditLock { ruleId: string; lockedBy: string; lockedAt: number; expiresAt: number; }
export const editLocksStore = writable<EditLock[]>(loadLocks());
export function acquireLock(ruleId: string, userId: string): { success: boolean; heldBy?: string };
export function releaseLock(ruleId: string, userId: string): void;
export function isLocked(ruleId: string): EditLock | null;
export function heartbeat(ruleId: string, userId: string): void; // 续期 5 分钟
// 过期锁自动清理(>30 分钟)
```

#### 9. `activity-log.ts`(localStorage,append-only,限 100 条)
```typescript
export interface ActivityEntry {
  id: string; userId: string; username: string; action: string; target?: string;
  detail?: string; timestamp: string;
}
export const activityLogStore = writable<ActivityEntry[]>(loadLog());
export function logActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void;
// 超过 100 条时 FIFO 移除最早
```

### 新增组件(9 个,`src/lib/views/`)

- `Auth/LoginForm.svelte` — 5 预置用户卡片选择(mock 登录,不输密码)+ 调 `loginAs()`
- `Auth/UserMenu.svelte` — 顶部用户头像/角色徽标 + 登出 + 切换 demo
- `Notifications/NotificationBell.svelte` — 铃铛 + 未读徽标 + 下拉通知列表 + 标记已读
- `PublishQueue/PublishQueueList.svelte` — 队列列表 + 状态徽标 + approve/reject 按钮(权限守卫)
- `VersionHistory/VersionTimeline.svelte` — 版本时间线 + 回滚入口
- `Collab/WorkspaceSwitcher.svelte` — Workspace 切换下拉(占位,P0 单 workspace)
- `Collab/CommentThread.svelte` — 评论线程 + @提及高亮 + resolve
- `Collab/ReviewActions.svelte` — 审核动作栏(approve/reject/request_changes)
- `ActivityLog/ActivityLogTable.svelte` — 操作日志表格(分页 20 条)

### 新增路由(4 个)
- `src/routes/login/+page.svelte` → LoginForm
- `src/routes/publish-queue/+page.svelte` → PublishQueueList(lead/it/exec 守卫)
- `src/routes/version-history/+page.svelte` → VersionTimeline
- `src/routes/audit/+page.svelte` → P06 BusinessAuditView 入口(auditor/it/exec 守卫)

### 修改文件(3 个)
- `src/routes/+layout.svelte` — topbar 加 NotificationBell + UserMenu + 登录入口按钮(未登录时显示)
- `src/routes/+layout.ts` — 加 /publish-queue、/version-history、/audit 角色守卫(can(action) 检查)
- `src/lib/views/Home/Monitor/InterventionBar.svelte` — 13 按钮加 `can('intervene_runtime')` / `can('rollback_ruleset')` 守卫(无权限时 disabled + tooltip)

### 测试(`src/lib/stores/__tests__/`,4 个新测试文件)
- `permission-matrix.test.ts` — 5 角色 × 12 动作全矩阵 + checkPermission 谓词
- `publish-queue.test.ts` — 状态机全路径:draft→submitted→reviewing→approved→published / rejected / rolled_back
- `edit-lock.test.ts` — acquire/release/heartbeat/过期清理/冲突场景
- `comments.test.ts` — @提及解析 + resolve + 按 target 查询

### T5a 验证
```bash
npm run check && npx vitest run && npm run build
```
- svelte-check 0 error
- 所有现有 + 新增测试通过
- build 产出可静态部署

---

## T5b:P09 导入导出基础设施(10 store + 8 组件 + 2 路由 + 1 数据)

**设计依据**:`docs/P09_IMPORT_EXPORT_INFRA_DESIGN.md`(§3 决策 / §5 格式转换层 / §6 4 类对象 / §7 市场 / §9 组件)

### 关键复用:抽取格式转换层
`format-converter.ts` 在 `export-renderers.ts`(JSON/CSV/PDF/XML 4 格式)基础上**扩展 +YAML +Markdown**。**不修改 export-renderers.ts**,format-converter 作为薄包装层调用其渲染函数 + 新增 2 个渲染器。

### 新增 Store(10 个,`src/lib/stores/`)

#### 1. `import-export-types.ts`(类型定义,无 store)
```typescript
export type ExportFormat6 = 'json' | 'csv' | 'xml' | 'yaml' | 'markdown' | 'pdf';
export interface UniversalExportPackage {
  meta: { format: ExportFormat6; exportedAt: string; exportedBy: string; version: string };
  content: unknown; // 已渲染的中间态
  integrity?: { algorithm: 'BLAKE3'; content_hash: string; verified: boolean };
}
export interface BatchExportPackage {
  manifest: { files: { name: string; type: string; hash: string }[]; exportedAt: string };
  files: { name: string; blob: Blob }[];
}
export type ConflictStrategy = 'skip' | 'overwrite' | 'rename' | 'merge';
export interface ImportConflict { localId: string; remoteId: string; field: string; localValue: unknown; remoteValue: unknown; }
export interface ImportSnapshot { id: string; createdAt: string; reason: string; storeKeys: string[]; data: Record<string, unknown>; }
```

#### 2. `format-converter.ts`(6 格式互转)
```typescript
export function convert(content: unknown, format: ExportFormat6): string;
// json: JSON.stringify; csv/xml: 复用 export-renderers; pdf: HTML 降级;
// yaml: 简单实现(无依赖,手写 KV/列表缩进);markdown: 表格 + 列表
export function detectFormat(filename: string, content: string): ExportFormat6;
export function parse(content: string, format: ExportFormat6): unknown;
```

#### 3. `rule-import-export.ts`(复用内核 rules store)
```typescript
export function exportRules(ruleIds: string[], format: ExportFormat6): Blob;
export function importRules(content: string, format: ExportFormat6, strategy: ConflictStrategy): { imported: number; skipped: number; conflicts: ImportConflict[] };
```

#### 4. `dataset-import-export.ts`(复用 dataset.ts)
```typescript
export function exportDatasets(datasetIds: string[], format: ExportFormat6): Blob;
export function importDatasets(content: string, format: ExportFormat6, strategy: ConflictStrategy): { imported: number; skipped: number; conflicts: ImportConflict[] };
```

#### 5. `form-import-export.ts`(复用 business-form-schema.ts)
```typescript
export function exportFormSchemas(schemaIds: string[], format: ExportFormat6): Blob;
export function importFormSchemas(content: string, format: ExportFormat6, strategy: ConflictStrategy): { imported: number; skipped: number; conflicts: ImportConflict[] };
```

#### 6. `library-schema-import.ts`(复用 business-terms.ts + business-form-schema.ts)
```typescript
export interface LibraryPackage { terms: BusinessTerm[]; schemas: BusinessFormSchema[]; version: string; }
export function exportLibrary(format: ExportFormat6): Blob;
export function importLibrary(content: string, format: ExportFormat6): { termsImported: number; schemasImported: number; };
```

#### 7. `marketplace.ts`(localStorage,builtin + user)
```typescript
export interface MarketTemplate {
  id: string; name: string; description: string; category: 'finance' | 'medical' | 'compliance' | 'general';
  author: string; version: string; content: unknown; type: 'rule' | 'dataset' | 'form' | 'library' | 'ruleset';
  installed: boolean; rating: number; downloads: number;
}
export const marketplaceStore = writable<MarketTemplate[]>(loadTemplates());
export function installTemplate(id: string): void; // 调对应 import 函数
export function searchTemplates(query: string, category?: string): MarketTemplate[];
```

#### 8. `ruleset-types.ts`(类型定义)
```typescript
export interface RulesetPackage {
  meta: { name: string; version: string; industry: string; author: string; description: string; createdAt: string };
  rules: unknown[]; terms?: BusinessTerm[]; schemas?: BusinessFormSchema[];
  datasets?: Dataset[]; integrity: { algorithm: 'BLAKE3'; ruleset_hash: string };
}
```

#### 9. `ruleset-import.ts`(从 ruleset.json 导入)
```typescript
export function parseRuleset(content: string): RulesetPackage;
export function importRuleset(pkg: RulesetPackage, strategy: ConflictStrategy): {
  rulesImported: number; termsImported: number; schemasImported: number; datasetsImported: number; conflicts: ImportConflict[];
};
```

#### 10. `import-snapshot.ts`(localStorage,导入前快照)
```typescript
export function createSnapshot(reason: string): string; // 返回 snapshotId,自动快照指定 storeKeys
export function rollbackSnapshot(snapshotId: string): void;
export function listSnapshots(): ImportSnapshot[];
// storeKeys:['rules','datasets','business-terms','business-form-schemas']
```

### 新增数据(`src/lib/data/`)
- `market-template-samples.ts` — 6 builtin 市场模板:finance-starter / medical-triage / compliance-djbh / general-empty / finance-risk-control / medical-drug-gate

### 新增组件(8 个,`src/lib/views/ImportExport/` + `Marketplace/`)
- `ImportExport/ImportExportPage.svelte` — Tab 容器(Import / Export / Marketplace)
- `ImportExport/ImportTab.svelte` — 文件上传 + 格式选择 + 冲突策略 + 预览 + 快照提示
- `ImportExport/ExportTab.svelte` — 对象选择(4 类)+ 格式选择(6 种)+ 批量 ZIP
- `ImportExport/ConflictResolver.svelte` — 冲突列表 + 4 策略单选 + apply
- `ImportExport/BatchExportDialog.svelte` — ZIP + manifest.json 生成
- `Marketplace/MarketplaceTab.svelte` — 模板网格 + 搜索 + 分类筛选 + 安装
- `Marketplace/MarketplaceCard.svelte` — 单模板卡片(标题/描述/评分/安装按钮)
- `Marketplace/RulesetImporter.svelte` — ruleset.json 上传 + 解析预览 + 导入

### 新增路由(2 个)
- `src/routes/import-export/+page.svelte` → ImportExportPage
- `src/routes/marketplace/+page.svelte` → MarketplaceTab

### 修改文件
- `src/routes/+layout.svelte` — topbar 加「导入导出」tab(🌐 图标)+「市场」tab(🏪 图标),需登录守卫
- `src/routes/+layout.ts` — 加 /import-export、/marketplace login 守卫

### 测试(`src/lib/stores/__tests__/`,4 个新测试文件)
- `format-converter.test.ts` — 6 格式互转矩阵(JSON→CSV→XML→YAML→Markdown→JSON round-trip)
- `import-snapshot.test.ts` — 快照创建 + 回滚 + 多 store 恢复
- `rule-import-export.test.ts` — 4 冲突策略(skip/overwrite/rename/merge)+ BLAKE3 完整性
- `ruleset-import.test.ts` — ruleset.json 解析 + 多对象导入 + 冲突汇总

### T5b 验证
```bash
npm run check && npx vitest run && npm run build
```

---

## T5c:P10 任务流 + MockBackend + 在线 demo(7 store + 3 数据 + 1 backend + 4 组件 + CI + README)

**设计依据**:`docs/P10_TASKFLOW_DEMO_DESIGN.md`(§3 决策 / §4 数据模型 / §5 Store / §6 组件树 / §8 代码示例)

### 新增 Store(7 个,`src/lib/stores/`)

#### 1. `task-flow-types.ts`(类型定义)
```typescript
export interface TaskStepDef { id: string; title: string; description: string; viewId?: string; action?: string; }
export interface TaskFlowDef { id: string; name: string; description: string; category: 'build' | 'run' | 'audit' | 'compliance'; steps: TaskStepDef[]; }
export interface TaskContext { [key: string]: unknown; } // 跨步骤保留
export interface TaskFlowInstance {
  id: string; flowId: string; currentStep: number; status: 'in_progress' | 'completed' | 'cancelled';
  context: TaskContext; startedAt: string; completedAt?: string;
}
```

#### 2. `task-flow.ts`(localStorage,状态机)
```typescript
export const taskFlowStore = writable<TaskFlowInstance | null>(loadCurrent());
export function startTaskFlow(flowId: string): string;
export function advanceStep(instanceId: string, contextUpdate?: TaskContext): void;
export function cancelTaskFlow(instanceId: string): void;
export function completeTaskFlow(instanceId: string): void;
export const currentStepDef = derived(taskFlowStore, ...); // 当前步骤定义
```

#### 3. `task-history-types.ts` + `task-history.ts`
```typescript
export interface TaskHistoryEntry { id: string; flowId: string; flowName: string; startedAt: string; completedAt: string; status: 'completed' | 'cancelled'; context: TaskContext; }
export const taskHistoryStore = writable<TaskHistoryEntry[]>(loadHistory());
export function appendHistory(entry: TaskHistoryEntry): void;
```

#### 4. `guided-tasks.ts`(4 引导任务定义,纯数据)
```typescript
export interface GuidedTaskDef { id: string; title: string; description: string; icon: string; estimatedMinutes: number; flowId: string; }
export const GUIDED_TASKS: GuidedTaskDef[]; // 4 个:demo-look-around / demo-build-rule / demo-run-audit / demo-export
```

#### 5. `view-mode.ts`(localStorage,专家/决策者切换)
```typescript
export type ViewMode = 'expert' | 'decision_maker';
export const viewModeStore = writable<ViewMode>(loadViewMode());
export function setViewMode(m: ViewMode): void;
export function toggleViewMode(): void;
```

#### 6. `guided-task-progress.ts`(localStorage,demo 进度)
```typescript
export const guidedTaskProgressStore = writable<Record<string, boolean>>(loadProgress());
export function markGuidedTaskDone(taskId: string): void;
export function resetGuidedTaskProgress(): void;
export const completedGuidedCount = derived(guidedTaskProgressStore, ($p) => Object.values($p).filter(Boolean).length);
```

### 新增数据(`src/lib/data/`,3 个)
- `task-flows.ts` — 6 TaskFlow 定义:build_db / add_rule / organize_dataset / run_and_monitor / export_audit / compliance_gate
- `demo-medical.ts` — 医疗场景预填(规则 + 数据集 + 术语 + schema,扩展 HOME_DESIGN §8.4)
- `demo-finance.ts` — 财务场景预填

### 新增 Backend(`src/lib/backend/mock-backend.ts`)
实现 `ExecutionBackend` 15 方法 + `getProductionState()`,复用 `export-mock-data.ts` 的医疗场景 mock 模式:
- `health()` → true
- `createSession()` → 返回固定 demo SessionId
- `listSessions()` → [demo SessionId]
- `getSessionState()` → MOCK_SESSION_STATE(对齐 ReactorState 契约)
- `getReplay()` → MOCK_FACTS(6 条医疗因果链)
- `getAudit()` → MOCK_AUDIT(BLAKE3 审计链)
- `getCausalChain()` → 因果链
- `verifyAudit()` → { verified: true }
- `submitCommand()` → mock CommandResult
- 其余方法返回空/默认值
- `getProductionState()` → { status: 'running', currentSessionId, rulesetVersion, ... }
- **SSE 模拟**:用 setInterval(2s) 生成 mock fact 推送(sse-connection.ts 已有降级机制,MockBackend 触发相同路径)

**Backend 选择器**:在 `src/lib/backend/` 新增 `backend-selector.ts`,根据 netConfig.mode + demoDatasetStore 选择 CloudHttpBackend 或 MockBackend。修改 `+layout.svelte` 注入逻辑。

### 新增组件(4 个,`src/lib/views/TaskFlow/` + `Home/Demo/`)
- `TaskFlow/TaskFlowWizard.svelte` — 主视图:进度条(步骤数/总数)+ 当前步骤指引 + 上一步/下一步/取消按钮 + 上下文显示
- `TaskFlow/TaskFlowDropdown.svelte` — 顶部导航下拉(6 TaskFlow 列表 + 启动)
- `TaskFlow/TaskHistoryView.svelte` — 历史任务列表 + 重新发起
- `Home/Demo/GuidedTasks.svelte` — DemoHome 内 4 引导任务卡片网格 + 完成进度

### 修改文件(4 个)
- `src/lib/views/Home/RealWorkbench.svelte` — 顶部加 TaskFlowDropdown + TaskFlowWizard 挂载点(状态 C 内)
- `src/lib/views/Home/DemoHome.svelte` — 加 GuidedTasks 组件 + 替换 demo-placeholder 占位 + 4 引导任务入口
- `src/lib/backend/` — 新增 backend-selector.ts,`+layout.svelte` 改用选择器注入
- `svelte.config.js` — 确认 adapter-static 配置(已 OK,无需改)+ base path 注释(GitHub Pages 子路径用)

### 新增 CI + 文档(2 个)
- `.github/workflows/deploy-demo.yml`:
  ```yaml
  name: Deploy Demo to GitHub Pages
  on: { push: { branches: [main] } }
  permissions: { contents: read, pages: write, id-token: write }
  jobs:
    build-deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20', cache: 'npm' }
        - run: npm ci
        - run: npm run check
        - run: npx vitest run
        - run: npm run build
        - uses: actions/configure-pages@v4
        - uses: actions/upload-pages-artifact@v3
          with: { path: './build' }
        - uses: actions/deploy-pages@v4
  ```
- `README.md` — 顶部加「给决策者(30 秒看懂)」章节:
  - 为什么需要 evorule(AI Agent 合规审计层)
  - 在线 demo 链接(GitHub Pages URL 占位)
  - 4 引导任务入口
  - 与 LangSmith/Langfuse 对比(对齐 project_memory 开源展示轨要求)
  - Case Study:医疗分诊规则触发完整链路

### 测试(`src/lib/stores/__tests__/`,3 个新测试文件)
- `task-flow.test.ts` — 6 TaskFlow 定义完整 + startTaskFlow/advanceStep/cancel/complete 状态机 + 上下文保留
- `mock-backend.test.ts` — 15 方法调用 + ReactorState 契约 + BLAKE3 审计链 + getProductionState
- `view-mode.test.ts` — 切换 + 持久化

### T5c 验证
```bash
npm run check && npx vitest run && npm run build
npm run preview  # 手动验证:未登录→状态 A→4 引导任务→MockBackend 驱动 demo
```

---

## T5d:P11 UX 缺口收尾(3 组件 + 贯穿修改)

**设计依据**:`docs/P11_UX_GAPS_FIX_DESIGN.md`(§3 决策 / §4 组件 / §6 5 缺口修复)

**注**:缺口 1(Toast)/ 缺口 2(EmptyState)组件已在 T1 创建(`Toast.svelte`/`EmptyState.svelte`/`StatusBadge.svelte`)。T5d 聚焦缺口 3/4/5 + 把 Toast/EmptyState/GuidedHint 贯穿到 P01-P09 各视图。

### 新增组件(3 个,`src/lib/views/`)
- `Feedback/GuidedHint.svelte` — 视图首次访问提示气泡(localStorage key `evorule-console-cloud:guided-hint:{viewId}`,首次显示,关闭后记录不再显示)
  ```svelte
  <script lang="ts">
    let { viewId, title, body } = $props();
    let dismissed = $state(checkDismissed(viewId));
    function dismiss() { markDismissed(viewId); dismissed = true; }
  </script>
  {#if !dismissed}
    <div class="guided-hint" role="alert">
      <h4>{title}</h4><p>{body}</p>
      <button onclick={dismiss}>知道了</button>
    </div>
  {/if}
  ```
- `Home/OnboardingBanner.svelte` — 首屏引导横幅(未完成首条规则时显示,CTA 跳向导)
- `DecisionMaker/DecisionMakerView.svelte` — 决策者简化视图(关键指标:规则数/今日决策数/合规状态 + 事件摘要 + 一键导出按钮)。**状态 C 内视图模式切换**,非独立路由(决策 3.4)

### 修改文件(贯穿 + 集成)
- `src/lib/views/Home/RealWorkbench.svelte` — 加 viewMode toggle(专家↔决策者,调 viewModeStore)+ DecisionMakerView 渲染分支
- P01-P09 各视图 — 横向贯穿加 Toast 调用(操作反馈)+ EmptyState 引用(空态)+ GuidedHint(首次提示)。代表性文件(每视图只加 1-2 个关键点,非全量覆盖):
  - `BusinessRuleLibrary.svelte` — 删除规则 toast + 空规则库 EmptyState + 首次进入 GuidedHint
  - `DatasetManager.svelte` — 创建数据集 toast + 空数据集 EmptyState
  - `BusinessExecutionPad.svelte` — 提交事件 toast + GuidedHint
  - `MonitorDashboard.svelte` — SSE 连接 toast + 空 Fact 流 EmptyState
  - `BusinessAuditView.svelte` — 首次进入 GuidedHint
  - `ExportDialog.svelte` — 导出成功/失败 toast(已有,确认)
- `src/lib/views/Home/DemoHome.svelte` — 缺口 5 demo 打磨(与 T5c 协同:已加 GuidedTasks,此处加 OnboardingBanner + 视觉打磨)

### 测试(`src/lib/stores/__tests__/`,2 个新测试文件)
- `guided-hint.test.ts` — 首次显示 / dismiss 后不再显示 / 不同 viewId 独立
- `view-mode-integration.test.ts` — 切换持久化 + RealWorkbench 渲染分支(若有组件测试)

### T5d 验证
```bash
npm run check && npx vitest run && npm run build
```

---

## P0 总验收(T5d 完成后)

完整 11 步功能流跑通:**建库 → 加规则 → 整理 → 组合数据集 → 导入运行 → 看运行时 → 看指标 → 处理运行时 → 查看结果 → 导出 → 回放审计**。

### 最终验证命令
```bash
npm run check && npx vitest run && npm run build
```

### 在线 demo 验证
```bash
npm run preview  # 模拟 GitHub Pages 产物
```
确认:未登录→状态 A→4 引导任务→MockBackend 驱动的完整 demo 体验→登录(5 角色任选)→状态 C 工作台→专家/决策者视图切换。

## 风险与应对

| 风险 | 应对 |
|---|---|
| T5 体量大,单次无法完成 | 4 子阶段顺序实施,每子阶段独立验证交付 |
| MockBackend 与 CloudHttpBackend 切换 | 复用现有 online/offline 模式机制,backend-selector.ts 按 mode + demoDataset 注入 |
| P09 复用 P07 渲染器可能破坏 T4 | format-converter 在 export-renderers 之上扩展,不修改 export-renderers.ts |
| 贯穿 P01-P09 加 Toast/EmptyState 工作量 | 每视图只加 1-2 个关键点,非全量覆盖;优先核心 6 视图 |
| GitHub Pages base path | adapter-static 当前 base='',部署到子路径时需调整(先发布根路径,占位 URL) |
| localStorage 容量 | activity-log 限 100 条;P09 大文件走 Blob 下载不存 localStorage;import-snapshot 只存元数据+小 store |
| P08 设计文档是 fetch-based | 改写为 localStorage-based,保留接口签名(函数名/参数/返回值),替换内部实现 |

## 实施顺序(总览)

```
T5a(P08:9 store + 9 组件 + 4 路由 + 3 修改 + 4 测试)
  → T5b(P09:10 store + 8 组件 + 2 路由 + 1 数据 + 4 测试)
  → T5c(P10:7 store + 3 数据 + mock-backend + 4 组件 + CI + README + 3 测试)
  → T5d(P11:3 组件 + 贯穿修改 + 2 测试)
  → P0 总验收(11 步功能流 + npm run check/vitest/build + preview)
```

每子阶段完成后报告验证结果,再进下一个。设计文档的详细类型定义(§4 数据模型 / §6 Store)在每个子阶段实施时再精读对应章节,而非一次性全读。

## 假设

- T1-T4 代码稳定,不引入回归(每子阶段验证含全量测试)
- 内核 `@evorule/console` 不修改,ExecutionBackend 15 方法契约不变
- localStorage 容量充足(P0 数据量小,单库 < 1MB)
- GitHub Pages 部署到用户名子路径(`<user>.github.io/evorule-console-cloud`),base path 在 CI 中配置(若需要)
- P08 mock 用户:5 个预置账号,不实现密码校验(P0 demo 用)
