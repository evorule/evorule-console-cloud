// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM Assistant 类型(基于内核 AssistantProvider 扩展)
//
// 设计:
//   - LlmAssistant 继承内核 AssistantProvider(kernel 镜像四方法
//     generateRuleDraft/explainRule/generateInput/transpileFlow)
//   - 大众版新增"配置完备性"与"测试连接"能力,用于决定是否注入内核扩展槽
//   - CloudLlmConfig 是大众版 LLM 配置的数据契约(apiEndpoint + apiKey + model + enabled)
//
// 与内核边界:
//   - 内核只看到 AssistantProvider(四方法),不知道 CloudLlmConfig
//   - 大众版 LlmAssistant 继承 AssistantProvider,新增 isConfigured() 等大众版独有方法
//   - 内核 import { AssistantProvider } from '$lib/kernel' 仍是隔离的

import type { AssistantProvider } from '$lib/kernel';

/**
 * LLM Assistant 抽象(大众版内部用)。
 *
 * 继承内核 AssistantProvider(四方法),新增:
 *   - isConfigured(): 配置是否完备(apiKey/endpoint 都有)
 *   - testConnection(): 测试连接(用当前配置 ping LLM API,不产生草案)
 *
 * 这些方法大众版内部决定是否注入 provider 到内核扩展槽用,
 * 内核不感知(内核只调四方法)。
 */
export interface LlmAssistant extends AssistantProvider {
	/** 当前配置是否完备(apiKey 非空 + endpoint 非空 + model 非空) */
	isConfigured(): boolean;

	/** 测试连接(返回成功/失败 + 信息;不产生草案,不影响状态) */
	testConnection(): Promise<{ ok: boolean; message: string }>;

	/**
	 * 第 4 操作(07 立项 §2.2 L2 P2):自然语言 → 命令(指令) JSON 草稿。
	 *
	 * 产物是**草稿**:填入执行台 textarea 由用户可见可改,人点击提交才走
	 * 既有命令链;LLM 永远不直接提交命令。走既有双通道审计链
	 * (purpose=transpile_command)。内核不感知本方法(大众版独有)。
	 */
	transpileCommand(nl: string): Promise<object>;
}

/**
 * LLM 执行通道(UV-172 P2,2026-09-12 裁定双通道并存):
 *   - 'browser':浏览器直连 LLM API(用户自有 key,经审计桥侧车协议入链)——现状默认
 *   - 'server':服务端执行者(ai-plugin 托管凭据,自编排审计回路;服务端点
 *     /api/services/ai_plugin_chat/invoke 返回 reply+session_id)——凭据不落浏览器
 */
export type LlmChannel = 'browser' | 'server';

/**
 * LLM Key 本机保存形态（UV-178 批次B 凭据安全）:
 *   - 'none':未保存 Key
 *   - 'plain':明文存于 localStorage(旧版兼容形态/显式选择,不推荐)
 *   - 'encrypted':经口令 AES-256-GCM 加密后存于 localStorage(keyEnc 块)
 */
export type LlmKeyStorage = 'none' | 'plain' | 'encrypted';

/**
 * 云 LLM 配置(大众版)。
 *
 * 持久化在 localStorage(key: evorule-console-cloud:llm-config)。
 * enabled=false 时,大众版不注入 provider,行为与内核一致(LLM 按钮不渲染)。
 *
 * 安全约束(UV-178 批次B):
 *   - apiKey 仅运行时明文(内存);落盘形态由 keyStorage 决定:
 *     加密(AES-GCM+PBKDF2 口令,见 config/key-crypto.ts)为缺省,
 *     明文仅旧版配置兼容或用户显式选择
 *   - locked=true 表示已加密存盘但本会话未解锁(运行时派生态,
 *     持久化不写此字段;解锁经 llm-config 的 unlockLlmApiKey)
 *   - apiKey 不进日志/错误/URL(详见 cloud-llm-assistant.ts)
 *   - channel='server' 时 apiEndpoint/apiKey 不使用(凭据在 ai-plugin 侧,
 *     推荐环境变量注入),model 作为可选覆盖传给服务端点(空=用插件缺省)
 */
export interface CloudLlmConfig {
	enabled: boolean;
	channel: LlmChannel;
	provider: string; // 'openai' | 'qwen' | 'ernie' | 'glm' | 'custom'
	apiEndpoint: string; // 完整 URL,如 https://api.openai.com/v1/chat/completions
	apiKey: string; // 运行时明文(内存);落盘形态由 keyStorage 决定
	model: string; // 如 gpt-4o-mini / qwen-plus / ernie-4.0-turbo
	keyStorage: LlmKeyStorage;
	/** 已加密存盘但本会话未解锁(运行时态;持久化不写) */
	locked: boolean;
}

/** 默认配置:LLM 关闭 + OpenAI 预设 + 浏览器通道(向后兼容:老配置无 channel 字段) */
export const DEFAULT_LLM_CONFIG: CloudLlmConfig = {
	enabled: false,
	channel: 'browser',
	provider: 'openai',
	apiEndpoint: 'https://api.openai.com/v1/chat/completions',
	apiKey: '',
	model: 'gpt-4o-mini',
	keyStorage: 'none',
	locked: false
};
