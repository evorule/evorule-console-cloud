<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景示例规则

> 4 条**真实业务语义**的示例规则（非机制演示），体验包已内置，启动即可实测复现。
> 规则即数据：JSON 直接可读可改，改完 reload 即生效，执行结果确定性可复现。

| # | 场景 | 规则文件 | 业务指令 | 一句话语义 |
| --- | --- | --- | --- | --- |
| 1 | [合同条款校验](./01-contract-payment-guard.md) | [rules/contract-payment-guard.json](./rules/contract-payment-guard.json) | `contract_payment_check` | 付款前提缺失即阻断 |
| 2 | [报销合规检查](./02-expense-compliance.md) | [rules/expense-compliance.json](./rules/expense-compliance.json) | `expense_compliance_check` | 重复发票驳回；超标升级审批链 |
| 3 | [设备巡检告警](./03-equipment-inspection.md) | [rules/equipment-inspection.json](./rules/equipment-inspection.json) | `equipment_inspection_check` | 阈值联动告警与升级上报 |
| 4 | [AI 合规门禁](./04-ai-mfa-gate.md) | [rules/ai-mfa-gate.json](./rules/ai-mfa-gate.json) | `ai_mfa_gate_check` | AI Agent 未过 MFA 调用工具 → 阻断留痕 |

## 规则即业务指令处理器

每条场景规则定义了一种**业务指令类型**（如 `contract_payment_check`）。向会话提交一条业务指令，规则的 transform 分支即对指令参数做确定性判定，结论写回 `payload.data`，全程上审计链——**一条指令直达决策，无需第二步**。

## 两条实测路径

**UI 路径**：启动体验包 → 右上「登录」→「切换到演示模式」选预置用户（或用服务端账号登录）→ 左侧栏「▶ 执行台」→「**+ 新建**」会话 → 在指令 JSON 输入区粘贴场景文档给出的业务指令 JSON →「**提交命令**」→ 执行结果区对照预期输出（可点「重复上次」验证确定性）→ 左侧栏「📦 状态」看 payload /「🔍 审计」看事实链。

> 未登录状态点击执行台等分析视图会重定向到登录页，属预期门控行为。

**API 路径**（体验包服务端口 18080）：

```bash
# 1. 新建会话
curl -X POST http://localhost:18080/api/sessions
# 2. 提交业务指令（以场景 1 为例）
curl -X POST http://localhost:18080/api/sessions/<session_id>/command \
  -H "Content-Type: application/json" \
  -d '{"instruction":{"type":"contract_payment_check","params":{"contract":{"signed":true},"approval_id":"AP-2026-0042","payment":{"amount":88000}}}}'
# 3. 查看判定结果
curl http://localhost:18080/api/sessions/<session_id>/state
```

## 规则文件的两种形态

| 形态 | 位置 | 用途 |
| --- | --- | --- |
| 内核格式 | `docs/scenarios/rules/*.json` | 可读性优先的规则源（含业务说明与示例指令），粘贴到规则库视图即可管理 |
| rule_set 封装 | 体验包 `rules/scenario-*.json`（源在仓内 `assets/evorule-rules/`） | 服务端 `--rules-dir` 可装载形态，启动即生效；改动后 `POST /api/rules/reload` 热加载 |

## 实测记录（2026-09-02）

4 条规则 × 9 个断言用例在体验包环境（evorule-server v0.4.1 + rules 目录装载）全部通过：
正反例判定、临界值（金额等于上限不放行、温度等于阈值触发）、阻断原因文案逐字段核对一致，审计链 `verified: true`。

> 每篇场景文档都给出**两组对照输入**（触发/不触发），预期输出逐字段列出——这就是"确定性"的含义：你跑出一模一样的结果。
