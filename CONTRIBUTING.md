<!--
  Copyright 2026 EvoRule Project

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.

  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# 贡献指南 — evorule-console-cloud

**项目**：evorule-console-cloud — evorule 规则引擎面板 · 联网大众版
**版本**：0.1.0
**最后更新**：2026-08-03

> evorule-console-cloud 是 [evorule-console](https://gitee.com/evo-rule-lab/evorule-console) 内核的衍生产品，定位为**二次开发者专业起点**（联网 + 云 LLM）。本文档仅约束本仓；EvoRule 项目级原则见各仓自身的贡献指南。

---

## 核心原则

### 原则 1：内核零修改，扩展槽注入

✅ **evorule-console-cloud 通过 `provideBackend()` / `provideAssistant()` 扩展槽注入联网后端与云 LLM 助手**
❌ **不要修改 `@evorule/console` 内核包的任何代码**（内核独立发版，大众版只消费）

**为什么**：

- 内核 evorule-console 是大众版、高级版的共同基础，修改内核会破坏多产品线演化
- 扩展槽是内核预留的注入点，大众版通过它实现联网 + LLM 扩展
- 内核升级时大众版只需 bump 依赖版本，无需改代码

### 原则 2：LLM 是辅助层，不参与确定性执行

✅ **LLM 只生成草案 / 解释 / 测试输入，用户审核确认才生效**
❌ **不要让 LLM 自动执行规则 / 自动提交命令 / 参与 reactor 执行链路**

**为什么**：

- evorule 的核心是“确定性执行”，LLM 是非确定性的，混入会破坏这一基调
- LLM 调用失败时降级为“用户手动编辑 JSON”，不阻塞规则引擎工作
- 这是大众版与 AI agent 编排产品的本质区别

### 原则 3：JSON 是唯一表达

✅ **规则 / 状态 / 命令 / 审计 / 输入输出 = 全部 JSON**
❌ **不要引入非 JSON 数据格式（二进制、protobuf）进入数据流**

**为什么**：

- 透明性、可解释性、可审计性都源于 JSON
- LLM 输出也必须是 JSON（prompt 强约束 + RuleValidator 校验）
- `git diff` = 审计，`grep` = 查询，JSONL = 时间机器

### 原则 4：apiKey 三不原则

✅ **apiKey 不进 URL / 不进日志 / 不进 error.message**
❌ **不要在 prompt / console.log / error.message 中暴露 apiKey**

**为什么**：

- apiKey 是用户的隐私凭证，泄露会被滥用
- 大众版 localStorage 明文存储是可接受的（UI 已提示），但**传输 / 日志路径必须脱敏**
- 由 `llm-fetch.ts` 统一保证，单测覆盖断言

### 原则 5：联网模式不破坏离线可用性

✅ **规则库视图离线可用（builtin 规则 + localStorage 用户规则）**
❌ **不要让联网模式成为所有视图的前置条件**

**为什么**：

- 大众版用户可能无网络或 evorule-server 未启动
- 规则库、视图切换等基础功能必须离线可用
- 联网模式只影响执行台 / 状态 / 审计等依赖 backend 的视图

---

## 🐛 报告 Bug

使用 [Gitee Issues](https://gitee.com/evorule/evorule-console-cloud/issues)。

**报告模板**：

```markdown
**环境**:

- OS: [e.g. Windows 11 / Ubuntu 22.04]
- Node: [e.g. 20.10]
- 浏览器: [e.g. Chrome 126]
- evorule-console-cloud 版本: [e.g. 0.1.0]
- @evorule/console 内核版本: [e.g. 0.1.1]
- 联网模式: [本地 / 联网]
- LLM 是否启用: [是 / 否]
- LLM 厂商: [智谱 / 通义 / DeepSeek / OpenAI / 自定义]

**复现步骤**:

1. ...
2. ...

**预期行为**:
...

**实际行为**:
...

**截图 / 控制台日志**:
[附截图或浏览器控制台输出]
```

---

## 功能建议

同样用 Issues，加 `enhancement` 标签。

**模板**：

```markdown
**问题**: 当前做法有什么不足?
**建议方案**: 简要描述
**备选方案**: 评估过的其他选项
**影响范围**: 哪个视图 / store / 接口 / 扩展槽
**是否涉及内核**: [是 / 否]（如涉及内核，需先在 evorule-console 仓提 issue）
```

---

## 提交 PR

### 工作流

1. **Fork 本仓** → 在你的 Gitee 账号下创建 fork
2. **建分支**：`git checkout -b feature/your-feature-name`
3. **写代码 + 写测试** — 覆盖率不得下降
4. **本地验证**（必须全部通过）：

   ```bash
   npm install
   npm run check          # svelte-check，0 error
   npm run test:unit      # vitest 单元测试
   npx playwright test    # e2e（首次需 npx playwright install chromium）
   npm run build          # adapter-static 构建必须成功
   ```

5. **推送**：`git push origin feature/your-feature-name`
6. **提 PR** 到 Gitee，填写 PR 模板
7. **签 CLA**（见下文）
8. **等 review** — 维护者 7 天内回复

### Commit message 约定

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(assistant): add new LLM provider preset for minimax
fix(net-config): correct default baseUrl to localhost
docs(changelog): record full-flow test milestone
chore(deps): upgrade @evorule/console to 0.1.2
refactor(settings): split llm-settings into sub-components
test(e2e): add apiKey security verification case
```

### 分支命名

- `feature/<name>` — 新功能
- `fix/<name>` — bug 修复
- `docs/<name>` — 仅文档
- `chore/<name>` — 杂项
- `refactor/<name>` — 重构

---

## CLA（贡献者许可协议）

**所有贡献必须包含 CLA**。PR 时机器人自动检查。

- 个人贡献者：[CLA-individual.md](CLA-individual.md)
- 企业贡献者：联系 <evorulelab@gmail.com>

**为什么需要 CLA**：

- 支持商业双许可（见 [DUAL_LICENSE.md](DUAL_LICENSE.md)）
- 避免贡献者版权争议
- AGPL-3.0 单独不足以支撑商业双许可

---

## 测试要求

> **完整测试指南**（环境准备 → 4 种测试 → 联调 → 排查）见 [README §测试](./README.md#测试)。本节仅列贡献者的额外要求。

### 单元测试（vitest）

- 新功能必须有对应单元测试
- 测试文件与源文件同目录，命名 `*.test.ts`
- 覆盖率不得下降
- **apiKey 安全断言**：涉及 LLM 调用的测试必须断言 apiKey 不出现在 error.message / 日志

### e2e 测试（playwright）

验证侧栏导航 + LLM 流程 + 设置面板（见 `tests/`）：

1. 首屏加载 + 品牌 + 侧栏导航
2. 5 视图切换 + 设置面板打开/关闭
3. 联网模式切换 + 持久化
4. LLM 配置流程（启用 + 厂商预设 + apiKey + 测试连接 + 重置）
5. LLM 三用途（DraftRuleDialog / ExplainRuleDialog / GenerateInputDialog）
6. LLM 关闭回归（禁用后 AI 按钮不渲染）
7. apiKey 安全（不进 URL / 密码框 / 持久化）

**e2e 并发说明**：本仓 `playwright.config.ts` 强制 `workers: 1` + `fullyParallel: false`，这是配置约束（vite dev 冷启动竞态），不是代码缺陷。

### L_console 预校验

内核 `@evorule/console` 的 `ruleValidator.ts` 是前端预校验层（G1-G7），与 evorule 核心仓的 `build.rs` + clippy + Kani（L0 权威）对齐。**内核 SPEC 变更时大众版需同步 bump 内核版本**。

---

## 编码规范

### 风格

- `npm run check` （svelte-check）必须 0 error
- 公共 API 必须有 JSDoc / TSDoc 注释
- 导出的 store / 类型 / 组件签名必须稳定（语义化版本）

### 文件头

所有 `.ts` / `.svelte` / `.js` 文件必须包含 SPDX 头：

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
```

`.svelte` / `.md` 用 HTML 注释形式：

```html
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
```

### 模块分层

- `src/lib/backend/` — 联网后端（`CloudHttpBackend` 双模式 + `reconfigure`）
- `src/lib/assistant/` — 云 LLM 助手（`CloudLlmAssistant` + `llm-fetch` + `prompts` + `types`）
- `src/lib/config/` — 配置 store（`net-config` + `llm-config` + `llm-presets` 厂商预设）
- `src/lib/stores/` — 跨视图共享状态（`assistant-ui` dialog 状态）
- `src/lib/views/Assistant/` — LLM 三用途 Dialog 组件
- `src/lib/views/Settings/` — 设置面板（联网 + LLM 两 tab）
- `src/routes/` — 根布局（侧栏导航 + backend + assistant 注入）

### 不可变优先

- Svelte runes：`$state` / `$derived` / `$effect`，避免可变全局
- store 返回不可变视图，修改走显式 action 函数
- 使用 `Object.freeze` / 只读类型（`Readonly<T>` / `as const`）约束公共数据

---

## 禁止事项

- ❌ **不要修改 `@evorule/console` 内核包代码**（破坏多产品线演化）
- ❌ **不要让 LLM 自动执行规则 / 自动提交命令**（破坏确定性执行）
- ❌ **不要在 prompt / 日志 / error.message 中暴露 apiKey**（违反三不原则）
- ❌ **不要引入非 JSON 数据格式**（破坏透明性）
- ❌ **不要用 `{@html}` 渲染用户/规则内容**（XSS 风险）
- ❌ **不要把审计哈希计算搬到前端**（破坏 TCB 纯净）
- ❌ **不要让联网模式成为所有视图的前置条件**（破坏离线可用性）
- ❌ **不要提交 secrets / API key / 个人信息 / 内部地址**（公开仓）

---

## 联系

- **Gitee Issues**：<https://gitee.com/evorule/evorule-console-cloud/issues>
- **邮箱**：<evorulelab@gmail.com>
- **组织**：[EvoRule Lab](https://gitee.com/evo-rule-lab)

---

## 致谢

感谢所有贡献者！你的名字将出现在 [AUTHORS.md](AUTHORS.md)。

---

**风格遵循 [Keep a Changelog](https://keepachangelog.com/)、[Conventional Commits](https://www.conventionalcommits.org/)、[Contributor Covenant](https://www.contributor-covenant.org/)。**
