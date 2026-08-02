// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM Context 转发器(大众版 -> 内核扩展槽)
//
// 设计:
//   - 大众版的 LlmAssistant 在大众版内部用,内核只看 AssistantProvider
//   - provideLlm() 接受 LlmAssistant,转发到内核 provideAssistant(provider)
//   - 这样大众版内部可以用 LlmAssistant 类型(含 isConfigured/testConnection),
//     内核扩展槽也能拿到 provider(三方法),双方各取所需
//
// 为什么需要单独的转发函数:
//   - 内核 provideAssistant 接受 AssistantProvider|null,大众版的 LlmAssistant 是超集
//   - 直接调用内核函数也能用(类型兼容),但单独函数便于:
//       a) 集中处理 null case(配置不完备时返回 null)
//       b) 大众版内部统一入口,后续可加日志/审计

import { provideAssistant } from '@evorule/console';
import type { LlmAssistant } from './types';

/**
 * 在根组件(+layout.svelte)调用,把 LlmAssistant 注入到内核扩展槽。
 *
 * @param assistant LlmAssistant 实例;传 null 或不传 = 不注入(LLM 按钮不渲染)
 * @returns 转发到内核 provideAssistant 的返回值
 *
 * 用法:
 * ```ts
 * const cloud = new CloudLlmAssistant(config);
 * provideLlm(cloud);  // 注入到内核,视图 LLM 按钮渲染
 * ```
 *
 * 配置不完备时调用方应传 null(不注入),让内核行为与"无 LLM"一致。
 */
export function provideLlm(assistant: LlmAssistant | null = null): void {
	// 转发到内核扩展槽
	// 类型上 LlmAssistant(超集) 兼容 AssistantProvider(子集),传给内核安全
	provideAssistant(assistant);
}
