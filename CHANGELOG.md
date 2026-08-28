# 变更记录

本文档记录 evorule-console-cloud 所有版本变更。

> **发版治理规则**：大众版开发完成后**不立即发版**，必须经过反复人工测试，才 tag v0.1.0 + push 到 Gitee 公开仓。开发期（Phase 1-7）本地 commit 保留版本控制，**不 push** 到 Gitee。

---

## [Unreleased]

### 变更

#### 旁路 store 收敛（凭据闭环 + 审批单通道化）

清偿规则写入链路适配专项登记的第三项债务：三条旁路 store（publish-queue-api / production-state / production-audit）直连 server 端点、不带凭据、与 WorkspaceBackend 职责重叠，且发布审批存在"server 通道 + localStorage 本地状态机"双通道并存（规划文档：`planning/脱离console.txt` §2.3）。

**凭据通道闭环**

- `NetConfig` 新增 `authToken` 字段（localStorage 持久化，与 mode/baseUrl 同级）+ 设置面板输入项（密码型、失焦自动保存，代码注释与 UI 提示明示本机存储的 XSS 面）
- `CloudHttpBackend`：审批/回滚两个自建 fetch 写方法携带 `Authorization: Bearer` 头；读方法（生产状态/发布队列/版本历史）统一委托内核 `WorkspaceBackend`（自带凭据）
- `CloudWorkspaceBackend`：`authToken` 接线传入内核 `HttpWorkspaceBackend`（闭合盘点发现的 A1 缺口：内核支持但组合层未传）
- `+layout.svelte`：从 netConfig 读 token 注入两个 backend，netConfig 变化时随 `reconfigure` 同步（实例引用不变）

**直连旁路与双通道收敛**

- 删除 `stores/publish-queue-api.ts` 与 `production-state.ts` 的直连 fetch；`production-state.ts` 收敛为纯响应式缓存，`MonitorDashboard` 改经 `backend.getProductionState()`（SSE 行为不变）
- 删除 `stores/publish-queue.ts`（localStorage 本地发布状态机）与 `ReviewActions.svelte`（死代码）：审批链路单通道走 server（SQLite 持久化），DecisionMaker 待审数与队列页同源；离线演示数据由 `MockBackend` 既有 5 个 cloud 方法承接（不持久化，明示）
- `production-audit` 的 localStorage 版本历史废弃，统一 server 通道（`backend.getProductionAudit()`）

**类型收敛**

- 新增 `$lib/backend/production-views.ts`：`ProductionState` / `PublishQueueItemView` / `VersionHistoryEntry` / `roleToBackend` 及三个映射函数的单一出处；视图层 import 全部改指 backend 层

**测试**

- 重写 `production-state.test.ts`（14 用例：映射 + status 推导 + `CloudHttpBackend.getProductionState` 委托/降级集成）
- 新增 `production-views.test.ts`（8 用例：角色映射/队列项映射/审计事件过滤）与 `cloud-http-backend.test.ts`（10 用例：读委托/未注入如实抛错/写方法请求体与 Bearer 头断言）
- 移除引用已删模块的 2 个旧测试文件（`publish-queue-api.test.ts` / `production-audit-api.test.ts`），有效用例已迁移

**登记上游债务**

- 内核 `HttpBackend`（执行侧会话 API）无 token 概念，会话/审计/时间旅行端点不校验凭据（A3）：属内核快照级缺口，按项目规则对照上游（gitee evo-rule-lab/evorule-console）另立专项处理，本仓不改快照
- 内核 `WorkspaceBackend.reviewPublish` / `emergencyRollback` 硬编码操作者身份，会丢失 UI 传入的审批者与角色：cloud 暂以自建 fetch（带凭据）承接，待内核开放身份参数后收敛

#### 一键启动脚本：清偿"已知限制"（README-STARTUP.md）

- `start-all.ps1`：新增 `-Quiet` / `-NoBrowser` 参数（无人值守，不卡 `Read-Host`）；启动失败/端口超时自动回滚本次拉起的进程树（`taskkill /T` 连子进程，只动本次启动的，不碰既有实例）；三服务 stdout/stderr 统一重定向到 `logs\`（不再落根目录）
- `start-all.ps1`：修复 evorule-server 裸起无法监听既定端口的既有缺陷——默认按兄弟目录推导 `--rules-dir`/`--core-eval`/`--service-registry`/`--allowed-origins` 参数组，支持 `EVORULE_SERVER_ARGS` / `EVORULE_RULE_ARGS` 环境变量整体覆盖（公开仓不硬编码管理员凭据，evorule-rule 首次引导走环境变量追加）
- 修复启动脚本端口不一致：evorule-server 绑 18090 而前端 `DEFAULT_LOCAL_BASE_URL` 探测 18080，页面报"服务不可用"；统一到 18080（start-all / stop-all / status-all / README 同步）
- 修复端口检测误报：vite 默认只绑 `::1`（Node 17+ localhost 解析），TcpClient 默认 IPv4 地址族探测必失败、Test-NetConnection 对 refused 场景每次耗时数秒拖垮 Wait-Port 轮询；统一改查 `Get-NetTCPConnection` 监听表（毫秒级、双栈皆准），`WEB_URL` 用 localhost 而非 127.0.0.1
- 新增 `status-all.ps1`：三服务健康检查；`-AutoRestart` 只拉起死掉的服务（复用 start-all 幂等语义）
- 新增 `register-watchdog.ps1` / `unregister-watchdog.ps1`：Windows 计划任务看门狗（每 5 分钟 `status-all -AutoRestart -Quiet`），服务异常退出自动恢复，进程由任务计划程序启动、脱离终端会话生命周期
- `stop-all.ps1`：新增 `-Quiet`（自动化调用不卡输入）
- `scripts/dev.mjs`：支持 `--yes` / `EVORULE_DEV_YES=1` 跳过端口占用交互确认（修复经 Start-Process 隐藏窗口启动时 stdin 仍为 TTY 导致确认挂起的缺陷）；`--yes` 不透传给 vite
- 修复全部启动脚本的编码缺陷：重写后为无 BOM UTF-8，PS 5.1 按 ANSI/GBK 误读中文注释、奇数字节序列吞并后续引号导致解析错误；统一转为 UTF-8 with BOM
- 回滚升级为**部分保活续启**：失败时已就绪的服务保持运行，只停止"本次拉起但未就绪"的进程树；修复后重跑 start-all.bat 续启（幂等跳过已运行的）
- 日志轮转策略：每次拉起服务前当前日志转存 `*.prev`（旧 `.prev` 删除），任意时刻只保留"本轮 + 上一轮"两份，容量有界，无需手动清理或后台任务
- `README-STARTUP.md`：日志位置与轮转策略、健康检查/看门狗用法、后端参数环境变量覆盖；"已知限制"五项全部解决（修复期间曾因无编码参数的文本替换产生 mojibake，已整文件重写修复）

#### 规则写入链路适配（WorkspaceBackend 落地）

内核依赖内联后遗留的 v0.1.1 API 调用债务全部清偿，规则写入链路对齐内核 v0.2.0 workspace 化架构（规划文档：`docs/planning/2026-08-27-workspace-write-chain.md`）。

**基础设施**

- 补齐内核快照：`http-workspace-backend.ts`、`workspace-context.ts`（含 barrel 导出）
- 新增 `MockWorkspaceBackend`：内存实现 WorkspaceBackend 全部 36 方法，含规则状态机（draft→candidate→active→blocked→archived）与版本 supersession；只读侧（沙盒/发布审批/转译/判定契约）不臆造语义，如实抛错提示连接 evorule-server；头部明示"离线演示数据不持久化"
- 新增 `CloudWorkspaceBackend`：联网/离线双模式组合（online/offline → HttpWorkspaceBackend，noServer → Mock），与 `CloudHttpBackend` 同构，`reconfigure()` 实例不变
- 新增模块级单例 `setActiveWorkspaceBackend` / `getActiveWorkspaceBackend`：供 store 层非组件调用点取用（Svelte 5 的 getContext 仅限组件初始化期，事件处理器/store 模块内调用会抛 lifecycle_outside_component）
- `+layout.svelte`：`provideWorkspaceBackend` 双注入 + 模块级单例登记 + 启动引导（refreshWorkspaces → ensureDefaultWorkspace → seedBuiltinRules → refreshRules），失败如实提示不静默

**链路适配（v0.1.1 → v0.2.0 API）**

- 建库向导：`loadTemplate` / `StepFirstRule` 改异步 `addRule(backend, workspaceId, req)`
- LLM 草案：`DraftRuleDialog` 采用动作走 `createRule`，含 workspace 缺失与写入失败的明示报错
- 三个导入链路：`ruleset-import` / `rule-import-export` / `library-schema-import` 改 `await importRule(...)`；冲突检测从 `Rule.id` 改按 `Rule.name` 匹配（v0.2.0 中 id 为 server ULID，业务标识移至 name）
- `BusinessRuleLibrary`：`updateRule` 4 参（仅 content，description 无更新通道时 toast 明示）；`selectRule` 带 backend + content 懒加载；开发者模式占位（内核 `RuleLibraryView` v0.2.0 已弃用为 /workspace 重定向壳，JSON 直接编辑待 workspace 视图专项补齐）
- `Rule.source` 字段清理（v0.2.0 移除）：内置只读判定改走 `isRuleReadonly`（`rule-filter` / `RulePicker` / `BusinessRuleCard`）
- 严格性修复：`Rule.content` 懒加载可空处理（`assemble-ruleset` / `impact-preview` / `DatasetPreview` / `ParamOverrideEditor` / `ExplainRuleDialog`，未加载时如实跳过/报错，不静默）；`Rule.description` 可空处理

**测试与验证**

- 重写 `db-and-templates.test.ts`（31 测试）：注入 MockWorkspaceBackend 测真实异步语义
- 修复 `ruleset-import.test.ts`（15 测试）：await 语义 + skip/rename 策略按 name 匹配重新断言
- 修复 `impact-preview.test.ts` / `assemble-ruleset.test.ts`：Rule 构造对齐 v0.2.0 形状
- 回归基线：svelte-check 0 errors、vitest 904/904 全绿、`npm run build` 通过

**登记债务（后续专项）**

- `BusinessRuleLibrary` 开发者模式 JSON 直接编辑待补（内核视图弃用后暂以占位提示）
- `updateRule` 的 description 更新通道缺失（内核 `updateRuleContent` API 不支持，UI 已明示）
- publish-queue-api / production-state / production-audit 三个 store 直连 server 端点，与 WorkspaceBackend 职责重叠，待收敛（**已于 2026-08-28「旁路 store 收敛」专项闭合，见上**）

#### 内核依赖内联（解除 npm 依赖）

- 移除 `@evorule/console` npm 依赖（原 git URL / `file:` 双轨，lockfile 长期漂移）
- 内核（evorule-console v0.2.0）实际使用的依赖闭包以源码快照内联到 `src/lib/kernel/`（41 文件，入口 `index.ts`，导出面与内核包对齐）
- 全仓 62 个文件的 import 从 `@evorule/console` 改指 `$lib/kernel`，渲染行为不变
- `verify.test.ts` 改为验证本地快照导入（CONSOLE_VERSION=0.2.0）
- 文档同步：README / NOTICE / DUAL_LICENSE / CLA / RELEASE_PROCESS / CONTRIBUTING

> 规划中：v0.2.0 本地 LLM（L2）付费扩展 + 依社区反馈优化迭代。

---

## [0.1.0] - 2026-08-26

> 首发占位版：联网大众版（内核 + 联网 + 云 LLM）。开发期（Phase 1-7）完成，自动化测试全绿（svelte-check 0/0 + vitest 904/904 + playwright 64/64），发版治理文件齐全，用户人工验收通过。

### 新增

#### Phase 1：项目骨架 + 依赖内核

- 基于 SvelteKit 5 + Svelte 5（runes 模式）建仓
- 经 `@evorule/console` v0.1.1 依赖（开发期 `file:` 路径，发版后切 git URL）
- 5 视图渲染（规则库 / 执行台 / 状态 / 审计 / 时间旅行）
- 顶部品牌标识：`evorule-console-cloud` / `大众版 · 内核 vX.Y.Z · 联网 + 云 LLM`
- adapter-static 静态构建支持
- `verify.test.ts`：内核导入通路验证（CONSOLE_VERSION + 所有导出）

#### Phase 2：联网扩展（CloudHttpBackend）

- `CloudHttpBackend`：继承内核 HttpBackend，支持 `mode: 'online' | 'offline'` 双模式
- `reconfigure()` 方法：切换 baseUrl 时实例不变，视图自动用新地址
- `net-config` store：联网模式 + 远程 URL + localStorage 持久化
- 顶部联网切换徽标（快捷切换 + 显示当前模式）
- 联网配置面板（在 Settings 内）

#### Phase 3+4：LLM 抽象 + CloudLlmAssistant

- `LlmAssistant` 接口：继承内核 `AssistantProvider` 三方法 + 大众版独有 `isConfigured()` + `testConnection()`
- `CloudLlmConfig` 类型：enabled + provider + apiEndpoint + apiKey + model
- `llm-config` store：localStorage 持久化
- `llm-context.ts`：转发到内核 `provideAssistant()` 扩展槽
- `CloudLlmAssistant` 实现：
  - OpenAI 兼容 `/v1/chat/completions` 协议
  - 三方法：`generateRuleDraft` / `explainRule` / `generateInput`
  - 草案经内核 `RuleValidator` 校验（confidence 0.7/0.3/0 分级）
  - apiKey 安全：不进 prompt / 不进日志 / 不进 error.message
- `llm-fetch.ts`：错误处理（网络/401/429/JSON 解析失败）+ apiKey 脱敏
- `prompts.ts`：三用途 prompt 模板（强约束输出纯 JSON）
- 单测：mock fetch 三方法 happy path + 各错误场景 + apiKey 不泄露断言

#### Phase 5：LLM 三用途 UI

- `DraftRuleDialog`：自然语言 → 草案 → 校验 → 采用/放弃
- `ExplainRuleDialog`：JSON 规则 → 自然语言说明（只读）
- `GenerateInputDialog`：自然语言 → 测试输入 JSON → 采用并复制到剪贴板
- 加载状态 + 错误提示 + 重试机制
- Escape 键关闭 Dialog
- **用户审核确认**：LLM 草案/输入必须用户点“采用”才生效（不自动执行）
- e2e：mock LLM API 完整流程（assistant-flow.spec.ts）

#### Phase 6：LLM 配置面板

- `llm-presets.ts`：6 个厂商预设
  - 智谱 GLM（推荐，有免费额度，`/v4/chat/completions`）
  - 通义千问（阿里云，`/compatible-mode/v1/chat/completions`）
  - DeepSeek（性价比高）
  - OpenAI（国际标准，需代理）
  - 文心一言（暂不兼容，标记 `needsAdapter`，disabled）
  - 自定义（用户自填 endpoint）
- `LlmSettings.svelte`：
  - 启用开关（关闭时行为与内核一致）
  - 厂商预设下拉（自动填 endpoint + model）
  - apiEndpoint 输入（可手动改）
  - apiKey 密码框（默认隐藏，眼睛图标切换显示）
  - model 下拉（预设提供选项）/ 输入框（自定义）
  - 测试连接按钮（调 `testConnection()` 验证）
  - 重置按钮（清空配置回默认）
  - L2 占位（“本地 LLM，付费扩展，敬请期待”）
- `Settings.svelte`：联网配置 + LLM 配置两 tab
- 导航 6 tab（5 视图 + 设置，设置 tab 视觉分隔）
- apiKey 安全：localStorage 明文 + UI 提示“key 存于本地，不上传”+ 不进 URL
- e2e：21 项设置面板测试（settings-flow.spec.ts）

#### Phase 7：L2 本地 LLM 规划文档

- L2 本地 LLM 规划：L0/L1/L2 三层矩阵 + LocalLlmAssistant 接口设计 + Ollama 集成方案 + GPU 配置面板设计 + 实施时机 + 与高级版边界 + 安全考量 + 验收标准
- README 标注 L2 为付费扩展规划（v0.2.0+）

### 验证

- `npm run check`：svelte-check **0 errors / 0 warnings**
- `npm run test:unit`：vitest **82/82 PASS**
  - verify.test.ts：10 项内核导入验证
  - types.test.ts：21 项类型/默认值
  - cloud-http-backend.test.ts：14 项双模式
  - llm-context.test.ts：4 项 provider 注入
  - cloud-llm-assistant.test.ts：33 项三方法 + 错误 + apiKey 安全
- `npm run test`：playwright **47/47 PASS**
  - navigation.spec.ts：20 项（导航 6 tab + 主题 + 联网徽标 + 持久化）
  - assistant-flow.spec.ts：6 项（LLM 关闭回归 + 三用途 + Escape）
  - settings-flow.spec.ts：21 项（联网 + LLM 配置 + apiKey 安全 + 持久化）
- `npm run build`：adapter-static 产出 `build/` 静态文件

### 全流程生产模式跑通里程碑（2026-08-03）

**evorule-console-cloud 第一次全流程生产模式跑通** — `npm run build` + `npm run preview` + 真实 LLM API 三用途 + evorule-server 真连接 + 真提交命令到 reactor + 主题切换 + 持久化，全部 8/8 测试步骤通过。

| #   | 测试步骤                                                   | 结果 | 关键数据                                                               |
| --- | ---------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| 1   | 读 LLM key + 启 chromium                                   | ✅   | key 35 字符                                                            |
| 2   | 注入 llm-config + net-config + 初始加载                    | ✅   | conn=已连接，AI 按钮=2                                                 |
| 3   | 5 视图导航（规则库/执行台/状态/审计/时间旅行）            | ✅   | 5 视图全加载                                                           |
| 4   | DraftRuleDialog 真实调 LLM 生成规则                        | ✅   | 1.8s / 989 字符 / RuleValidator confidence=0.7（高置信档）/ G1-G7 通过 |
| 5   | ExplainRuleDialog 真实调 LLM 解释规则                      | ✅   | 1.9s / 141 字符                                                        |
| 6   | GenerateInputDialog 真实调 LLM 生成测试输入 + 复制到剪贴板 | ✅   | 1.1s / 103 字符 / 剪贴板写入成功                                       |
| 7   | 真提交命令到 evorule-server reactor                        | ✅   | 提交 `{"type":"login",...}`                                            |
| 8   | 状态/审计 + 主题切换 + 持久化                              | ✅   | light→dark→reload→dark 持久化通过                                      |

**TOTAL：8/8 测试步骤通过，无浏览器控制台错误。**

### 踩坑与修复（全流程测试发现）

| 坑                         | 性质                                                        | 修复                                                                             |
| -------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **CORS 跨域阻断**          | evorule-server 默认严格同源，跨端口被拒                     | evorule-server 启动加 `--allowed-origins`；README 补充启动顺序说明               |
| **vite preview host 对齐** | `localhost` 与 `127.0.0.1` 是不同 origin                    | `net-config` 默认值改为 `http://localhost:18080`（与 vite dev/preview 默认对齐）|
| **空 sessions**            | evorule-server 启动后 sessions 为空，执行台 UI 不显示提交区 | 手动 `POST /api/sessions` 创建初始 session；README 补充说明                      |

### 发版治理文件齐全

11 项治理文件全部就绪：LICENSE / NOTICE.md / AUTHORS.md / CODE_OF_CONDUCT.md / CONTRIBUTING.md / SECURITY.md / TRADEMARK.md / CLA-individual.md / DUAL_LICENSE.md / COMMERCIAL_LICENSE.md / FREE_COMMERCIAL_LICENSE.md。详见 [RELEASE_PROCESS.md](./RELEASE_PROCESS.md)。

### 架构验证

#### LLM 不阻塞执行链路

关键约束：**LLM 是辅助层，不参与确定性执行**。

验证依据：

1. `ExecutionPad.svelte` `handleSubmit()` 调用 `submitCommand(backend, instruction)`，仅使用 `backend`（CloudHttpBackend），**不调用 LLM**
2. AI 按钮仅在用户显式点击 + Dialog 确认后才调用 LLM
3. LLM 调用失败时降级为“用户手动编辑 JSON”，不阻塞规则引擎工作
4. assistant-flow.spec.ts 验证：LLM 启用时不影响内核 5 视图回归（navigation 20/20 PASS）

#### 内核零修改

大众版不修改内核 `@evorule/console` 任何代码：

- 通过 `provideAssistant()` 扩展槽注入 LLM
- 通过 `provideBackend()` 注入 CloudHttpBackend
- 内核 `VIEW_LIST` 不变（5 视图），设置 tab 是大众版独有

### 已知限制

1. **配置变更需刷新页面**：LLM 配置修改后，因 Svelte context 必须在组件初始化期间同步设置，需 `location.reload()` 重新注入 provider（UX 提示已实现）
2. **文心一言不支持**：原生 API 与 OpenAI 协议有差异，v0.1.0 标记为 `needsAdapter`，后续版本增加适配层
3. **apiKey localStorage 明文**：大众版可接受，UI 已提示；高级版用 Tauri 加密（未来）
4. **L2 本地 LLM 未实现**：v0.1.0 仅含 L1 云 LLM，L2 为付费扩展规划（v0.2.0+）

### 人工测试验收清单

发版前需用户人工测试以下场景（自动化测试覆盖之外的 UX / 真实环境）：

- [x] 5 视图功能正常（规则库 / 执行台 / 状态 / 审计 / 时间旅行）
- [x] 联网切换：本地 ↔ 联网，远程 URL 输入，连接徽标反映状态
- [x] LLM 配置流程：选厂商 → 填 apiKey → 测试连接 → 保存
- [x] LLM 三用途：AI 辅助创建规则 / 解释规则 / 生成测试输入
- [x] LLM 关闭回归：禁用后行为与内核一致（AI 按钮不渲染）
- [x] 视图持久化 + 联网模式持久化 + LLM 配置持久化
- [x] 真实 LLM 调用：至少一个厂商（智谱/通义/DeepSeek/OpenAI）真实 API 调用成功

---

## 发版流程

```bash
# 1. 全部测试通过
npm run check && npm run test:unit && npm run test && npm run build

# 2. bump 版本(package.json: 0.0.1 → 0.1.0)
# 3. 更新 README 版本徽章
# 4. CHANGELOG 标记 v0.1.0 发版日期

# 5. 切换 package.json 依赖为 git URL
#    "@evorule/console": "git+https://gitee.com/evo-rule-lab/evorule-console.git#v0.1.1"

# 6. 提交 + tag + push(由用户决定时机)
git add -A
git commit -m "release(cloud): v0.1.0"
git tag -a v0.1.0 -m "evorule-console-cloud v0.1.0"
git push origin main
git push origin v0.1.0
```

---

## 修订记录

| 日期       | 修订内容                                |
| ---------- | --------------------------------------- |
| 2026-08-03 | 初版 CHANGELOG，记录 Phase 1-7 开发进度 |
