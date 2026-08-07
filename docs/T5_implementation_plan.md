# T5 实施计划：协作 + 导入导出 + 任务流 + UX 收尾（P08 + P09 + P10 + P11）

## Context

T5 是 evorule-console-cloud P0 的最后一个梯队，覆盖 P08（5 角色协作）+ P09（导入导出基础设施）+ P10（任务流 + 在线 demo）+ P11（5 缺口 UX 修复）。T1-T4 已完成并通过验证（407 vitest 通过、svelte-check 0 error、build 成功）。

**当前状态**：T5 全部代码从零开始——经核实 stores/ 目录仅有 T1-T4 的 36 个文件，auth/publish-queue/task-flow/mock-backend 等 22 个 T5 候选文件全部不存在（前两个 Explore agent 报告的"已存在"系幻觉，将设计文档代码示例误当源文件）。

**目标**：交付可在线 demo 的完整 P0 产品。最终跑通 P0 总验收 11 步功能流（建库→加规则→整理→组合数据集→导入运行→看运行时→看指标→处理运行时→查看结果→导出→回放审计）。

## 关键决策（已与用户确认）

1. **P08 后端策略 = localStorage mock**：所有 P08 数据（auth/users/members/publish-queue/comments/notifications/edit-lock/activity-log）全部 mock + localStorage，不连真实 evorule-server。与 P10 MockBackend 离线 demo 一致。预留 API 契约供 P1 接入。（注：第四梯队 server 虽已实现 publish-queue/production-audit 端点，但 P0 不消费，保持 demo 离线可跑。）
2. **GitHub Pages = 现在建 workflow**：`.github/workflows/deploy-demo.yml` 现就位。Gitee 是主仓、GitHub 是镜像、核心仓已发布，按正规方法做（main push 触发 → adapter-static 构建 → Pages 部署）。
3. **推进方式 = 4 子阶段顺序实施**：T5a P08 → T5b P09 → T5c P10 → T5d P11。每子阶段独立验证（`npm run check && npx vitest run && npm run build`），通过后再进下一个。

## 复用约定（沿用 T1-T4 已验证模式）

- **Store 模式**：`writable` + `$app/environment` browser 守卫 + localStorage 持久化（参考 `src/lib/stores/business-terms.ts`、`dataset.ts`、`session.ts`）。builtin 数据放 `src/lib/data/`，user 数据持久化。
- **组件模式**：Svelte 5 runes（`$state`/`$derived`/`$props`/`$effect`）+ store 自动订阅（`$store`）。参考 `ExportDialog.svelte`、`MonitorDashboard.svelte`。a11y：label 关联控件、交互元素用 `<button>`。
- **Backend 注入**：`provideBackend`/`useBackend`（`@evorule/console`）。MockBackend 实现 `ExecutionBackend` 15 方法，按 `cloud-http-backend.ts:147` 注释的契约。
- **路由守卫**：`src/routes/+layout.ts` 的 login guard 模式（T4 已为 /export 加过）。
- **测试**：`vi.fn` mock backend + `beforeEach` 重置 store（参考 `export-store.test.ts`、`export-mock-data.ts`）。
- **内核不修改**：包装优于继承，业务化层全在 console-cloud。

---

## T5a：P08 协作工作流（9 store + 9 组件 + 3 路由）

**设计依据**：`docs/P08_COLLAB_WORKFLOW_DESIGN.md`（§3 决策 / §4 数据模型 / §5 权限矩阵 / §6 Store / §7 组件 / §12 实施路径）

### 新增 Store（9 个，`src/lib/stores/`）
- `auth.ts` — User 身份 + 5 角色 + session token（localStorage）。**扩展而非替换** `session.ts`：auth.ts 持有角色/权限，session.ts 保留登录态布尔（T1 已用）。导出 `login()/logout()/hasPermission(action)/currentUser`。
- `permission-matrix.ts` — 5 角色 × 12 动作权限矩阵（纯数据 + `can(role, action)` 谓词）。5 角色：Admin/DepartmentHead/Doctor/Auditor/Viewer。12 动作见 §5.1。
- `workspace-members.ts` — 成员 CRUD + 角色分配（localStorage）。
- `publish-queue.ts` — 发布队列状态机：draft→submitted→reviewing→approved/rejected→published。submit/approve/reject/emergencyRollback。
- `production-audit.ts` — 版本历史时间线（mock 数据，对齐第四梯队 production_audit 表结构）。
- `comments.ts` — 规则/工作区/发布请求的评论线程 + @提及。
- `notifications.ts` — 站内通知队列（未读计数 + 标记已读）。
- `edit-lock.ts` — 规则编辑悲观锁（acquire/release/heartbeat，localStorage 模拟）。
- `activity-log.ts` — 用户操作日志（append-only，最近 100 条）。

### 新增组件（`src/lib/views/`）
- `Auth/LoginForm.svelte` / `Auth/UserMenu.svelte`
- `Notifications/NotificationBell.svelte`（+ 未读徽标）
- `PublishQueue/PublishQueueList.svelte` / `VersionHistory/VersionTimeline.svelte`
- `Collab/WorkspaceSwitcher.svelte` / `Collab/CommentThread.svelte` / `Collab/ReviewActions.svelte`
- `ActivityLog/ActivityLogTable.svelte`

### 新增路由
- `src/routes/login/+page.svelte` → LoginForm
- `src/routes/publish-queue/+page.svelte` → PublishQueueList（DepartmentHead/Admin 守卫）
- `src/routes/version-history/+page.svelte` → VersionTimeline
- `src/routes/audit/+page.svelte`（+ `+layout.ts` auditor 角色守卫）→ P06 审计员工作台入口

### 修改文件
- `src/routes/+layout.svelte` — 顶部导航加 NotificationBell + UserMenu + 登录入口
- `src/routes/+layout.ts` — 加 /publish-queue、/version-history、/audit 角色守卫
- `src/lib/views/Home/Monitor/InterventionBar.svelte` — 13 按钮加 `hasPermission` 守卫（P05 §10.1）

### 验证
- 单测：权限矩阵 5×12、publish-queue 状态机全路径、edit-lock 冲突、comments @提及解析
- `npm run check && npx vitest run && npm run build` 0 error

---

## T5b：P09 导入导出基础设施（10 store + 8 组件 + 2 路由）

**设计依据**：`docs/P09_IMPORT_EXPORT_INFRA_DESIGN.md`（§3 决策 / §4 数据模型 / §5 格式转换层 / §6 4 类对象 / §7 市场 / §9 组件）

### 关键复用（决策 3.1）
**抽取 P07 渲染器为通用格式转换层**：T4 的 `export-renderers.ts`（JSON/CSV/PDF/XML 4 渲染器）已存在，P09 `format-converter.ts` 在其上扩展 6 格式（+YAML +Markdown），复用 P07 的 ExportContent 中间态。

### 新增 Store（10 个，`src/lib/stores/`）
- `import-export-types.ts` — UniversalExportPackage / BatchExportPackage / ImportConflict / ImportSnapshot 类型
- `format-converter.ts` — 6 格式互转（JSON/CSV/XML/YAML/Markdown + PDF 只读），复用 P07 渲染器
- `rule-import-export.ts` — 规则单条/批量导入导出（扩展 P01，复用内核 rules store）
- `dataset-import-export.ts` — 数据集导入导出（扩展 P03，复用 `dataset.ts`）
- `form-import-export.ts` — 表单 schema 导入导出（扩展 P02，复用 `business-form-schema.ts`）
- `library-schema-import.ts` — 库 schema 模板导入（扩展 P01）
- `marketplace.ts` — 模板市场 store（builtin + 用户上传 + 搜索）
- `ruleset-types.ts` — RulesetPackage 官方规则集标准格式（§3.8 生态级共享）
- `ruleset-import.ts` — 从 ruleset.json 导入规则集
- `import-snapshot.ts` — 导入前自动快照 + 回滚（4 冲突策略：skip/overwrite/rename/merge，默认 rename）

### 新增组件（`src/lib/views/ImportExport/` + `Marketplace/`）
- `ImportExportPage.svelte`（统一入口，Tab：Import/Export/Marketplace）
- `ImportTab.svelte` / `ExportTab.svelte` / `MarketplaceTab.svelte`
- `ConflictResolver.svelte`（4 策略 UI）
- `BatchExportDialog.svelte`（ZIP + manifest.json）
- `MarketplaceCard.svelte` / `RulesetImporter.svelte`

### 新增路由
- `src/routes/import-export/+page.svelte` → ImportExportPage
- `src/routes/marketplace/+page.svelte` → MarketplaceTab

### 新增数据（`src/lib/data/`）
- `market-template-samples.ts` — builtin 市场模板（finance/medical/compliance starter，含 §3.8 的 DJBH 2.0 三级合规规则模板，记忆中已设计）

### 验证
- 单测：6 格式互转矩阵、4 冲突策略、import-snapshot 回滚、ruleset.json 解析
- `npm run check && npx vitest run && npm run build` 0 error

---

## T5c：P10 任务流 + MockBackend + 在线 demo（7 store + 4 组件 + CI + README）

**设计依据**：`docs/P10_TASKFLOW_DEMO_DESIGN.md`（§3 决策 / §4 数据模型 / §5 Store / §6 组件树 / §8 代码示例 / §8.7 部署）

### 新增 Store（7 个）
- `task-flow-types.ts` — TaskFlowDef / TaskStepDef / TaskFlowInstance / TaskContext（§4.1）
- `task-flow.ts` — taskFlowStore（启动/推进/取消，上下文保留跨步骤）
- `task-history-types.ts` + `task-history.ts` — 任务历史（localStorage）
- `guided-tasks.ts` — 4 引导任务定义（demo 模式）
- `view-mode.ts` — 专家/决策者视图切换（localStorage）——注：P11 也用，T5c 先建
- `guided-task-progress.ts` — demo 引导任务完成进度（localStorage）

### 新增数据（`src/lib/data/`）
- `task-flows.ts` — 6 TaskFlow 定义：build_db / add_rule / organize_dataset / run_and_monitor / export_audit / compliance_gate（记忆中已扩展合规门禁专项）
- `demo-medical.ts` / `demo-finance.ts` — 预填数据（规则 + 数据集 + 术语 + schema，扩展 HOME_DESIGN §8.4）

### 新增 Backend
- `src/lib/backend/mock-backend.ts` — 实现 `ExecutionBackend` 15 方法，返回 demo 预填数据。**复用 `export-mock-data.ts` 的医疗场景 mock 模式**（vi.fn + 真实 ReactorState 契约 + BLAKE3 审计链）。SSE 用 setTimeout 模拟 fact 流。在 offline/demo 模式下由 backend 选择器注入（替代 CloudHttpBackend）。

### 新增组件（`src/lib/views/TaskFlow/`）
- `TaskFlowWizard.svelte`（主视图：进度条 + 步骤指引 + 动作按钮，§8.1）
- `TaskFlowDropdown.svelte`（顶部导航下拉，选任务流，§8.2）
- `TaskHistoryView.svelte`
- `Home/Demo/GuidedTasks.svelte`（DemoHome 内 4 引导任务卡片，增强版 §8.3）

### 修改文件
- `src/lib/views/Home/RealWorkbench.svelte` — 加 TaskFlowDropdown + TaskFlowWizard 挂载点
- `src/lib/views/Home/DemoHome.svelte` — 加 GuidedTasks + demo 打磨（状态 A 完整化）
- `src/lib/backend/` 选择器 — offline/demo 模式注入 MockBackend（与 CloudHttpBackend 并列）
- `svelte.config.js` — 确认 adapter-static 配置 + base path（GitHub Pages 子路径）

### 新增 CI + 文档
- `.github/workflows/deploy-demo.yml` — main push 触发 → `npm ci && npm run build`（adapter-static）→ 部署 GitHub Pages。按正规方法做（Gitee 主仓 / GitHub 镜像，核心仓已发布）。
- `README.md` — 顶部加「给决策者（30 秒看懂）」章节：为什么需要 evorule + 在线 demo 链接 + 4 引导任务 + 截图 + Case Study + 与 LangSmith/Langfuse 对比（对齐 project_memory 的开源展示轨要求）。

### 验证
- 单测：6 TaskFlow 定义完整、taskFlowStore 状态机、MockBackend 15 方法、demo 数据加载
- 手动：`npm run build` 产出可静态部署；`npm run preview` 验证 demo 模式（未登录→状态 A→4 引导任务）
- `npm run check && npx vitest run && npm run build` 0 error

---

## T5d：P11 UX 缺口收尾（缺口 3/4/5 + 贯穿）

**设计依据**：`docs/P11_UX_GAPS_FIX_DESIGN.md`（§3 决策 / §4 组件 / §6 5 缺口修复）

**注**：缺口 1（Toast）/ 缺口 2（EmptyState）的组件已在 T1 创建（`Toast.svelte`/`EmptyState.svelte`/`StatusBadge.svelte`）。T5d 聚焦缺口 3/4/5 + 把 Toast/EmptyState/GuidedHint 贯穿到 P01-P09 各视图。

### 新增组件（`src/lib/views/`）
- `Feedback/GuidedHint.svelte` — 视图首次访问提示（localStorage 记录已看过，§4.4）
- `Home/OnboardingBanner.svelte` — 首屏引导横幅
- `DecisionMaker/DecisionMakerView.svelte` — 决策者简化视图（关键指标 + 事件摘要 + 合规状态，§8.1）。**状态 C 内视图模式切换**，非独立路由（决策 3.4）。

### 修改文件（贯穿 + 集成）
- `src/lib/views/Home/RealWorkbench.svelte` — 加 viewMode toggle（专家↔决策者）+ DecisionMakerView 渲染分支
- P01-P09 各视图 — 横向贯穿加 Toast 调用（操作反馈）+ EmptyState 引用（空态）+ GuidedHint（首次提示）。代表性文件：`BusinessRuleLibrary.svelte`、`DatasetManager.svelte`、`BusinessExecutionPad.svelte`、`MonitorDashboard.svelte`、`BusinessAuditView.svelte`、`ExportDialog.svelte`。模式：每个视图加 1-2 个关键操作的 Toast + 空数据时的 EmptyState + 首次进入的 GuidedHint。
- `src/lib/views/Home/DemoHome.svelte` — 缺口 5 demo 打磨（与 T5c 协同）

### 验证
- 单测：viewModeStore 切换 + 持久化、GuidedHint 首次/重复显示逻辑、DecisionMakerView 数据聚合
- `npm run check && npx vitest run && npm run build` 0 error

---

## P0 总验收（T5d 完成后）

完整 11 步功能流跑通：建库 → 加规则 → 整理 → 组合数据集 → 导入运行 → 看运行时 → 看指标 → 处理运行时 → 查看结果 → 导出 → 回放审计。

**最终验证命令**（每子阶段 + T5 收尾）：
```bash
npm run check && npx vitest run && npm run build
```

**在线 demo 验证**：`npm run preview` 模拟 GitHub Pages 产物，确认未登录→状态 A→4 引导任务→MockBackend 驱动的完整 demo 体验。

## 风险与应对

| 风险 | 应对 |
|---|---|
| T5 体量大，单次无法完成 | 4 子阶段顺序实施，每子阶段独立验证交付 |
| MockBackend 与 CloudHttpBackend 切换 | 复用现有 online/offline 模式机制，backend 选择器按 mode 注入 |
| P09 复用 P07 渲染器可能破坏 T4 | 抽取为 format-converter 时保持 P07 `export-renderers.ts` 不变，format-converter 在其上扩展 |
| 贯穿 P01-P09 加 Toast/EmptyState 工作量 | 每视图只加 1-2 个关键点，非全量覆盖；优先核心视图 |
| GitHub Pages base path | adapter-static 配 `base` 选项，相对路径资源 |
| localStorage 容量 | P08 activity-log 限 100 条；P09 大文件走 Blob 下载不存 localStorage |

## 实施顺序

T5a（P08）→ T5b（P09）→ T5c（P10 + MockBackend + CI + README）→ T5d（P11 UX 收尾 + 贯穿）→ P0 总验收。

每子阶段完成后报告验证结果，再进下一个。设计文档的详细类型定义（§4 数据模型 / §6 Store）在每个子阶段实施时再精读对应章节，而非一次性全读。
