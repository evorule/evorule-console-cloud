# evorule-console-cloud P0 整体实施计划

## Context

evorule-console-cloud 是 evorule 企业 AI Agent 合规审计层的大众版前端。18 份设计文档（HOME_DESIGN + P01-P11 + 三层架构 + 第四梯队服务端）已全部定稿，现进入实施阶段。

**现状**：代码库已实现 LLM assistant + CloudHttpBackend + 配置 + Settings/Assistant 视图 + 内核5视图直接渲染。P01-P11 全部业务层功能未实现。

**目标**：按 5 个梯队实施 P01-P11 前端（不含 Rust 服务端第四梯队），最终交付可在线 demo 的完整 P0 产品。

**约束**：不修改内核 @evorule/console；P0 数据全在 localStorage；延续 Svelte 5 runes + provideXxx 注入模式。

---

## 依赖关系图

```
T1 基础设施层 (HOME stores + P11 反馈组件)
  ↓
T2 建库 + 业务语言 v0 (P01 + P02)
  ↓
T3 数据集 + 执行台 + 监控大屏 (P03 + P04 + P05)  ← 可部分并行
  ↓
T4 业务审计 + 时间旅行 + 通用导出 (P06 + P07)
  ↓
T5 协作 + 导入导出 + 任务流 + UX 收尾 (P08 + P09 + P10 + P11)
```

---

## T1：基础设施层（HOME_DESIGN 骨架 + P11 缺口 1+2）

**交付目标**：首页 A/B/C 状态机可切换 + 全局 Toast/EmptyState/StatusBadge 组件可被所有视图调用。

### 新增 Store（8 个）
- `src/lib/stores/session.ts` — mock 登录态（loggedIn/userId/username + localStorage）
- `src/lib/stores/db.ts` — 库元数据（dbId/dbName/businessObjects/industry/createdAt）+ 派生 isEmptyDb/ruleCount（基于内核 rules store）
- `src/lib/stores/home-mode.ts` — 'auto' / 'force-demo' 切换
- `src/lib/stores/demo-dataset.ts` — 'medical' / 'finance' 切换（localStorage）
- `src/lib/stores/layer.ts` — 'L1' / 'L2' / null 层视图 + resolveDefaultLayer()
- `src/lib/stores/production-state.ts` — currentSessionId/rulesetVersion/status + onSessionSwitched() U7 回调
- `src/lib/stores/toast.ts` — toastStore（队列 ≤ 3，FIFO，自动消失）
- `src/lib/stores/empty-state-types.ts` — no_data / no_permission / load_failed / not_configured

### 新增组件（9 个）
- `src/lib/views/Home/HomeRouter.svelte` — 状态感知路由（force-demo/未登录→A；空库→B；有库→C）+ 层感知
- `src/lib/views/Home/DemoHome.svelte` — 状态 A 骨架（T5 打磨）
- `src/lib/views/Home/OnboardingWizard.svelte` — 状态 B 骨架（T2 实现5步）
- `src/lib/views/Home/RealWorkbench.svelte` — 状态 C 层感知壳（L1/L2 toggle）
- `src/lib/views/Feedback/Toast.svelte` — 统一 Toast（4 类，自动消失）
- `src/lib/views/Feedback/EmptyState.svelte` — 统一空态（4 类标准文案 + CTA）
- `src/lib/views/Feedback/StatusBadge.svelte` — 统一状态徽标（8 状态）

### 修改文件
- `src/routes/+page.svelte` — 改为渲染 HomeRouter（替换原5视图直接渲染）
- `src/routes/+layout.svelte` — 全局挂载 Toast.svelte + onMount 加 sessionStore/layerStore 恢复
- `src/routes/+layout.ts`（新增）— 路由守卫

### 核心逻辑
- **HomeRouter 决策**：`force-demo → A`、`!loggedIn → A`、`isEmptyDb → B`、`else → C`
- **dbStore 派生**：`isEmptyDb = derived(rules, $rules => $rules.length === 0)`，不持久化 ruleCount
- **Toast 队列**：writable 数组，pushToast 时若 > 3 移除最早；setTimeout 自动 dismiss

### 验收标准
- [ ] 未登录 → DemoHome 占位；登录+空库 → OnboardingWizard 占位；登录+有规则 → RealWorkbench
- [ ] Toast 4 类可调用，自动消失，最多 3 条
- [ ] EmptyState 4 类文案一致
- [ ] StatusBadge 8 状态正确渲染

---

## T2：建库 + 业务语言 v0（P01 + P02）

**交付目标**：业务专家 5 分钟跑通建库向导 + 业务表单可编辑 + LLM 草案可反向解析回表单。

### 新增 Store（7 个）
- `src/lib/stores/business-terms.ts` — 12 条 builtin + 同义词匹配 + status 流转
- `src/lib/stores/business-form-schema.ts` — 4 条 builtin + visibleWhen/enabledWhen/requiredWhen
- `src/lib/stores/rule-business-meta.ts` — schemaId + formValues + compliance 元数据
- `src/lib/stores/business-preview.ts` — 缓存 + LLM 调用 + 降级
- `src/lib/stores/business-preview-explainer.ts` — 本地降级解释器
- `src/lib/stores/auto-fill-terms.ts` — 字段 termId 自动补全

### 新增数据（4 个）
- `src/lib/data/business-terms-builtin.ts` — 12 条（finance × 6 + compliance × 6）
- `src/lib/data/business-form-schemas-builtin.ts` — 4 条（finance × 2 + compliance × 2）
- `src/lib/data/template-finance.ts` — 财务模板（3-5 条 builtin 规则 + 术语 + schema）
- `src/lib/data/template-compliance.ts` — 合规模板

### 新增核心算法（3 个）
- `src/lib/views/Rules/business-form-to-json.ts` — 双向转换器（正向 formValuesToEvoruleJson + 反向 evoruleJsonToFormValues，支持 branch[0]/io_request/点分路径）
- `src/lib/views/Rules/business-preview-explainer.ts` — "如果 X 则 Y" + 术语高亮
- `src/lib/views/Rules/auto-fill-terms.ts` — 字段 termId 补全

### 新增建库向导组件（5 个，在 `src/lib/views/Build/WizardSteps/`）
- `StepTemplatePicker.svelte` / `StepDbConfig.svelte` / `StepFirstRule.svelte`（双模式：LLM + 业务表单）/ `StepTrialRun.svelte` / `StepComplete.svelte`

### 新增业务规则库组件（7 个，在 `src/lib/views/Rules/`）
- `BusinessRuleLibrary.svelte`（包装内核 RuleLibraryView，业务/开发者模式 toggle）
- `BusinessTermFilter.svelte` / `BusinessRuleCard.svelte` / `BusinessForm.svelte` / `BusinessPreview.svelte` / `SchemaSelector.svelte` / `DeveloperModeToggle.svelte`

### 修改文件
- `src/lib/views/Home/OnboardingWizard.svelte` — T1 占位 → 实现 5 步状态机
- `src/routes/view/[id]/+page.svelte` — rules 视图 → BusinessRuleLibrary

### 核心逻辑
- **复用内核 rules store**：`import { rules, addRule } from '@evorule/console'`，不重新发明
- **业务元数据扩展表**：`ruleBusinessMetaStore: Map<ruleId, BusinessMeta>`，不污染内核 Rule 类型
- **双向转换器**：按 evorulePath 点分路径构建/解析嵌套对象，支持数组索引 `branch[0]`
- **LLM 反向解析**：LLM 生成草案 → JSON.parse → evoruleJsonToFormValues → 表单预填
- **业务预览三层降级**：LLM 可用 → LLM explainRule；LLM 失败 → 本地解释器；解析失败 → raw JSON

### 验收标准
- [ ] 5 步建库向导全跑通，Step 3 完成后 isEmptyDb 自动变 false
- [ ] 业务表单字段联动（6 操作符）正确求值
- [ ] 双向转换器：正向 + 反向 + 数组索引 + 类型转换
- [ ] LLM 草案 → 反向解析回表单 → 修改 → 重新生成 JSON，完整闭环
- [ ] 业务预览三层降级正确
- [ ] 12 条术语 + 4 条 schema 正确加载
- [ ] 开发者模式 toggle 切换到内核 RuleLibraryView

---

## T3：数据集 + 执行台 + 监控大屏（P03 + P04 + P05）

**交付目标**：数据集 CRUD + 标签/分类 + 业务事件表单提交 + L1 监控大屏消费 SSE 实时 Fact 流 + 13 按钮干预。

### 新增 Store（P03: 8 个 + P04: 3 个 + P05: 6 个）
- P03：`dataset.ts` / `dataset-types.ts` / `tag.ts` / `category.ts` / `rule-tag.ts` / `rule-category.ts` / `rule-filter.ts` + `src/lib/utils/json-patch.ts`（RFC 6902）+ `src/lib/dataset/assemble-ruleset.ts`
- P04：`business-event.ts`（CRUD + 翻译 + 提交）/ `business-event-templates.ts`（3 模板）/ `impact-preview.ts`（前端规则匹配预览）
- P05：`fact-stream.ts`（环形缓冲 1000 条）/ `anomaly.ts` / `reactor-runtime.ts`（2s 轮询）/ `sse-connection.ts`（连接 + 重连 + 降级）/ `performance-metrics.ts`（5s 轮询）/ `sse-events.ts`

### 新增组件
- P03（`src/lib/views/Dataset/` + `Tags/` + `Categories/`）：DatasetManager / DatasetList / DatasetCard / DatasetEditor / RulePicker / ParamOverrideEditor / DatasetPreview / TagManager / CategoryManager / CategoryTree 等
- P04（`src/lib/views/ExecutionPad/`）：BusinessExecutionPad（包装内核 ExecutionPadView）/ EventFormPanel / DynamicForm / InstructionPanel / ImpactPreviewPanel / SubmitBar
- P05（`src/lib/views/Home/Monitor/`）：MonitorDashboard / ConnectionBanner / ReactorStateBar / FactStreamView（虚拟列表）/ FactCard / AnomalyPanel / PerformanceMetrics / InterventionBar（13 按钮 + 二次确认）/ ConfirmDialog / RollbackVersionPicker / SessionSwitchToast（U7）
- 通用：`src/lib/components/VirtualList.svelte`（自实现，1000+ Fact/秒不卡）

### 核心逻辑
- **数据集组合**：只存 ruleIds 不复制内容；运行时 assemble-ruleset 用 getAllRules() + applyPatch
- **状态机**：draft → testing → ready → published
- **业务事件两层**：表单层（业务专家可读）+ 指令层（LLM 翻译的 instruction JSON）
- **SSE 生命周期**：EventSource → 收到 fact 追加 FactStream → session_switched(U7) 调 onSessionSwitched → 卸载关闭
- **U7 切换**：旧 SSE 推 session_switched → 关闭旧 EventSource → 更新 productionStateStore → 新建 EventSource → SessionSwitchToast
- **虚拟列表**：只渲染可视区域（约 20-50 条），DOM 节点恒定

### 验收标准
- [ ] 数据集 CRUD + 4 状态流转
- [ ] 标签多对多 + 分类树形 + 筛选
- [ ] 业务事件表单提交 → Fact + CausalChain 预览
- [ ] 影响预览前端匹配
- [ ] SSE 实时 Fact 流：1000+ Fact/秒不卡
- [ ] U7 切换通知正确
- [ ] 13 按钮干预操作全部二次确认
- [ ] Reactor 运行态栏 6 phase 正确显示

---

## T4：业务审计 + 时间旅行 + 通用导出（P06 + P07）

**交付目标**：BLAKE3 审计链业务化展示 + 因果链业务术语解释 + ttd 5 视图业务化包装 + 决策支持 + 一键回滚 + 4 格式导出 + BLAKE3 完整性嵌入。

### 新增 Store（P06: 5 个 + P07: 6 个）
- P06：`business-audit.ts`（派生自内核 audit store）/ `business-audit-types.ts` / `business-causal.ts` / `decision-support.ts`（LLM 分析）/ `audit-export.ts`
- P07：`export-types.ts` / `export-store.ts` / `export-renderers.ts`（4 渲染器）/ `export-field-mapping.ts`（业务化字段映射，复用 P02）/ `export-job-store.ts`（后台任务）

### 新增组件
- P06（`src/lib/views/Audit/` + `TimeTravel/`）：BusinessAuditView（包装内核 AuditView）/ AuditTimeline / AuditEntryCard / CausalGraph / DecisionSupportPanel / RollbackButton / BusinessTimeTravel（包装内核 ttd）/ TermOverlay
- P07（`src/lib/views/Export/`）：ExportDialog / ExportContentSelector / ExportFilterPanel / ExportFormatSelector / ExportTemplatePanel / ExportIntegrityToggle / ExportPreview / ExportProgressBar / ExportButton + `src/routes/export/+page.svelte`

### 核心逻辑
- **包装模式**：`{#if developerMode}<AuditView />{:else}业务化 UI{/if}`
- **业务化转换**：`toBusinessAuditEntry(fact, terms)` 转"谁/何时/做了什么/触发了什么"
- **ttd 5 视图业务化**：CSS overlay 叠加 TermOverlay（不修改内核 ttd）
- **4 渲染器**：共享 ExportContent 中间态，各格式独立渲染；PDF 用服务端渲染（P0 唯一新后端端点）
- **BLAKE3 嵌入**：所有导出文件含 integrity 段
- **大文件流式**：> 5000 条自动后台任务 + SSE 进度

### 验收标准
- [ ] BLAKE3 审计链业务化展示
- [ ] 因果链业务化 + 术语高亮
- [ ] ttd 5 视图业务化包装 + 开发者模式 toggle
- [ ] 决策支持 LLM 分析
- [ ] 一键回滚
- [ ] 4 格式导出 + BLAKE3 完整性嵌入
- [ ] 3 预置模板 + 用户自定义
- [ ] 5 维筛选 + 业务化字段
- [ ] 大文件流式导出
- [ ] 3 个入口统一弹窗

---

## T5：协作 + 导入导出 + 任务流 + UX 收尾（P08 + P09 + P10 + P11 缺口 3/4/5）

**交付目标**：5 角色协作 + 模板市场 + 6 任务流 + 在线 demo 部署 + UX 缺口完整修复。

### 新增 Store
- P08（9 个）：`auth.ts` / `permission-matrix.ts` / `workspace-members.ts` / `publish-queue.ts` / `production-audit.ts` / `comments.ts` / `notifications.ts` / `edit-lock.ts` / `activity-log.ts`
- P09（10 个）：`format-converter.ts`（6 格式）/ `import-export-types.ts` / `rule-import-export.ts` / `dataset-import-export.ts` / `form-import-export.ts` / `library-schema-import.ts` / `marketplace.ts` / `ruleset-types.ts` / `ruleset-import.ts` / `import-snapshot.ts`
- P10（7 个）：`task-flow-types.ts` / `task-flow.ts` / `task-history-types.ts` / `task-history.ts` + `src/lib/data/task-flows.ts`（6 TaskFlow）/ `guided-tasks.ts`（4 引导任务）/ `demo-medical.ts` / `demo-finance.ts` + `src/lib/backend/mock-backend.ts`
- P11（2 个）：`view-mode.ts` / `guided-task-progress.ts`

### 新增组件
- P08：LoginForm / UserMenu / NotificationBell / WorkspaceSwitcher / CommentThread / ReviewActions / PublishQueueList / VersionHistory / ActivityLogView + `src/routes/audit/+page.svelte`
- P09：ImportExportPage / ImportTab / ExportTab / MarketplaceTab / ConflictResolver / BatchExportDialog / MarketplaceCard / RulesetImporter + `src/routes/import-export/+page.svelte` + `src/routes/marketplace/+page.svelte`
- P10：TaskFlowWizard / TaskFlowDropdown / TaskHistoryView / GuidedTasks（增强）+ `.github/workflows/deploy-demo.yml`
- P11：GuidedHint / OnboardingBanner / DecisionMakerView

### 修改文件
- `src/routes/+layout.svelte` — 加 NotificationBell + UserMenu
- `src/lib/views/Home/RealWorkbench.svelte` — 加 TaskFlowDropdown + viewMode toggle + DecisionMakerView
- `src/lib/views/Home/DemoHome.svelte` — demo 打磨
- `README.md` — 顶部"给决策者"章节
- P01-P09 各视图 — 横向贯穿加 Toast + EmptyState + GuidedHint

### 验收标准
- [ ] 5 角色登录 + 权限矩阵正确
- [ ] 协作：成员管理 + 评论 + 通知 + 编辑锁 + 活动日志
- [ ] 发布队列 + 版本历史 + 回滚
- [ ] 6 格式转换器互转
- [ ] 4 类对象导入导出 + 批量 ZIP + 冲突 4 策略
- [ ] 模板市场 + ruleset.json 导入
- [ ] 导入前快照 + 回滚
- [ ] 6 TaskFlow 跑通 + 上下文保留
- [ ] 4 demo 引导任务 + MockBackend
- [ ] GitHub Pages 部署 + README 决策者入口
- [ ] GuidedHint + OnboardingBanner + DecisionMakerView
- [ ] demo 打磨

---

## 风险评估

| 等级 | 风险 | 应对 |
|---|---|---|
| 高 | 内核不修改约束 | 严格"包装优于继承"；业务化层全在 console-cloud |
| 高 | adapter-static 无后端场景 | MockBackend 实现 ExecutionBackend；SSE 用 setTimeout；WebSocket 用 BroadcastChannel |
| 高 | P08 后端 API 是 P1+ | P0 前端 mock + localStorage；预留 API 契约 |
| 中 | localStorage 容量 | 缓存 LRU 100 条；Fact 环形缓冲 1000 条；大文件走后端 |
| 中 | LLM 输出不确定性 | 三层降级：LLM → 本地解释器 → raw JSON |
| 中 | 虚拟列表性能 | 自实现轻量 VirtualList；只渲染可视区域 |
| 中 | ttd 不改内核 | CSS overlay 叠加（pointer-events: none） |

---

## 验证策略

### 每梯队交付前必跑
```bash
npm run check && npx vitest run && npm run test && npm run build
```

### 各梯队验证重点
| 梯队 | 单元测试 | E2E | 手动验证 |
|---|---|---|---|
| T1 | store CRUD + 派生 + 路由守卫 | 状态机 + Toast/EmptyState | 状态切换 + DevTools |
| T2 | 双向转换器(≥95%) + 6 操作符 + 术语匹配 | 5 步建库 + LLM + 降级 | 真实 LLM 联调 |
| T3 | dataset 状态机 + json-patch + SSE 类型 | 数据集 + 事件 + 13 按钮 + U7 | evorule-server 联调 |
| T4 | 4 渲染器 + 业务化转换 + BLAKE3 | 审计 + 时间旅行 + 导出 + 回滚 | verify-audit-export CLI |
| T5 | 权限矩阵 + 6 格式 + 6 TaskFlow + MockBackend | 5 角色 + 协作 + 任务流 + 决策者 | GitHub Pages 在线 demo |

### P0 总验收（T5 完成后）
完整 11 步功能流跑通：建库 → 加规则 → 整理 → 组合数据集 → 导入运行 → 看运行时 → 看指标 → 处理运行时 → 查看结果 → 导出 → 回放审计。

---

## 关键文件

**需修改**（跨梯队）：
- `src/routes/+page.svelte` — T1 改为 HomeRouter
- `src/routes/+layout.svelte` — T1 加 Toast + T5 加 NotificationBell/UserMenu

**复用基础**（只读）：
- 内核 `@evorule/console`：rules store / session / audit / 5 视图 / RuleValidator
- `src/lib/assistant/cloud-llm-assistant.ts` — LLM 三方法
- `src/lib/backend/cloud-http-backend.ts` — ExecutionBackend 接口契约

**设计文档**（实施依据）：
- `docs/HOME_DESIGN.md`（T1）
- `docs/P01_BUILD_SCHEMA_DESIGN.md` + `docs/P02_BUSINESS_LANGUAGE_V0_DESIGN.md`（T2）
- `docs/P03_DATASET_DESIGN.md` + `docs/P04_BUSINESS_EXECUTION_PAD_DESIGN.md` + `docs/P05_MONITOR_DASHBOARD_DESIGN.md`（T3）
- `docs/P06_BUSINESS_AUDIT_TT_DESIGN.md` + `docs/P07_RESULT_EXPORT_DESIGN.md`（T4）
- `docs/P08_COLLAB_WORKFLOW_DESIGN.md` + `docs/P09_IMPORT_EXPORT_INFRA_DESIGN.md` + `docs/P10_TASKFLOW_DEMO_DESIGN.md` + `docs/P11_UX_GAPS_FIX_DESIGN.md`（T5）
