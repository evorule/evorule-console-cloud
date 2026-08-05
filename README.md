<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# evorule-console-cloud

> evorule 规则引擎面板 · **联网大众版** — 二次开发者专业起点（内核 + 联网 + 云 LLM）

[![version](https://img.shields.io/badge/version-0.0.1--dev-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-AGPL--3.0--or--later-success)](./LICENSE)
[![kernel](https://img.shields.io/badge/kernel-@evorule/console%20v0.1.1-blueviolet)](https://gitee.com/evo-rule-lab/evorule-console)

`evorule-console-cloud` 在 [`@evorule/console`](https://gitee.com/evo-rule-lab/evorule-console) 内核基础上扩展:

- ☁️ **联网**:可连接远程 evorule-server(非仅本地 loopback)
- ✨ **云 LLM 辅助**:OpenAI 兼容协议,多厂商预设(智谱/通义/DeepSeek/OpenAI),辅助生成规则草案/解释规则/生成测试输入
- 🎯 **用户审核确认**:LLM 只生成草案,最终规则是用户审核的 JSON,不破坏 evorule「确定性执行」基调
- 🖥️ **本地 LLM(L2)**:规划中,付费扩展,详见 [L2 规划文档](./docs/L2_LOCAL_LLM_PLAN.md)

> **LLM 是辅助层,不参与确定性执行** — 执行链路完全不经过 LLM,规则即数据,用户审核才生效。

---

## 定位

evorule-console-cloud 是面向**二次开发者**的专业起点工具。开发者基于本仓构建自己的产品（功能各不相同，但起点一致）。

| 层级 | 仓 | 定位 | LLM | 网络 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| evorule-console（内核） | 独立 | 规则引擎面板内核，无智能只有执行 | ❌ 无 | ❌ 无（仅本地 HTTP） | 0（消费 evorule 核心） |
| **evorule-console-cloud（本仓）** | 独立 | 二次开发者专业起点 | ☁️ 云 LLM | ✅ 联网 | `npm i @evorule/console` |
| 高级版 | 独立 | 保密行业定制 | 🖥️ 本地 GPU LLM | ✅ 联网/Tauri | `npm i @evorule/console` |

三仓各自独立 semver,通过 npm 依赖松绑。**起点必须一致，功能各不相同。**

---

## 依赖内核

大众版经 git URL 依赖内核(发版 tag 时强制提交 `dist/`,无需本地 prepack):

```json
{
  "dependencies": {
    "@evorule/console": "git+https://gitee.com/evo-rule-lab/evorule-console.git#v0.1.1"
  }
}
```

---

## 安装与使用

```bash
git clone https://gitee.com/evo-rule-lab/evorule-console-cloud.git
cd evorule-console-cloud
npm install
npm run dev    # 访问 http://localhost:5174
```

> 规则库视图不需要后端,可离线试用;执行台/状态/审计/时间旅行需要 evorule-server 跑在 `localhost:18080`(联网模式可配远程)。

---

## 本地开发（含 evorule-server 联调）

完整跑通执行台/状态/审计等视图需启动 evorule-server。**注意 CORS 配置**（关键踩坑,二选一）：

- **方案 A**（直连 + `--allowed-origins`）：evorule-server 启动时显式允许大众版 dev/preview 源（见下文启动顺序）。适用于 online 模式或生产部署。
- **方案 C**（vite proxy,零配置）：net-config 的 localBaseUrl 留空（同源），vite dev/preview 自动把 `/api` 代理到 `127.0.0.1:18080`（见 `vite.config.ts` 的 `server.proxy`）。仅适用于 offline 本地开发,无需配 server。

### 启动顺序

1. **启动 evorule-server**（带 CORS 允许大众版 dev/preview 源）:

   ```bash
   cd D:\evorule-server
   target\release\evorule-server.exe --addr 127.0.0.1:18080 \
     --allowed-origins "http://localhost:5174,http://localhost:4173,http://127.0.0.1:5174,http://127.0.0.1:4173"
   ```

2. **启动大众版 dev server**:

   ```bash
   cd D:\evorule-console-cloud
   npm run dev    # http://localhost:5174
   ```

3. **创建初始 session**（让执行台 UI 显示提交区）:

   ```bash
   curl -X POST http://127.0.0.1:18080/api/sessions
   # → {"message":"Session created","session_id":1}
   ```

4. **浏览器打开**: `http://localhost:5174/`

### 生产预览模式

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

### 已知坑（必读）

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| **CORS 跨域** | evorule-server 默认严格同源，跨端口被拒 | 方案 A：启动时加 `--allowed-origins`；方案 C：net-config 的 localBaseUrl 留空（同源），vite proxy 自动代理 `/api` → `127.0.0.1:18080`（仅 dev/preview） |
| **host 对齐** | `localhost` 与 `127.0.0.1` 是不同 origin | 大众版 `net-config` 默认 `localhost:18080`（与 vite dev 对齐）；preview 用 `--host 127.0.0.1` 时需对应改 net-config |
| **端口占用** | e2e 测试后 `npm run dev` 报 `Port 5174 is in use` 或浏览器显示 "This site can't be reached" | `npm run clean && npm run dev`（清理僵尸进程） |
| **空 sessions** | evorule-server 启动后 sessions 为空，执行台 UI 不显示提交区 | 手动 `POST /api/sessions` 创建初始 session |

### LLM 配置

大众版 LLM apiKey **只**走浏览器 localStorage（`evorule-console-cloud:llm-config`），不读 .env。在设置面板 → LLM 配置 tab 中填写。

推荐使用**智谱 GLM-4-Flash**（有免费额度）：在 [智谱开放平台](https://open.bigmodel.cn/usercenter/apikeys) 获取 apiKey。

---

## 测试

完整的测试指南（环境准备 → 4 种自动化测试 → evorule-server 联调 → LLM 联调 → 排查常见问题）见 **[docs/TESTING.md](./docs/TESTING.md)**。

**快速跑全测试**（提 PR 前必须全绿）：

```bash
npm run check && npx vitest run && npm run test && npm run build
```

| 测试 | 命令 | 当前通过数 |
| --- | --- | --- |
| 类型检查 | `npm run check` | 0 errors / 0 warnings |
| 单元测试 | `npx vitest run` | 82/82 |
| e2e 测试 | `npm run test` | 47/47 |
| 生产构建 | `npm run build` | ✔ build/ |

> **e2e 首次跑需先装浏览器**：`npx playwright install chromium`
> **e2e 为什么 `workers: 1`？** 见 [TESTING.md §4.3](./docs/TESTING.md#43-为什么-workers-1)

---

## 验证

```bash
npm run verify     # vitest:验证 @evorule/console 导入通路(CONSOLE_VERSION=0.1.1 + 所有导出可用)
npm run check      # svelte-check:0 errors / 0 warnings
npm run test:unit  # vitest:单元测试(assistant + backend + types)
npm run test       # playwright:e2e(navigation + assistant-flow + settings-flow)
npm run build      # adapter-static:产出静态文件到 build/
```

---

## 技术栈

- SvelteKit 5 + Svelte 5(runes 模式)— 与内核对齐
- TypeScript(strict)
- Vite + adapter-static
- vitest(单元测试 + 导入验证)+ playwright(e2e)
- 内核 `@evorule/console` v0.1.1(git URL 安装)

---

## 目录结构

```
evorule-console-cloud/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte     # 根布局:导航 6 tab + backend + assistant + 主题 + 设置入口
│   │   └── +page.svelte       # 视图容器:根据 currentView 渲染 5 视图
│   ├── lib/
│   │   ├── backend/           # CloudHttpBackend(联网/离线双模式)
│   │   ├── assistant/         # CloudLlmAssistant + llm-fetch + prompts + types
│   │   ├── config/            # net-config + llm-config + llm-presets(厂商预设)
│   │   ├── stores/            # assistant-ui(dialog 状态)
│   │   └── views/
│   │       ├── Assistant/    # DraftRuleDialog / ExplainRuleDialog / GenerateInputDialog
│   │       └── Settings/      # Settings(联网+LLM 两 tab)/ LlmSettings
│   ├── app.css                # 设计令牌(与内核对齐)
│   └── verify.test.ts         # 导入验证(vitest)
├── tests/                     # playwright e2e(navigation + assistant-flow + settings-flow)
├── docs/
│   └── L2_LOCAL_LLM_PLAN.md   # L2 本地 LLM 规划(v0.2.0+ 付费扩展)
├── package.json               # @evorule/console 依赖(开发期 file:,发版 git URL)
├── svelte.config.js           # adapter-static
├── vite.config.ts             # port 5174
└── README.md(本文件)
```

---

## 许可与治理

**AGPL-3.0-or-later** + 商业双许可 — 详见 [LICENSE](./LICENSE) / [DUAL_LICENSE.md](./DUAL_LICENSE.md)。

| 文件 | 说明 |
| --- | --- |
| [NOTICE.md](./NOTICE.md) | 声明（与 evorule-console 内核的关系） |
| [CHANGELOG.md](./CHANGELOG.md) | 变更记录 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南（含核心原则 + 禁止事项） |
| [SECURITY.md](./SECURITY.md) | 安全政策（含 LLM apiKey 安全设计） |
| [RELEASE_PROCESS.md](./RELEASE_PROCESS.md) | 发布流程 |
| [AUTHORS.md](./AUTHORS.md) | 作者 |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | 贡献者公约 |
| [TRADEMARK.md](./TRADEMARK.md) | 商标政策 |
| [CLA-individual.md](./CLA-individual.md) | 个人贡献者许可协议 |
| [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md) | 商业许可 |
| [FREE_COMMERCIAL_LICENSE.md](./FREE_COMMERCIAL_LICENSE.md) | 免费商业豁免资格 |

---

Copyright (C) 2026 EvoRule Project. All rights reserved.
