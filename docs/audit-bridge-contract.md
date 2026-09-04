# 单发桥接协议契约说明（audit-bridge / demo-svc）

> 性质：**契约说明文档**，非可装载规则集（2026-09-03，UV-054 处置）。
> 背景：`call_external` / `call_service` **单发桥接协议已归引擎单一权威**（server 业务规则集 `resources/server_eval.json`（v0.4.1 前旧名 `core_eval.json`），为系统规则，不容退让）。此前 console-cloud 自持的同名 transform（`assets/evorule-rules/llm-audit-bridge.json`、`demo-svc.json`）与引擎桥接重复注册，导致双规则顺序执行、LLM 调用循环 / 服务自治循环（UV-054）。本文件仅记录协议语义与消费范式，供接入方与教学参考，**不进入 --rules-dir 装载路径**。

## 一、单发桥接协议（系统规则，归引擎 core_eval）

适用指令：`call_external`（LLM 调用）、`call_service`（内置/注册服务调用）。

执行形态（无→有 两段，单个桥接）：
1. **无结果**：`exists(__exec__.payload.__io_results__.<io_type>)` 为 false → 发射 `io_request`（`io_type` 透传，call_external 透传 `messages`/`tools`，call_service 透传 `service_name`/`args`），反应器置 pending，等待外部/内部应答。
2. **有结果**：收到 `io_response` 后引擎注入结果到 `__io_results__.<io_type>` → 重推原指令，执行 `on_true` 分支消费结果到业务字段（call_external→`llm_response`，call_service→`service_result`）→ **清除 `__io_results__.<io_type>`**（JSON null，exists 视为不存在）→ push `noop` 收敛 Stable。

关键纪律（防止重影/循环）：
- **单一权威**：单发桥接只由引擎 core_eval 定义；消费方不得再自持同名桥接 transform。
- **消费方职责**：仅做协议客户端——发命令 → 订阅 SSE 收 `io_request` → 本地执行 → `POST /api/sessions/{id}/io_response` 应答 → 等 `Stable`。
- 应答必须使用引擎返回的 `io_request.id`；失败也要回写 error 形态的 io_response，不留悬空 IoRequest。

## 二、消费范式（console-cloud 参考实现）

- LLM 审计桥：`src/lib/assistant/audited-llm.ts`（发 `call_external` 命令 → 收 IoRequest → 本地调 LLM → 回 io_response，结果入 `payload.llm_response`）。
- 服务调用示例：原 `demo-svc.json` 演示的 `call_service`（`service_name=inverse_kinematics_solver` 等原生 demo 服务）由引擎桥接 + IoSubscriber 应答，命令见示例仓库 scenarios。

## 三、验收

- 端到端验收脚本 `scripts/validate-audit-bridge.mjs`（10 项）现锚定**引擎桥接**：create_session → IoRequest(messages 透传) → io_response → Stable 收敛 → llm_response 落 payload → 审计链（Command 事实 / IoResponse 事实）完整。
- 运行前置：`evorule-server --rules-dir <仅含 scenario-*> rules/`（不含重复桥接 transform）。