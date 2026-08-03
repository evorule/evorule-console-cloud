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

# 发布流程 — evorule-console-cloud

**版本**: 1.0
**生效日期**: 2026-08-03
**适用范围**: evorule-console-cloud 仓

---

## 📋 发版治理原则

> **核心原则**：开发完成后**不立即发版**，必须经过反复人工测试，用户明确确认"可以发布"后才 tag v0.1.0 + push 到 Gitee 公开仓。

| 阶段 | 版本号 | Gitee 状态 | 说明 |
| --- | --- | --- | --- |
| 开发期（Phase 1-7） | `0.0.x` | 本地 commit，**不 push** | 功能开发 + 自动化测试 |
| 人工测试期 | `0.0.x` | 本地 commit，**不 push** | 用户人工验收 + 修复回归 |
| **发版** | `0.1.0` | **tag + push** | 用户明确确认"可以发布"后执行 |

**push 时机由用户决定**，开发者不得擅自 push。

---

## 🔒 发版前置条件（全部满足才能发版）

### 1. 自动化测试全绿

```bash
cd D:\evorule-console-cloud
npm run check          # svelte-check: 0 errors / 0 warnings
npm run test:unit      # vitest: 全部 PASS
npm run test           # playwright: 全部 PASS
npm run build          # adapter-static: 产出 build/ 成功
```

### 2. 用户人工测试验收通过

用户已完成以下场景的人工测试（详见 [CHANGELOG.md](CHANGELOG.md) 人工测试验收清单）：

- [ ] 5 视图功能正常（规则库 / 执行台 / 状态 / 审计 / 时间旅行）
- [ ] 设置面板：联网配置 + LLM 配置全流程
- [ ] LLM 三用途：AI 辅助创建规则 / 解释规则 / 生成测试输入
- [ ] LLM 关闭回归：禁用后行为与内核一致
- [ ] 持久化：主题 / 视图 / 联网模式 / LLM 配置
- [ ] 真实 LLM 调用：至少一个厂商（智谱/通义/DeepSeek/OpenAI）真实 API 调用成功
- [ ] 真实 evorule-server 连接 + 真实命令提交到 reactor
- [ ] apiKey 安全：URL / 控制台 / 错误信息中不泄露

### 3. 发版治理文件齐全

- [x] LICENSE（AGPL-3.0）
- [x] NOTICE.md
- [x] AUTHORS.md
- [x] CODE_OF_CONDUCT.md
- [x] CONTRIBUTING.md
- [x] SECURITY.md
- [x] TRADEMARK.md
- [x] CLA-individual.md
- [x] DUAL_LICENSE.md
- [x] COMMERCIAL_LICENSE.md
- [x] FREE_COMMERCIAL_LICENSE.md
- [x] CHANGELOG.md
- [x] README.md
- [x] RELEASE_PROCESS.md（本文件）

### 4. 用户明确确认

> **用户明确说"可以发布"后，才能进入下一步。**

---

## 🚀 发版执行步骤

### 步骤 1：最终全测试回归

```bash
cd D:\evorule-console-cloud
npm run check && npm run test:unit && npm run test && npm run build
```

确认全绿后继续。

### 步骤 2：bump 版本号

编辑 `package.json`：

```json
{
  "version": "0.1.0"
}
```

### 步骤 3：切换内核依赖为 git URL

编辑 `package.json` 的 `dependencies`：

```json
{
  "dependencies": {
    "@evorule/console": "git+https://gitee.com/evo-rule-lab/evorule-console.git#v0.1.1"
  }
}
```

> **注**：开发期用 `"file:../evorule-console"` 方便本地联调；发版时必须切 git URL，确保用户安装时从公开仓拉取。

重新安装依赖验证：

```bash
npm install
npm run check     # 确认 git URL 依赖可用
```

### 步骤 4：更新 README 版本徽章

将 README.md 顶部的版本徽章从 `0.0.1--dev` 改为 `0.1.0`。

### 步骤 5：更新 CHANGELOG

在 CHANGELOG.md 中：

- 将 `[Unreleased]` 改为 `[0.1.0] - 2026-08-03`（或实际发版日期）
- 添加"## [Unreleased]"空节在顶部，供下个版本使用

### 步骤 6：提交 + tag

```bash
git add -A
git commit -m "release(cloud): v0.1.0 联网大众版首发

- Phase 1-7 全部完成
- 自动化测试全绿(svelte-check 0/0 + vitest 82/82 + playwright 47/47)
- 真实环境验证通过(deepseek API + evorule-server 全流程跑通)
- 发版治理文件齐全(11 项)
- 切换内核依赖为 git URL"

git tag -a v0.1.0 -m "evorule-console-cloud v0.1.0 联网大众版首发"
```

### 步骤 7：push 到 Gitee 公开仓

**前提**：用户已在 Gitee 创建 `evo-rule-lab/evorule-console-cloud` 空仓（不初始化 README/.gitignore/LICENSE）。

```bash
git remote add origin https://gitee.com/evo-rule-lab/evorule-console-cloud.git
git push -u origin main
git push origin v0.1.0
```

### 步骤 8：发布后验证

- [ ] Gitee 页面显示完整文件列表
- [ ] tag v0.1.0 在 Gitee Releases 显示
- [ ] `npm install` 从 git URL 拉取成功（在新环境验证）
- [ ] README 徽章显示正确版本
- [ ] CHANGELOG 显示 v0.1.0 发版日期

### 步骤 9：发布后工作

- 在 Gitee 创建 v0.1.0 Release（附 CHANGELOG 摘要）
- 通知用户发版完成
- 更新本仓的"下个版本规划"（v0.2.0 L2 本地 LLM 等）

---

## ⚠️ 发版后注意事项

### 1. 不可变原则

**tag v0.1.0 一旦 push，不可修改**。如发现严重 bug：

- 在 v0.1.0 基础上发 v0.1.1 patch 版本
- 不要删除 / 重建 tag（会破坏依赖此版本的用户）

### 2. 内核版本锁定

`package.json` 中 `@evorule/console` 的 git URL 锁定到 `#v0.1.1`。如需升级内核：

- bump 大众版版本号（v0.1.x → v0.2.0，因内核 API 可能 break）
- 更新 git URL 的 tag（如 `#v0.2.0`）
- 重新跑全测试回归
- 发新版

### 3. L2 付费扩展规划

v0.1.0 不含 L2 本地 LLM。L2 作为付费扩展，规划在 v0.2.0+ 实施，详见 [docs/L2_LOCAL_LLM_PLAN.md](docs/L2_LOCAL_LLM_PLAN.md)。

---

## 📞 联系

- **发版决策**: 用户（Mr. DAMU ZHENG）
- **技术执行**: 维护者
- **Gitee Issues**: <https://gitee.com/evo-rule-lab/evorule-console-cloud/issues>
- **邮箱**: <evorulelab@gmail.com>

---

## 版本历史

| 版本 | 日期 | 变更说明 |
| --- | --- | --- |
| 1.0 | 2026-08-03 | 初版，适配 evorule-console-cloud v0.1.0 发版流程 |
