# L2 本地 LLM 集成规划（v0.2.0+，付费扩展）

> **状态**：规划中，**不在 v0.1.0 大众版实现**。本文档是设计草案，作为后续版本的实施依据。
>
> **定位**：L2 是面向隐私敏感型企业用户的**付费扩展**，大众版 v0.1.0 仅含 L1 云 LLM。

---

## 1. 背景与动机

### 1.1 L0 / L1 / L2 三层 LLM 矩阵

| 层级 | 名称        | 部署模式                  | 是否联网 | 大众版包含 | 目标用户             |
| ---- | ----------- | ------------------------- | -------- | ---------- | -------------------- |
| L0   | 无 LLM      | 内核 evorule-console      | 否       | 否         | 纯确定性执行场景     |
| L1   | 云 LLM      | 调用厂商 OpenAI 兼容端点  | 是       | ✅ 是      | 大众 / 中小企业      |
| L2   | 本地 LLM    | Ollama / llama.cpp 本地   | 否       | ❌ 否(付费)| 隐私敏感型政企 / 涉密 |

### 1.2 为什么需要 L2

L1 云 LLM 存在以下场景的不可用性：

1. **数据隐私合规**：政企 / 涉密场景数据不能出本机，不能调任何外部 API
2. **离线场景**：内网部署、断网环境、远程现场作业
3. **可控成本**：L1 按调用计费，重度使用场景 L2 一次性硬件投入后边际成本为零
4. **审计要求**：部分行业要求所有 AI 推理过程留痕在受控环境内

L2 通过**本地推理**解决以上场景，所有数据不离开本机。

---

## 2. 目标与非目标

### 2.1 目标

- 复用 L1 已建立的三用途 UI（DraftRuleDialog / ExplainRuleDialog / GenerateInputDialog）
- 实现 `LocalLlmAssistant`（继承 `LlmAssistant` 接口），无缝替换 `CloudLlmAssistant` 注入内核扩展槽
- 支持 Ollama（首选，OpenAI 兼容端点）
- 提供 GPU 配置面板（设备选择、显存监控、模型管理）
- 用户审核确认机制与 L1 完全一致（不破坏执行确定性）

### 2.2 非目标

- ❌ 不在本期实现 llama.cpp 原生 API 对接（Ollama 已封装 llama.cpp，够用）
- ❌ 不实现 GPU 自动调优（CUDA / ROCm / Metal 自动切换）
- ❌ 不实现模型微调 / fine-tuning 工作流
- ❌ 不引入 Electron / Tauri 打包（仍走 SvelteKit Web 形态，靠浏览器 fetch 调本机 Ollama）

---

## 3. 接口设计

### 3.1 LocalLlmAssistant 接口

```typescript
// src/lib/assistant/local-llm-assistant.ts（v0.2.0+ 实现）

import type { LlmAssistant } from './types';

/**
 * 本地 LLM 配置（L2）。
 *
 * 与 CloudLlmConfig 区别:
 *   - 无 apiKey（本地推理无需鉴权）
 *   - 增加 host/port（默认 127.0.0.1:11434,Ollama 默认端口）
 *   - 增加 gpuDeviceId（多卡场景选择具体 GPU）
 *   - 增加 contextWindow（模型上下文长度,用于 prompt 截断策略）
 */
export interface LocalLlmConfig {
  enabled: boolean;
  /** Ollama 服务地址,默认 http://127.0.0.1:11434 */
  host: string;
  /** 端口,默认 11434 */
  port: number;
  /** 模型名,如 'qwen2.5:7b' / 'llama3.1:8b' */
  model: string;
  /** GPU 设备 id（多卡场景）,默认 0 */
  gpuDeviceId: number;
  /** 模型上下文窗口大小（token 数）,默认 4096 */
  contextWindow: number;
  /** 是否启用 GPU 加速（false 时强制 CPU 推理） */
  useGpu: boolean;
}

/**
 * LocalLlmAssistant — 本地 LLM 实现（基于 Ollama OpenAI 兼容端点）。
 *
 * 实现要点:
 *   - 复用 CloudLlmAssistant 的 prompts.ts（prompt 模板通用）
 *   - 复用 llm-fetch.ts 的 callChatApi（OpenAI 兼容协议）
 *   - apiEndpoint = `${host}:${port}/v1/chat/completions`（Ollama 0.1.x+ 支持）
 *   - apiKey 传任意非空字符串（Ollama 不校验,但 OpenAI 协议要求 header 存在）
 */
export class LocalLlmAssistant implements LlmAssistant {
  // ... 完整实现 v0.2.0 补
}
```

### 3.2 与 L1 的接口对齐

`LlmAssistant` 抽象已在 v0.1.0 大众版定义（[src/lib/assistant/types.ts](../src/lib/assistant/types.ts)）：

```typescript
export interface LlmAssistant extends AssistantProvider {
  isConfigured(): boolean;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
```

`LocalLlmAssistant` 实现此接口，注入方式与 `CloudLlmAssistant` 完全一致：

```typescript
// +layout.svelte（v0.2.0+ 修改）
if (llmMode === 'cloud' && isCloudLlmConfigured(cloudCfg)) {
  provideAssistant(new CloudLlmAssistant(cloudCfg));
} else if (llmMode === 'local' && isLocalLlmConfigured(localCfg)) {
  provideAssistant(new LocalLlmAssistant(localCfg));
} else {
  provideAssistant(null);
}
```

### 3.3 LLM 模式切换

v0.2.0 引入 `llmMode: 'cloud' | 'local'` 顶层配置（与 `llmConfig` / `localLlmConfig` 解耦）：

- 用户在 Settings 面板选择"云 LLM"或"本地 LLM"
- 同一时刻只能启用一种 LLM 模式（避免混淆）
- 切换模式需刷新页面（与 v0.1.0 配置变更策略一致）

---

## 4. Ollama 集成方案

### 4.1 Ollama 简述

[Ollama](https://ollama.com/) 是开源的本地 LLM 运行时，封装 llama.cpp，提供：

- 跨平台二进制（Windows / macOS / Linux）
- OpenAI 兼容端点（`/v1/chat/completions`，0.1.x+ 版本）
- 模型管理 CLI（`ollama pull qwen2.5:7b`）
- GPU 自动检测（CUDA / ROCm / Metal）

### 4.2 调用流程

```
用户在 LlmSettings 选 "本地 LLM" 模式
  ↓
配置 host=127.0.0.1 / port=11434 / model=qwen2.5:7b
  ↓
点击 "测试连接"
  ↓
LocalLlmAssistant.testConnection() → fetch http://127.0.0.1:11434/v1/chat/completions
  ↓
返回成功 → 注入 LocalLlmAssistant 到内核扩展槽
  ↓
DraftRuleDialog / ExplainRuleDialog / GenerateInputDialog 调用三方法
  ↓
与 L1 流程完全一致（用户审核确认才生效）
```

### 4.3 CORS 处理

Ollama 默认监听 `127.0.0.1:11434`，但浏览器 fetch 需要 CORS 头。两种方案：

- **方案 A**：用户启动 Ollama 时设置 `OLLAMA_ORIGINS=*`（开发友好，不安全）
- **方案 B**（推荐）：用户配置 `OLLAMA_ORIGINS=http://localhost:5174`（精确允许大众版 dev server）

文档需明确说明此配置步骤，并在 testConnection 失败时给出诊断提示（"如遇 CORS 错误，请配置 OLLAMA_ORIGINS 环境变量"）。

### 4.4 模型推荐

针对 evorule 三用途（草案 / 解释 / 输入）的轻量任务特点，推荐以下模型（按显存需求排序）：

| 模型              | 大小   | 显存需求（GPU）  | 适用场景                       |
| ----------------- | ------ | ---------------- | ------------------------------ |
| qwen2.5:1.5b      | 1.5B   | 2GB              | 入门 / 低配 GPU                |
| qwen2.5:7b        | 7B     | 6GB              | **推荐**，性价比高，JSON 输出稳定 |
| qwen2.5:14b       | 14B    | 12GB             | 高质量草案生成                 |
| llama3.1:8b       | 8B     | 6GB              | Meta 系，英文场景              |
| glm4:9b           | 9B     | 8GB              | 智谱系，中文场景优秀           |

> **JSON 输出稳定性**：推荐所有用户使用支持 `response_format: { type: 'json_object' }` 的模型（qwen2.5 / glm4 系列均支持），避免草案 JSON 解析失败。

---

## 5. GPU 配置面板设计

### 5.1 面板布局

新增 Settings 第三个 tab："GPU 配置"（仅 L2 模式可见）。

```
┌─────────────────────────────────────────┐
│ ⚙️ 设置                                 │
│ ┌─────┬─────────┬──────────┐           │
│ │🌐联网│🤖 LLM 配置│🖥️ GPU 配置│ ← 第3 tab │
│ └─────┴─────────┴──────────┘           │
│                                         │
│ GPU 设备                                │
│ ┌─────────────────────────────────┐    │
│ │ [NVIDIA GeForce RTX 4060  ▼]   │    │
│ │  显存: 8GB / 已用: 2.3GB        │    │
│ │  驱动: CUDA 12.4                │    │
│ └─────────────────────────────────┘    │
│                                         │
│ [✓] 启用 GPU 加速                       │
│ [✓] 推理时显示显存占用                  │
│                                         │
│ 当前模型: qwen2.5:7b                    │
│ [拉取新模型] [删除当前模型] [刷新状态]   │
└─────────────────────────────────────────┘
```

### 5.2 GPU 检测机制

大众版（浏览器环境）无法直接检测 GPU 硬件，需通过 Ollama API 间接获取：

```typescript
// GET http://127.0.0.1:11434/api/ps
// 返回当前加载的模型 + GPU 显存占用
{
  "models": [
    {
      "name": "qwen2.5:7b",
      "size": 4700000000,
      "details": {
        "gpu_layers": 80,  // GPU 层数
        "device": "NVIDIA GeForce RTX 4060"
      }
    }
  ]
}
```

GPU 设备下拉来源：`GET /api/tags`（已安装模型）+ `GET /api/ps`（当前加载）+ 用户手动输入（多卡场景）。

### 5.3 显存监控

推理过程中显存占用是动态的，UI 设计两种刷新策略：

- **手动刷新**：用户点击"刷新状态"按钮，调 `/api/ps` 拉取
- **自动刷新**：LLM 调用期间每 2 秒拉一次（可配置），调用结束停止

> **性能考量**：自动刷新会产生额外 HTTP 请求，默认关闭，用户主动开启。

---

## 6. 实施时机

### 6.1 优先级

L2 是付费扩展，实施时机取决于：

1. **大众版 v0.1.0 用户反馈**：是否有足够多政企用户提出本地 LLM 需求
2. **Ollama 成熟度**：跨平台稳定性、API 兼容性是否到位（2026 年 Ollama 已较成熟）
3. **商业模式验证**：付费扩展许可模型（AGPL-3.0 + 商业双许可）是否跑通

### 6.2 路线图建议

| 版本          | 计划                                        | 状态         |
| ------------- | ------------------------------------------- | ------------ |
| v0.1.0        | L1 云 LLM 完整实现                          | 开发中       |
| v0.2.0        | L2 Ollama 集成 + 基础 GPU 配置面板          | 规划中       |
| v0.3.0        | L2 模型管理 UI（拉取 / 删除 / 切换）         | 规划中       |
| v0.4.0        | L2 高级特性（多卡、显存预警、自动降级）      | 规划中       |

### 6.3 与高级版边界

高级版（独立仓）已规划本地 GPU LLM，与大众版 L2 边界：

- **大众版 L2**：SvelteKit Web 形态，浏览器 fetch 调本机 Ollama，依赖浏览器 CORS
- **高级版本地 LLM**：Tauri 桌面形态，原生 IPC 调本机 LLM 运行时，无 CORS 限制 + 加密 apiKey + 多卡调度

大众版 L2 是高级版本地 LLM 的**功能子集**，定位"尝鲜 / 入门本地 LLM"，高级版定位"生产级本地 LLM 工作站"。

---

## 7. 与大众版的边界

### 7.1 v0.1.0 不引入 L2 实现代码

- 大众版 v0.1.0 **不**包含 `local-llm-assistant.ts` / `local-llm-config.ts`
- LlmSettings.svelte 已含 L2 占位（"本地 LLM（付费扩展，敬请期待）"）
- 占位指向本文档

### 7.2 v0.2.0 引入 L2 的代码变更

- 新增 `src/lib/assistant/local-llm-assistant.ts`
- 新增 `src/lib/config/local-llm-config.ts`
- 修改 `src/lib/views/Settings/LlmSettings.svelte`：L2 占位替换为真实配置区
- 新增 `src/lib/views/Settings/GpuSettings.svelte`
- 修改 `src/routes/+layout.svelte`：增加 llmMode 顶层配置
- 新增 `tests/local-llm-flow.spec.ts`：mock Ollama API

### 7.3 商业许可

L2 作为付费扩展，可能采用以下许可模型之一（v0.2.0 发布前确定）：

- **AGPL-3.0 + 商业双许可**：开源版 AGPL，企业商业版付费去 AGPL 义务
- **功能模块许可**：核心 AGPL，L2 模块独立许可（需法律审查）

---

## 8. 安全考量

### 8.1 与 L1 的安全对比

| 维度         | L1 云 LLM                          | L2 本地 LLM                       |
| ------------ | ---------------------------------- | --------------------------------- |
| 数据出本机   | ✅ 是（调厂商 API）                 | ❌ 否（仅本机推理）                |
| apiKey 风险  | 中（localStorage 明文）             | 无（本地无鉴权）                   |
| 网络风险     | 中（依赖厂商可用性）                | 低（仅本机 loopback）              |
| 审计能力     | 弱（厂商日志不可控）                | 强（Ollama 日志可留痕）            |

### 8.2 LLM 输出确定性

**关键约束（与 L1 一致）**：

- LLM 输出是草案，必须经用户审核 + RuleValidator 校验才生效
- 执行链路完全不经过 LLM
- LLM 调用失败时降级为"用户手动编辑 JSON"，不阻塞规则引擎工作

L2 不引入新的确定性风险点。

---

## 9. 验收标准（v0.2.0 实施时使用）

- [ ] `LocalLlmAssistant` 实现 `LlmAssistant` 接口，三方法行为与 `CloudLlmAssistant` 一致
- [ ] Ollama 集成测试通过（真实 Ollama 服务 + qwen2.5:7b 模型）
- [ ] CORS 配置文档清晰，testConnection 失败时给出诊断提示
- [ ] GPU 配置面板能显示当前 GPU 设备 + 显存占用
- [ ] 用户审核确认机制与 L1 完全一致
- [ ] `npm run check` 0 errors
- [ ] `npx vitest run` PASS（含 L2 单测）
- [ ] `npx playwright test` PASS（含 L2 e2e，mock Ollama API）
- [ ] 商业许可模型已确定（v0.2.0 发布前）

---

## 10. 参考资源

- [Ollama 官方文档](https://ollama.com/)
- [Ollama OpenAI 兼容 API](https://ollama.com/blog/openai-compatibility)
- [Ollama 环境变量配置](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-expose-ollama-on-the-network)
- [Qwen2.5 模型列表](https://ollama.com/library/qwen2.5)

---

## 修订记录

| 日期       | 版本 | 修订内容                                       |
| ---------- | ---- | ---------------------------------------------- |
| 2026-08-03 | v0.1 | 初稿，作为 evorule-console-cloud v0.1.0 L2 规划 |
