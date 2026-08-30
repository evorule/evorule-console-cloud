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

**版本**：1.0
**生效日期**：2026-08-03
**适用范围**：evorule-console-cloud 仓

---

## 发版治理原则

>
| 阶段 | 版本号 | Gitee 状态 | 说明 |
| --- | --- | --- | --- |
| 开发期（Phase 1-7）| `0.0.x` | 本地 commit，**不 push** | 功能开发 + 自动化测试 |
| 人工测试期 | `0.0.x` | 本地 commit，**不 push** | 用户人工验收 + 修复回归 |
| **发版** | `0.1.0` | **tag + push** | 用户明确确认“可以发布”后执行 |


---

## 🔒 发版前置条件（全部满足才能发版）

### 1. 自动化测试全绿

在本仓目录下执行：

```bash
npm run check          # svelte-check: 0 errors / 0 warnings
npm run test:unit      # vitest: 全部 PASS
npm run test           # playwright: 全部 PASS
npm run build          # adapter-static: 产出 build/ 成功
```

### 2. 人工测试验收通过

完成以下场景的人工测试（详见 [CHANGELOG.md](CHANGELOG.md) 人工测试验收清单）：

- [ ] 5 视图功能正常（规则库 / 执行台 / 状态 / 审计 / 时间旅行）
- [ ] 设置面板：联网配置 + LLM 配置全流程
- [ ] LLM 三用途：AI 辅助创建规则 / 解释规则 / 生成测试输入
- [ ] LLM 关闭回归：禁用后行为与内核一致
- [ ] 持久化：视图 / 联网模式 / LLM 配置
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

---

## 发版执行步骤

### 步骤 1：最终全测试回归

在本仓目录下执行：

```bash
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

### 步骤 3：确认内核快照状态（如本次发版包含快照更新）

内核以源码快照形式内联于 `src/lib/kernel/`（取自 evorule-console，当前基线 v0.2.0）。本仓无 npm 内核依赖，无需切换 git URL。

若本次发版包含快照更新，需在快照目录头部注释与 README「内核快照」节中同步更新来源版本号，并在 CHANGELOG 中注明快照基线变更。

### 步骤 4：更新 README 版本徽章

确认 README.md 顶部版本徽章为 `0.1.0`（bump 版本号步骤已执行）。

### 步骤 5：更新 CHANGELOG

在 CHANGELOG.md 中：

- 将 `[Unreleased]` 改为 `[0.1.0] - 2026-08-03`（或实际发版日期）
- 添加“## [Unreleased]”空节在顶部，供下个版本使用

### 步骤 6：提交 + tag

```bash
git add -A
git commit -m "release(cloud): v0.1.0 联网大众版首发

- Phase 1-7 全部完成
- 自动化测试全绿(svelte-check 0/0 + vitest 904/904 + playwright 64/64)
- 真实环境验证通过(deepseek API + evorule-server 全流程跑通)
- 发版治理文件齐全(11 项)
- 切换内核依赖为 git URL"

git tag -a v0.1.0 -m "evorule-console-cloud v0.1.0 联网大众版首发"
```

### 步骤 7：push 到 Gitee 公开仓

```bash
git remote add origin https://gitee.com/evorule/evorule-console-cloud.git
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
- 更新本仓的“下个版本规划”（v0.2.0 L2 本地 LLM 等）

---

## ⚠️ 发版后注意事项

### 1. 不可变原则

**tag v0.1.0 一旦 push，不可修改**。如发现严重 bug：

- 在 v0.1.0 基础上发 v0.1.1 patch 版本
- 不要删除 / 重建 tag（会破坏依赖此版本的用户）

### 2. 内核快照基线

内核以源码快照内联于 `src/lib/kernel/`（当前基线：evorule-console v0.2.0）。如需同步内核上游新版本：

- bump 大众版版本号（v0.1.x → v0.2.0，因内核 API 可能 break）
- 从内核仓目标 tag 重新提取快照并更新 `src/lib/kernel/index.ts` 头部基线注释与 README「内核快照」节
- 重新跑全测试回归
- 发新版

### 3. L2 付费扩展规划

v0.1.0 不含 L2 本地 LLM。L2 作为付费扩展，规划在 v0.2.0+ 实施。

---

## 联系

- **发版决策**：项目维护者
- **技术执行**：维护者
- **Gitee Issues**：<https://gitee.com/evorule/evorule-console-cloud/issues>
- **邮箱**：<evorulelab@gmail.com>

---

## 版本历史

| 版本 | 日期 | 变更说明 |
| --- | --- | --- |
| 1.0 | 2026-08-03 | 初版，适配 evorule-console-cloud v0.1.0 发版流程 |
