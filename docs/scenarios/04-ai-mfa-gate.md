<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景 4 · AI 合规门禁（未 MFA 阻断工具调用，衔接既有叙事）

## 业务语义

AI Agent 的每个工具调用先过合规门禁：**未通过 MFA 验证的调用 → 阻断并写明留痕说明**；已验证则放行。门禁策略显式写在规则里（如只对资金类操作强制 MFA），按需自行调整——判定本身是确定性规则，执行即上审计链，这就是"给 AI 装行车记录仪"的最小形态。

对应规则：[rules/ai-mfa-gate.json](./rules/ai-mfa-gate.json)

## 预期执行结果

提交业务指令后，判定结果写回 `payload.data.request`：

| 业务指令（params.request） | 预期输出（data.request） |
| --- | --- |
| `action = "transfer"`，`mfa_verified = false` | `gate_decision = "blocked"` + `gate_note = "等保 2.0 三级 §8.1.4.1.d：资金类操作需先通过 MFA 验证，已阻断并留痕"` |
| `action = "transfer"`，`mfa_verified = true` | `gate_decision = "allowed"` |

## 验证步骤

1. 「执行台」→ 新建会话
2. 命令提交区粘贴业务指令：

```json
{"type":"ai_mfa_gate_check","params":{"request":{"action":"transfer","mfa_verified":false}}}
```

3. 「状态」视图：应看到 `gate_decision = "blocked"` 与留痕说明
4. 改 `mfa_verified: true`，**新建会话**再提交 → `allowed`
5. 「审计」页：两次门禁判定都在事实链上，含哈希——阻断决策不可抵赖、不可篡改
