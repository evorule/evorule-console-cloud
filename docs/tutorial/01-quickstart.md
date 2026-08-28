<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 5 分钟跑通第一条规则(0 → 1)

> **目标**:从"刚装好"到"成功提交一条 set 命令并在审计链看到 fact",5 分钟内完成。

## 前置条件

- Windows 10/11 + PowerShell 5.1+
- 已克隆 `evorule-console-cloud` 仓
- `evorule-server` 和 `evorule-rule-serve` 已编译(项目根目录的 `target/debug/` 或 `target/release/` 下应有可执行文件)
  - 如果没编译,在各自仓根目录运行 `cargo build`(首次约 30 min)
- Node.js 22+ 已装

---

## Step 0 · 一键启动全栈(30 秒)

在 `evorule-console-cloud` 仓根目录双击 `start-all.bat`。

**第一次跑建议创建桌面快捷**:双击 `install-shortcut.bat`,之后双击桌面 `evorule-start.lnk`。

脚本会自动:
1. 启动 evorule-server(默认 18090 端口)
2. 启动 evorule-rule-serve(默认 18081 端口)
3. 启动 dev server(默认 5174 端口)
4. 等 3 端口就绪,自动开浏览器到 `http://127.0.0.1:5174/workbench`

**期望输出**(节选):
```
=== [1/3] evorule-server @ 18090 ===
  [OK] evorule-server already running (PID 7272, port 18090)
=== [2/3] evorule-rule-serve @ 18081 ===
  [OK] evorule-rule-serve already running (PID 21424, port 18081)
=== [3/3] console-cloud dev @ 5174 ===
  [OK] console-cloud @ 5174 ready
  Opening browser: http://127.0.0.1:5174/workbench
```

如果某步失败,看仓根目录的 `.dev-stdout.log` / `.dev-stderr.log`。

---

## Step 1 · 看工作台(30 秒)

打开 `http://127.0.0.1:5174/workbench`(脚本会自动开)。

你会看到 5 个 region(从上到下):

1. **顶部状态条** — server/rule 连接 + workspace + 模式 + 版本
   - 期望:server ● 已连接、rule ● 已连接、workspace: 默认工作空间
2. **4 统计卡** — 规则 / Sessions / 待审 / 最近 fact
   - 期望:规则 N 条(自建 N + 内置 0,首跑可能 0)
3. **一键操作 + 最近活动** — 3 tab 表单(加规则/试运行/LLM 快速)
4. **跳单页** — 8 按钮网格(规则库/执行台/状态/审计/时间旅行 + 3 治理页)

侧栏最顶部 `🚀 工作台` 按钮高亮(当前页)。

---

## Step 2 · 跳到规则库(1 分钟)

点工作台 Region 2 第一张卡(📐 规则),或点侧栏"分析视图 → 📐 规则库",或直接访问 `http://127.0.0.1:5174/view/rules`。

**期望**:看到 5 个 demo 规则(由 `+layout.svelte` 启动时 `seedBuiltinRules` 自动种入):
- `rule.demo.set_basic` — set payload.x = 42
- `rule.demo.call_baseline` — call 内置函数
- `rule.demo.conditional` — if/else 分支
- ...

如果规则库是空的(0 条),说明 evorule-rule-serve 没起,回 Step 0 看 `rule ● 已连接` 是否亮。

---

## Step 3 · 跳到执行台,创建 session(1 分钟)

点侧栏"分析视图 → ▶ 执行台",或访问 `/view/execution`。

**首次**:执行台顶部会有"创建 session"按钮,点一下。

**期望**:顶部出现 Session ID 数字(#1 等),下方出现命令提交区。

或用 curl:
```powershell
curl -X POST http://127.0.0.1:18090/api/sessions
# → {"message":"Session created","session_id":1}
```

---

## Step 4 · 提交第一条 set 命令(1 分钟)

在执行台命令区填:

```json
{"op": "set", "attr": "payload.x", "value": 42}
```

点"提交"按钮。

**期望**:
- 顶部显示"命令已提交,version=1"
- 状态视图(`/view/state`)出现 `payload.x = 42`
- 审计视图(`/view/audit`)出现新 fact

---

## Step 5 · 看 audit fact(30 秒)

跳到 `/view/audit`(侧栏"分析视图 → 🔍 审计")。

**期望**:
- 审计链时间线出现 1 条新 fact
- fact_type: `command`
- payload 包含 `op: set` / `attr: payload.x` / `value: 42`
- BLAKE3 哈希链可点击展开

---

## Step 6 · 回工作台看(30 秒)

回 `/workbench`:
- 4 统计卡的"Sessions" 应该 ≥ 1
- "最近 fact" 卡应显示 fact 序号
- "最近活动" Region 4 应显示该 fact 条目

如果 stat 显示还是 0,点工作台顶部 `🔄 刷新` 按钮。

---

## 完成

恭喜,你已跑通 evorule 完整链路:**加规则 → 创建 session → 提交命令 → 审计链留痕**。

## 下一步

- **加更多规则**:看 [规则库视图说明](../workbench.md) 或侧栏跳
- **时间旅行回放**:跳"⏱ 时间旅行",回看任意历史版本
- **导出审计报告**:跳"📤 导出",6 种内容 × 4 种格式(JSON/CSV/XML/PDF)
- **治理与审批**:跳"🗂️ 治理中心",看发布队列 + 审批工作流
- **配置 LLM 辅助**:点顶栏 ⚙️ 设置 → LLM 配置 tab,填智谱/OpenAI apiKey 后,规则库侧栏"🪄 AI 起草"可用
- **详细使用**:看 [帮助索引](./README.md)
