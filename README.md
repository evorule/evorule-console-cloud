<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# evorule-console-cloud

> evorule 大众版 — **内核 + 联网 + 云 LLM** 的规则引擎面板,面向大众/中小企业,开箱即用

[![version](https://img.shields.io/badge/version-0.0.1--dev-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-AGPL--3.0--or--later-success)](./LICENSE)
[![kernel](https://img.shields.io/badge/kernel-@evorule/console%20v0.1.1-blueviolet)](https://gitee.com/evo-rule-lab/evorule-console)

`evorule-console-cloud` 在 [`@evorule/console`](https://gitee.com/evo-rule-lab/evorule-console) 内核基础上扩展:

- ☁️ **联网**:可连接远程 evorule-server(非仅本地 loopback)
- ✨ **云 LLM 辅助**:OpenAI 兼容协议,多厂商预设(通义/智谱/OpenAI),辅助生成规则草案/解释规则/生成测试输入
- 🎯 **用户审核确认**:LLM 只生成草案,最终规则是用户审核的 JSON,不破坏 evorule「确定性执行」基调

> **LLM 是辅助层,不参与确定性执行** — 执行链路完全不经过 LLM,规则即数据,用户审核才生效。

---

## 定位

| 层级                      | 仓   | 定位                        | LLM               | 网络               | 依赖                     |
| ------------------------- | ---- | --------------------------- | ----------------- | ------------------ | ------------------------ |
| evorule-console(内核)    | 独立 | 灵魂产品内核,无智能只有执行 | ❌ 无             | ❌ 无(仅本地 HTTP) | 0(消费 evorule 核心)     |
| **evorule-console-cloud(本仓)** | 独立 | 在内核基础上扩展          | ☁️ 云 LLM(默认开) | ✅ 联网            | `npm i @evorule/console` |
| 高级版                    | 独立 | 保密行业定制                | 🖥️ 本地 GPU LLM   | ✅ 联网/Tauri      | `npm i @evorule/console` |

三仓各自独立 semver,通过 npm 依赖松绑。

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

> 规则库视图不需要后端,可离线试用;执行台/状态/审计/时间旅行需要 evorule-server 跑在 `127.0.0.1:18080`(Phase 2 后可配远程)。

---

## 验证

```bash
npm run verify   # vitest:验证 @evorule/console 导入通路(CONSOLE_VERSION=0.1.1 + 所有导出可用)
npm run check     # svelte-check:0 errors / 0 warnings
npm run test      # playwright:e2e(Phase 8 补充)
npm run build     # adapter-static:产出静态文件到 build/
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
│   │   ├── +layout.svelte    # 根布局:导航 + backend 注入 + assistant 注入(null) + 主题
│   │   └── +page.svelte      # 视图容器:根据 currentView 渲染 5 视图
│   ├── app.css               # 设计令牌(与内核对齐)
│   └── verify.test.ts        # 导入验证(vitest)
├── static/favicon.svg
├── tests/                    # playwright e2e(Phase 8 补充)
├── package.json              # @evorule/console git URL 依赖
├── svelte.config.js          # adapter-static
├── vite.config.ts            # port 5174
└── README.md(本文件)
```

---

## 许可

**AGPL-3.0-or-later** — 详见 [LICENSE](./LICENSE)。

---

Copyright (C) 2026 EvoRule Project. All rights reserved.
