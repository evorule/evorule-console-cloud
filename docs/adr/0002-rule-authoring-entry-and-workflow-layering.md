<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# ADR-0002：规则生成入口职责边界与工作流分层定位

- **状态**：Accepted
- **日期**：2026-09-19

## 背景

console 与 agent 执行器（evo-agent）对接后出现两组能力重叠：

1. "生成规则"有两个潜在入口——现有单轮 LLM 辅助（`CloudLlmAssistant`：规则草稿/解释/测试输入/命令与流程转译）与 agent 侧多步规则助手。
2. "工作流"已有两处实现——`/flow` 流程设计画布（产物=规则草稿，走治理链）与 evo-agent workflow DAG 引擎（宪法 schema 加载期校验）；早期还曾规划第三个服务端工作流引擎 crate，与前两者大量重叠。两处既有实现均不支持条件分支。

不先定案，后续入口 UI、schema 演进与推广口径会互相踩踏。

## 决策

1. **入口分流**：轻量单轮任务留在现有辅助；多步与自动化任务归 agent 工作台。两入口职责不重叠；产物涉治理链的一律草稿态，用户确认才生效。
2. **不建第三引擎**：服务端不再规划 `core/workflow` 引擎 crate。`/flow` 为设计层，evo-agent workflow 为执行层；两者数据模型不强行统一，术语以限定词区分（"/flow 流程设计" vs "工作流=agent 编排引擎"）。
3. **条件分支落 evo-agent workflow**：扩展 `workflow_dag` schema 支持条件边，走 evorule-system-rules 双版本协议（新版本 + migration 规则）。规划-执行动态编排保留为远期方向；人工任务/暂停恢复暂缓。

## 后果

- 避免第三引擎重复建设；两个入口分工明确；条件分支有既定升级通道。
- 两套模型两套链长期并存，靠术语限定词维持区分，新人有理解成本。
- 复盘触发：两入口"该用哪个"反馈高频 → 收紧引导文案；出现绕过两条链的新编排通道 → 重议本决策。

## 相关文件

- `src/routes/flow/+page.svelte`、`src/lib/assistant/cloud-llm-assistant.ts`（设计层）
- evo-agent 仓 `src/agent/workflow.rs`、`src/agent/constitution.rs`（执行层）
- evorule-system-rules 仓 `schemas/workflow_dag/`、`docs/adr/double-version-protocol.md`（升级协议）
