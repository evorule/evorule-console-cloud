<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景 1 · 合同条款校验（付款前提缺失即阻断）

## 业务语义

财务付款前自动核验合同条款：**合同已签署 + 审批单存在 + 金额低于 10 万**三条前提同时满足才放行；任一缺失即阻断，并写明阻断原因。

对应规则：[rules/contract-payment-guard.json](./rules/contract-payment-guard.json)

## 预期执行结果

提交业务指令后，指令参数落在 `payload.data`，判定结果写回 `payload.data.payment`：

| 业务指令（params） | 预期输出（data.payment） |
| --- | --- |
| 合同已签 + 审批单在 + 金额 88000 | `status = "approved"` |
| 合同未签（`signed: false`），其余同上 | `status = "blocked"` + `block_reason = "付款前提缺失：需合同已签 + 审批单存在 + 金额低于 100000"` |
| 金额 100000（等于上限） | `status = "blocked"`（规则为"低于 10 万放行"，等于不放行） |

## 验证步骤

1. 「执行台」→ 新建会话
2. 命令提交区粘贴业务指令（合同已签、88000 元）：

```json
{"type":"contract_payment_check","params":{"contract":{"signed":true},"approval_id":"AP-2026-0042","payment":{"amount":88000}}}
```

3. 「状态」视图：应看到 `data.payment.status = "approved"`
4. 把 `signed` 改为 `false`，**新建会话**再提交 → 应看到 `status = "blocked"` 和阻断原因
5. 「审计」页：两次判定各有一条事实链记录，含哈希、不可篡改

> 也可以走 API（见 [README](./README.md) 的 curl 示例）：`POST /api/sessions` → `POST .../command` → `GET .../state`。
