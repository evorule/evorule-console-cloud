<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# evorule-console-cloud

> evorule 规则引擎面板 · **联网大众版** — 二次开发者专业起点（内核 + 联网 + 云 LLM）

[![version](https://img.shields.io/badge/version-0.2.0-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-AGPL--3.0--or--later-success)](./LICENSE)
[![kernel](https://img.shields.io/badge/kernel-inlined%20from%20evorule--console%20v0.2.0-blueviolet)](https://gitee.com/evorule/evorule-console)

`evorule-console-cloud` 基于 evorule-console 内核快照（`src/lib/kernel/`，取自内核 v0.2.0）扩展：

- **联网**：可连接远程 evorule-server（非仅本地 loopback）
- **云 LLM 辅助**：OpenAI 兼容协议，多厂商预设（智谱/通义/DeepSeek/OpenAI），辅助生成规则草案/解释规则/生成测试输入
- **用户审核确认**：LLM 只生成草案，最终规则是用户审核的 JSON，不破坏 evorule「确定性执行」基调
- **本地 LLM（L2）**：规划中，付费扩展（v0.2.0+）

> **LLM 是辅助层，不参与确定性执行** — 执行链路完全不经过 LLM，规则即数据，用户审核才生效。

---

## 🚀 新用户从这里开始

- **[5 分钟跑起来（体验包路径）](./docs/tutorial/02-quickstart-package.md)** — 下载压缩包，解压即用，全截图跟做
- **[5 分钟上手（开发者路径）](./docs/tutorial/01-quickstart.md)** — 克隆仓 + dev 环境，从 0 到跑通第一条规则
- **[❓ 浏览器内帮助页](http://127.0.0.1:5174/help)** — 启服务后侧栏底部"❓ 帮助"按钮
- **[一键启停指南](./README-STARTUP.md)** — 桌面双击 / 命令行两种方式

---

## 给决策者（30 秒看懂）

> evorule 是 AI Agent 的「合规审计层」— 让 AI Agent 的每个决策可审计、可回放、可回滚。

### 为什么需要 evorule？

| 痛点 | evorule 解法 |
| --- | --- |
| AI Agent 决策不透明 | BLAKE3 哈希链，每个决策不可篡改可追溯 |
| 出问题无法定位根因 | 时间旅行回放 + 因果链分析，秒级定位 |
| 合规审计难通过 | 审计导出满足 EU AI Act Article 12 + 等保 2.0 三级 |
| 规则发布无管控 | 三级权限审批 + 滚动 session 热更新零停机 |

### 在线体验

**[在线 demo](https://evorule.github.io/evorule-console-cloud/)**（无需注册，医疗 + 财务两套场景，浏览器内 MockBackend 零网络依赖）

### 4 个引导任务（2-3 分钟体验完整链路）

1. **加规则**（2 分钟）：给医院加一条「65 岁以上发烧必须先 CT」规则
2. **查问题**（1 分钟）：定位病人 P-1283 为何触发异常告警
3. **改规则**（3 分钟）：把发烧阈值从 38°C 改为 37.5°C
4. **合规门禁**（2 分钟）：AI Agent 调用转账但未 MFA → 门禁阻断 + BLAKE3 留痕

### 场景示例规则（真实业务语义，可实测复现）

- **[合同条款校验](./docs/scenarios/01-contract-payment-guard.md)** — 付款前提缺失即阻断
- **[报销合规检查](./docs/scenarios/02-expense-compliance.md)** — 重复发票驳回；超标升级审批链
- **[设备巡检告警](./docs/scenarios/03-equipment-inspection.md)** — 阈值联动告警与升级上报
- **[AI 合规门禁](./docs/scenarios/04-ai-mfa-gate.md)** — AI Agent 未过 MFA 发起转账 → 阻断留痕

每条规则附两组对照输入与逐字段预期输出，3 分钟可复现一条。见 [场景示例总览](./docs/scenarios/README.md)。

### 核心能力

- **BLAKE3 不可篡改审计链**：每个 Fact 哈希链接，篡改即被发现
- **时间旅行回放**：回溯任意版本，diff 对比 + 因果链追溯
- **等保 2.0 三级门禁**：AI Agent 工具调用前合规检查（§8.1.4.1.d MFA / §8.1.4.7.b 加密）
- **合规报告导出**：6 种内容 × 4 种格式（JSON/CSV/XML/PDF），满足 EU AI Act
- **滚动 session 热更新**：规则集发布零停机，版本单调递增
- ✅ **协作审批工作流**：三级权限（admin/lead/auditor），规则发布需审批

---

## 定位

evorule-console-cloud 是 **evorule 全生态的唯一用户入口**（2026-08-30 生态裁定）：浏览器用户对 evorule 的一切操作——规则库、执行、审计、回放、审批——都收敛于此面板。同时它也是面向**二次开发者**的专业起点工具：开发者基于本仓构建自己的产品（功能各不相同，但起点一致）。

| 层级 | 仓 | 定位 | LLM | 网络 | 内核关系 |
| --- | --- | --- | --- | --- | --- |
| evorule-console（内核）| 独立 | 规则引擎面板内核，无智能只有执行 | ❌ 无 | ❌ 无（仅本地 HTTP）| 0（消费 evorule 核心）|
| **evorule-console-cloud（本仓）** | 独立 | 二次开发者专业起点 | 云 LLM | ✅ 联网 | 内核快照内联（`src/lib/kernel/`），无 npm 依赖 |
| 高级版 | 独立 | 保密行业定制 | 本地 GPU LLM | ✅ 联网/Tauri | 内核快照内联 |

本仓与内核仓各自独立 semver。内核以**源码快照**形式内联于 `src/lib/kernel/`，本仓可独立演进；内核仓仍是上游参考，快照的后续同步按需手动进行。

---

## 当前版本边界与 Roadmap

### 当前版本已支持（v0.2.0）

- 规则库视图离线可用（内置 demo 数据集 + 4 个引导任务）
- 执行台 / 状态 / 审计 / 时间旅行：连接 evorule-server 运行（支持本地 / 远程地址）
- 云 LLM 辅助三用途：创建规则草案 / 解释规则 / 生成测试输入（智谱 / 通义 / DeepSeek / OpenAI 预设）
- 联网模式切换（offline ↔ online）、视图选择、联网与 LLM 配置持久化
- apiKey 安全：仅存浏览器 localStorage，不进 URL / 日志 / 错误信息

### Roadmap（规划中，非承诺）

| 目标 | 版本 | 说明 |
| --- | --- | --- |
| 本地 LLM（L2）| v0.2.0+ | 付费扩展，本地 GPU LLM |
| 后续优化迭代 | 持续 | 依社区反馈完善 UI / 功能 / 文档 |

> 版本语义：`0.x` 为预发布系列，`v1.0.0` 对应功能完整。欢迎通过 [Issues](https://gitee.com/evorule/evorule-console-cloud/issues) 反馈需求与缺陷。

---

## 内核快照

本仓不通过 npm 依赖内核。内核（evorule-console v0.2.0）实际使用的依赖闭包以源码快照形式内联在 `src/lib/kernel/`：

- 入口：`src/lib/kernel/index.ts`（导出面与内核包对齐，省略未使用的模块）
- 内容：backend 抽象与类型、rules/session/audit/view stores、AssistantProvider 扩展槽、RuleValidator、执行台/状态/审计/时间旅行视图及 ttd 组件
- 边界：快照后与本仓一同独立演进；内核仓的后续修改**不会**自动同步，需手动对照

---

## 安装与使用

```bash
git clone https://gitee.com/evorule/evorule-console-cloud.git
cd evorule-console-cloud
npm install
npm run dev    # 开发者模式：http://localhost:5174（日常体验请用一键启动包，见下文）
```

> 规则库视图不需要后端，可离线试用；执行台/状态/审计/时间旅行需要 evorule-server 跑在 `localhost:18080`（联网模式可配远程）。

## GitHub Pages 在线 demo 部署

`.github/workflows/deploy-demo.yml` 在 `push` 到 `main` 分支时自动构建并部署到 GitHub Pages。

**首次启用步骤**：
1. 进入 GitHub 仓 → **Settings** → **Pages**
2. **Source** 选择 **GitHub Actions**（不是 “Deploy from a branch”）
3. 推一次 commit 到 main（或手动触发 workflow_dispatch）触发首次构建
4. 部署完成后，URL 形如 `https://<owner>.github.io/evorule-console-cloud/`

**特性**：adapter-static 全量预渲染 + MockBackend，浏览器内零网络依赖即可体验 4 个引导任务（医疗/财务两套 demo 数据集）。

---

## 本地开发（含 evorule-server 联调）

完整跑通执行台/状态/审计等视图需启动 evorule-server。**注意 CORS 配置**（关键踩坑，二选一）：

- **方案 A**（直连 + `--allowed-origins`）：evorule-server 启动时显式允许大众版 dev/preview 源（见下文启动顺序）。适用于 online 模式或生产部署。
- **方案 C**（vite proxy，零配置）：net-config 的 localBaseUrl 留空（同源），vite dev/preview 自动把 `/api` 代理到 `127.0.0.1:18080`（见 `vite.config.ts` 的 `server.proxy`）。仅适用于 offline 本地开发，无需配 server。

### 启动顺序

1. **启动 evorule-server**（带 CORS 允许大众版 dev/preview 源）——在 evorule-server 仓目录下（已构建 release 二进制）：

   ```bash
   target\release\evorule-server.exe --addr 127.0.0.1:18080 \
     --allowed-origins "http://localhost:5174,http://localhost:4173,http://127.0.0.1:5174,http://127.0.0.1:4173"
   ```

2. **启动大众版 dev server**——在本仓目录下：

   ```bash
   npm run dev    # http://localhost:5174
   ```

3. **创建初始 session**（让执行台 UI 显示提交区）：

   ```bash
   curl -X POST http://127.0.0.1:18080/api/sessions
   # → {"message":"Session created","session_id":1}
   ```

4. **浏览器打开**：`http://localhost:5174/`

### 生产预览模式

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

### 已知坑（必读）

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| **CORS 跨域** | evorule-server 默认严格同源，跨端口被拒 | 方案 A：启动时加 `--allowed-origins`；方案 C：net-config 的 localBaseUrl 留空（同源），vite proxy 自动代理 `/api` → `127.0.0.1:18080`（仅 dev/preview）|
| **host 对齐** | `localhost` 与 `127.0.0.1` 是不同 origin | 大众版 `net-config` 默认 `localhost:18080`（与 vite dev 对齐）；preview 用 `--host 127.0.0.1` 时需对应改 net-config |
| **端口占用** | e2e 测试后 `npm run dev` 报 `Port 5174 is in use` 或浏览器显示 “This site can't be reached” | `npm run clean && npm run dev`（清理僵尸进程）|
| **空 sessions** | evorule-server 启动后 sessions 为空，执行台 UI 不显示提交区 | 手动 `POST /api/sessions` 创建初始 session |

### LLM 配置

大众版 LLM apiKey **只**走浏览器 localStorage（`evorule-console-cloud:llm-config`），不读 .env。在设置面板 → LLM 配置 tab 中填写。

推荐使用**智谱 GLM-4-Flash**（有免费额度）：在 [智谱开放平台](https://open.bigmodel.cn/usercenter/apikeys) 获取 apiKey。

### 认证配置（EVORULE_AUTH_TOKEN）

evorule-server 开启认证后，工作台需要在**设置面板 → 联网配置 → 认证 Token** 中填入与 server 一致的 token（失焦自动保存，留空 = 请求不带凭据，仅免认证 server 可用）。全链路（执行侧会话 API、workspace 规则库、发布审批/回滚、生产状态/版本历史）统一携带 `Authorization: Bearer` 头。

server 侧两个 token 环境变量（详见 evorule-server README「环境变量 / CLI 参数」）：

| 环境变量 | 语义 |
| --- | --- |
| `EVORULE_AUTH_TOKEN` | 普通 Bearer token（浏览器用户身份）；**生产部署必须配置**——未配置时认证整体关闭，受保护域写入准入失效（dev 放行语义，见 dispositions AC-B5-S1） |
| `EVORULE_SERVICE_TOKEN` | service 身份 token（供服务间调用，如 evo-agent sidecar）；受保护域 `stable.llm.*` / `stable.system.*` 仅此身份可写，浏览器端**不应**使用 |

注意事项：

- token 保存在本机浏览器 localStorage（与 LLM apiKey 同级取舍），请勿在共享设备填写；如需更高保证，将大众版部署在与 server 同源的反代后面并限制访问
- 连接测试（设置面板「测试连接」）会带上当前输入的 token，可直接验证凭据是否有效
- server 开启认证而本端未填 token 时，接口返回 401——先检查两侧 token 是否一致

---

## 测试

完整测试说明（环境准备 → 4 种自动化测试 → evorule-server 联调 → LLM 联调 → 排查常见问题）见 **[CONTRIBUTING.md §测试要求](./CONTRIBUTING.md)**。

**快速跑全测试**（提 PR 前必须全绿）：

```bash
npm run check && npx vitest run && npm run test && npm run build
```

| 测试 | 命令 | 当前通过数 |
| --- | --- | --- |
| 类型检查 | `npm run check` | 0 errors / 0 warnings |
| 单元测试 | `npx vitest run` | 904/904 |
| e2e 测试 | `npm run test` | 64/64 |
| 生产构建 | `npm run build` | ✅ build/ |

> **e2e 首次跑需先装浏览器**：`npx playwright install chromium`
> **e2e 为什么 `workers: 1`？** 见 [CONTRIBUTING.md §e2e 测试](./CONTRIBUTING.md)

---

## 验证

```bash
npm run verify     # vitest:验证 $lib/kernel 快照导入通路(CONSOLE_VERSION=0.2.0 + 所有导出可用)
npm run check      # svelte-check:0 errors / 0 warnings
npm run test:unit  # vitest:单元测试(assistant + backend + types)
npm run test       # playwright:e2e(navigation + assistant-flow + settings-flow)
npm run build      # adapter-static:产出静态文件到 build/
```

---

## 技术栈

- SvelteKit 5 + Svelte 5（runes 模式）— 与内核对齐
- TypeScript（strict）
- Vite + adapter-static
- vitest（单元测试 + 导入验证）+ playwright（e2e）
- 内核快照 `src/lib/kernel/`（取自 evorule-console v0.2.0）

---

## 目录结构

```
evorule-console-cloud/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte     # 根布局:三栏(Docker 风格左侧栏 + 主内容 + 右 LLM 侧栏)+ 路由守卫
│   │   └── +page.svelte       # 视图容器:根据 currentView 渲染各视图
│   ├── lib/
│   │   ├── backend/           # CloudHttpBackend(联网/离线双模式)
│   │   ├── assistant/         # CloudLlmAssistant + llm-fetch + prompts + types
│   │   ├── config/            # net-config + llm-config + llm-presets(厂商预设)
│   │   ├── data/              # demo 数据集 + 模板 + 引导任务
│   │   ├── governance/        # 治理后端 + store(发布/审批/审计)
│   │   ├── stores/            # 跨视图共享状态(会话/数据集/导出/规则库/设置等)
│   │   └── views/             # 20+ 视图组件(规则库/执行台/审计/设置/…)
│   ├── app.css                # 设计令牌(与内核对齐,深色主题)
│   └── verify.test.ts         # 导入验证(vitest)
├── tests/                     # playwright e2e(navigation + assistant-flow + settings-flow + 回归)
├── docs/                      # 公开文档(Diátaxis 四类 + ADR)
├── package.json               # 依赖声明(内核已内联,无 npm 内核依赖)
├── svelte.config.js           # adapter-static
├── vite.config.ts             # port 5174
└── README.md(本文件)
```

---

## 许可与治理

**AGPL-3.0-or-later** + 商业双许可 — 详见 [LICENSE](./LICENSE) / [DUAL_LICENSE.md](./DUAL_LICENSE.md)。

| 文件 | 说明 |
| --- | --- |
| [NOTICE.md](./NOTICE.md) | 声明（与 evorule-console 内核的关系）|
| [CHANGELOG.md](./CHANGELOG.md) | 变更记录 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南（含核心原则 + 禁止事项）|
| [SECURITY.md](./SECURITY.md) | 安全政策（含 LLM apiKey 安全设计）|
| [RELEASE_PROCESS.md](./RELEASE_PROCESS.md) | 发布流程 |
| [AUTHORS.md](./AUTHORS.md) | 作者 |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | 贡献者公约 |
| [TRADEMARK.md](./TRADEMARK.md) | 商标政策 |
| [CLA-individual.md](./CLA-individual.md) | 个人贡献者许可协议 |
| [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md) | 商业许可 |
| [FREE_COMMERCIAL_LICENSE.md](./FREE_COMMERCIAL_LICENSE.md) | 免费商业豁免资格 |

---

Copyright (C) 2026 EvoRule Project. All rights reserved.
