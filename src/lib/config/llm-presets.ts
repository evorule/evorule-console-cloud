// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 厂商预设(OpenAI 兼容端点)
//
// 设计:
//   - 每个预设含 provider id + 显示名 + apiEndpoint + 推荐模型 + 是否需要 apiKey
//   - 用户在 Settings 面板选预设 → 自动填 apiEndpoint + model + 清空旧 apiKey
//   - "custom" 预设允许用户自定义 endpoint
//
// 兼容性:
//   - 所有预设都是 OpenAI 兼容的 /v1/chat/completions 端点
//   - 文心一言(百度)原生不完全 OpenAI 兼容,标记为 needsAdapter=true(后续适配)
//   - 其他主流厂商都已提供 OpenAI 兼容端点
//   - Ollama(本机)同为 OpenAI 兼容协议,无需 Key 即可直连(端点 127.0.0.1:11434)

export interface LlmPreset {
	/** 厂商 id(对应 CloudLlmConfig.provider) */
	provider: string;
	/** 显示名 */
	label: string;
	/** OpenAI 兼容端点完整 URL */
	apiEndpoint: string;
	/** 推荐默认模型(用户可改) */
	defaultModel: string;
	/** 备选模型列表(供下拉选) */
	models: string[];
	/** 是否需要适配层(原生不兼容 OpenAI 协议) */
	needsAdapter?: boolean;
	/** 适配层说明(needsAdapter=true 时显示) */
	adapterNote?: string;
	/** 帮助文档 URL(申请 Key / 安装指引) */
	helpUrl?: string;
	/** 预设占位 Key(如 Ollama 不校验 Key 但客户端要求非空;切换预设且用户未填 Key 时自动填入) */
	presetApiKey?: string;
}

/**
 * 支持的 LLM 厂商预设(按推荐度排序)。
 *
 * 国产厂商优先(用户主要在国内),OpenAI 兼容端点:
 *   - 智谱 GLM:免费额度大,GLM-4-Flash 适合开发测试
 *   - 通义千问:阿里云,需 DashScope API key
 *   - DeepSeek:性价比高
 *   - OpenAI:国际标准,需翻墙或代理
 *   - 文心一言:暂未原生兼容,标记 needsAdapter
 *   - 自定义:用户自填 endpoint
 */
export const LLM_PRESETS: LlmPreset[] = [
	{
		provider: 'glm',
		label: '智谱 GLM(推荐,有免费额度)',
		apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		defaultModel: 'glm-4-flash',
		models: ['glm-4-flash', 'glm-4', 'glm-4-air', 'glm-4-long'],
		helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
	},
	{
		provider: 'qwen',
		label: '通义千问(阿里云)',
		apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
		defaultModel: 'qwen-plus',
		models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
		helpUrl: 'https://dashscope.console.aliyun.com/apiKey'
	},
	{
		provider: 'deepseek',
		label: 'DeepSeek(性价比高)',
		apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
		defaultModel: 'deepseek-chat',
		models: ['deepseek-chat', 'deepseek-reasoner'],
		helpUrl: 'https://platform.deepseek.com/api_keys'
	},
	{
		provider: 'minimax',
		label: 'MiniMax(海螺AI)',
		// 2026-09-01(UV-030 实测):api.minimax.chat 已废弃;现网 OpenAI 兼容端点为
		// api.minimaxi.com/v1/text/chatcompletion_v2(与 helpUrl 平台一致,实测通过)
		apiEndpoint: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
		defaultModel: 'MiniMax-Text-01',
		models: ['MiniMax-Text-01', 'MiniMax-M2.5'],
		helpUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
	},
	{
		provider: 'kimi',
		label: 'Kimi(Moonshot)',
		apiEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
		defaultModel: 'kimi-k2-0905-preview',
		models: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
		helpUrl: 'https://platform.moonshot.cn/console/api-keys'
	},
	{
		provider: 'openai',
		label: 'OpenAI(国际标准,需代理)',
		apiEndpoint: 'https://api.openai.com/v1/chat/completions',
		defaultModel: 'gpt-4o-mini',
		models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
		helpUrl: 'https://platform.openai.com/api-keys'
	},
	{
		provider: 'ollama',
		label: 'Ollama(本机,无需联网/Key)',
		apiEndpoint: 'http://127.0.0.1:11434/v1/chat/completions',
		defaultModel: 'qwen3:8b',
		models: ['qwen3:8b', 'qwen3:4b', 'deepseek-r1:8b', 'llama3.1:8b', 'glm4:9b'],
		helpUrl: 'https://ollama.com/download',
		/** Ollama 不校验 Key,但 OpenAI 兼容客户端要求非空,固定占位值 */
		presetApiKey: 'ollama'
	},
	{
		provider: 'ernie',
		label: '文心一言(百度,暂不兼容,待适配)',
		apiEndpoint: '',
		defaultModel: '',
		models: [],
		needsAdapter: true,
		adapterNote:
			'文心一言原生 API 与 OpenAI 协议有差异,大众版 v0.1.0 暂不支持。后续版本会增加适配层。'
	},
	{
		provider: 'custom',
		label: '自定义(填 endpoint)',
		apiEndpoint: '',
		defaultModel: '',
		models: []
	}
];

/**
 * 根据 provider id 查找预设。
 */
export function findPreset(provider: string): LlmPreset | undefined {
	return LLM_PRESETS.find((p) => p.provider === provider);
}

/**
 * 获取预设下拉选项(用于 Settings UI)。
 */
export function getPresetOptions(): Array<{ value: string; label: string; disabled?: boolean }> {
	return LLM_PRESETS.map((p) => ({
		value: p.provider,
		label: p.label,
		disabled: p.needsAdapter === true
	}));
}
