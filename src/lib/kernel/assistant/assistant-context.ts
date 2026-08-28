// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console AssistantProvider — Svelte context 注入
//
// 依据: docs/MASS_EDITION_IMPLEMENTATION_PLAN.md 阶段1
// 设计: 仿照 backend-context.ts 模式,但默认 null(不创建默认实例)
//   - evorule-console 自身不注入 provider(默认 null,LLM 按钮不渲染)
//   - 大众版在 +layout.svelte 调 provideAssistant(cloudLlmAssistant) 注入
//   - 视图通过 useAssistantOrNull() 取 provider,null 时 LLM 按钮不渲染
//
// 为什么不破坏"无智能"边界:
//   - evorule-console 自身不引入任何 LLM 依赖(无 openai/无 fetch LLM 代码)
//   - 扩展槽是空的(默认 null),如同 ExecutionBackend 接口 portal-core 只定义
//     不实现网络版
//   - "智能"行为(调 LLM)只在大众版注入 provider 后才发生,且 LLM 只生成草案
//     (规则即数据,用户审核)— 不破坏执行确定性

import { getContext, setContext, hasContext } from 'svelte';
import type { AssistantProvider } from './types';

const ASSISTANT_CONTEXT_KEY = Symbol('evorule-console:assistant-provider');

/**
 * 在根组件(+layout.svelte)调用,注入 assistant provider 实例。
 *
 * evorule-console 自身不调用此函数(或传 null),LLM 按钮不渲染。
 * 大众版调用 provideAssistant(cloudLlmAssistant) 注入实现。
 *
 * @param provider LLM 辅助实例,传 null 或不传 = 不注入(默认)
 */
export function provideAssistant(
  provider: AssistantProvider | null = null,
): AssistantProvider | null {
  setContext<AssistantProvider | null>(ASSISTANT_CONTEXT_KEY, provider);
  return provider;
}

/**
 * 在子组件调用,取出注入的 assistant provider。
 *
 * @returns provider 实例;未注入或 evorule-console 自身运行时返回 null
 *
 * 视图用法:
 * ```svelte
 * const assistant = useAssistantOrNull();
 * {#if assistant}
 *   <button onclick={() => assistant.generateRuleDraft(...)}>AI 辅助创建</button>
 * {/if}
 * ```
 */
export function useAssistantOrNull(): AssistantProvider | null {
  if (!hasContext(ASSISTANT_CONTEXT_KEY)) return null;
  return getContext<AssistantProvider | null>(ASSISTANT_CONTEXT_KEY);
}
