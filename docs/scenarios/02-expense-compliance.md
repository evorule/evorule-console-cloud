<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 场景 2 · 报销合规检查（超标审批链 / 发票重复）

## 业务语义

报销单两道检查：**重复发票直接驳回**（不再进入金额判断）；非重复的按金额分流——**5000 元以下自动通过，5000 元及以上升级到部门主管审批链**。

对应规则：[rules/expense-compliance.json](./rules/expense-compliance.json)

## 预期执行结果

提交业务指令后，判定结果写回 `payload.data.expense`：

| 业务指令（params） | 预期输出（data.expense） |
| --- | --- |
| 金额 4320，非重复发票 | `decision = "auto_approved"` |
| 金额 5000，非重复发票 | `decision = "manager_approval_needed"` + `escalate_to = "部门主管审批队列"` |
| `duplicate: true`（金额随意） | `decision = "rejected"` + `reject_reason = "发票重复：同一发票号已存在报销记录"` |

注意第三行：重复发票在第一道检查就被驳回，金额规则不会覆盖该结论。

## 验证步骤

1. 「执行台」→ 新建会话
2. 命令提交区粘贴业务指令：

```json
{"type":"expense_compliance_check","params":{"expense":{"amount":4320,"category":"travel"},"invoice":{"duplicate":false}}}
```

3. 「状态」视图：应看到 `data.expense.decision = "auto_approved"`
4. 三组输入逐一对照上表（每组输入**新建会话**后提交；第 2、3 组只需改 `params` 里的字段）
5. 「审计」页观察判定事实链；换输入重跑，结果完全一致——确定性
