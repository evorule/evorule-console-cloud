// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM HTTP 客户端(OpenAI 兼容 /v1/chat/completions)
//
// 设计:
//   - 单一函数 callChatApi(),封装 fetch 调用 + 错误处理 + apiKey 注入
//   - 错误分类:
//       LlmNetworkError   — 网络错误(连接拒绝 / DNS / CORS)
//       LlmAuthError      — 401(apiKey 失效)
//       LlmRateLimitError — 429(限流)
//       LlmApiError        — 其他 HTTP 错误(500 / 400 等)
//       LlmParseError      — JSON 解析失败(响应不是合法 JSON)
//       LlmResponseError   — 响应结构异常(无 choices 等)
//   - apiKey 安全:不进日志/不进 error.message/不进 URL(只放 Authorization header)
//
// OpenAI 兼容请求格式:
//   POST {apiEndpoint}
//   Headers: Authorization: Bearer {apiKey}, Content-Type: application/json
//   Body: { model, messages: [{role, content}], temperature }
// 响应格式:
//   { choices: [{ message: { content: "..." } }] }

/** LLM 错误类型(便于 UI 区分提示) */
export class LlmError extends Error {
	constructor(
		message: string,
		public readonly kind:
			| 'network'
			| 'auth'
			| 'rate_limit'
			| 'api'
			| 'parse'
			| 'response',
		public readonly status?: number
	) {
		super(message);
		this.name = 'LlmError';
	}
}

/** 网络错误(连接拒绝 / DNS / CORS) */
export class LlmNetworkError extends LlmError {
	constructor(message: string) {
		super(message, 'network', 0);
		this.name = 'LlmNetworkError';
	}
}

/** 鉴权错误(401,apiKey 失效) */
export class LlmAuthError extends LlmError {
	constructor(message: string) {
		super(message, 'auth', 401);
		this.name = 'LlmAuthError';
	}
}

/** 限流错误(429) */
export class LlmRateLimitError extends LlmError {
	constructor(message: string) {
		super(message, 'rate_limit', 429);
		this.name = 'LlmRateLimitError';
	}
}

/** 其他 API 错误(500 / 400 等) */
export class LlmApiError extends LlmError {
	constructor(message: string, status: number) {
		super(message, 'api', status);
		this.name = 'LlmApiError';
	}
}

/** JSON 解析失败 */
export class LlmParseError extends LlmError {
	constructor(message: string) {
		super(message, 'parse', 200);
		this.name = 'LlmParseError';
	}
}

/** 响应结构异常(如无 choices 字段) */
export class LlmResponseError extends LlmError {
	constructor(message: string) {
		super(message, 'response', 200);
		this.name = 'LlmResponseError';
	}
}

/** Chat API 请求参数 */
export interface ChatApiParams {
	apiEndpoint: string;
	apiKey: string;
	model: string;
	/** 用户消息(prompt) */
	userMessage: string;
	/** 可选系统消息(默认空,统一由 userMessage 承载) */
	systemMessage?: string;
	/** 温度(默认 0.2,偏确定性,适合规则草案生成) */
	temperature?: number;
	/** 超时(默认 30 秒) */
	timeoutMs?: number;
}

/**
 * 调用 OpenAI 兼容 /v1/chat/completions,返回 assistant 回复文本。
 *
 * 错误处理:
 *   - 网络错误 → LlmNetworkError
 *   - 401       → LlmAuthError
 *   - 429       → LlmRateLimitError
 *   - 其他非 2xx → LlmApiError
 *   - JSON 解析失败 → LlmParseError
 *   - 无 choices[0].message.content → LlmResponseError
 *
 * apiKey 安全:
 *   - 仅出现在 Authorization header,不进 URL query
 *   - 不写入 error.message(避免日志/控制台泄露)
 *   - 不写入 console(本文件无 console.* 调用)
 *
 * @throws LlmError 子类
 * @returns assistant 回复文本
 */
export async function callChatApi(params: ChatApiParams): Promise<string> {
	const {
		apiEndpoint,
		apiKey,
		model,
		userMessage,
		systemMessage,
		temperature = 0.2,
		timeoutMs = 30_000
	} = params;

	// 构造 messages
	const messages: Array<{ role: string; content: string }> = [];
	if (systemMessage) {
		messages.push({ role: 'system', content: systemMessage });
	}
	messages.push({ role: 'user', content: userMessage });

	const body = JSON.stringify({
		model,
		messages,
		temperature,
		stream: false
	});

	// 用 AbortController 实现超时
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let r: Response;
	try {
		r = await fetch(apiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body,
			signal: controller.signal
		});
	} catch (e) {
		clearTimeout(timer);
		const err = e as Error;
		// abort 触发的错误
		if (err.name === 'AbortError') {
			throw new LlmNetworkError(`LLM 请求超时(${timeoutMs}ms)`);
		}
		// 其他网络错误(连接拒绝 / DNS / CORS)— 不写入 apiKey
		throw new LlmNetworkError(`LLM 网络错误: ${err.message}`);
	}
	clearTimeout(timer);

	// 错误状态码处理
	if (!r.ok) {
		// 读取错误响应体(可能含厂商错误信息)
		const text = await r.text().catch(() => '');
		// 防御性脱敏:从响应体中清除 apiKey(防止厂商回显 apiKey 进错误消息)
		const safeText = redactSecret(text, apiKey).slice(0, 300);
		if (r.status === 401) {
			throw new LlmAuthError(`LLM 鉴权失败(401): apiKey 无效或已失效`);
		}
		if (r.status === 429) {
			throw new LlmRateLimitError(`LLM 限流(429): 请求过于频繁,请稍后重试`);
		}
		throw new LlmApiError(
			`LLM API 错误(${r.status}): ${safeText || '无响应体'}`,
			r.status
		);
	}

	// 解析 JSON
	let json: unknown;
	try {
		json = await r.json();
	} catch (e) {
		throw new LlmParseError(`LLM 响应 JSON 解析失败: ${(e as Error).message}`);
	}

	// 提取 content(OpenAI 兼容结构 choices[0].message.content)
	const data = json as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	if (
		!data ||
		!Array.isArray(data.choices) ||
		data.choices.length === 0 ||
		!data.choices[0]?.message?.content
	) {
		throw new LlmResponseError(
			`LLM 响应结构异常: 无 choices[0].message.content`
		);
	}

	return data.choices[0].message.content as string;
}

// ============================================================================
// 内部工具
// ============================================================================

/**
 * 从文本中脱敏 secret(apiKey 等)。
 *
 * 用途:错误响应体可能含厂商回显的 apiKey,需在写入 error.message 前脱敏。
 *
 * 策略:把 secret 字符串替换为 "***REDACTED***"。
 * 不影响其他文本,只替换完全匹配的 secret 子串。
 *
 * @param text 原始文本(可能含 secret)
 * @param secret 需要脱敏的 secret(apiKey)
 * @returns 脱敏后的文本
 */
function redactSecret(text: string, secret: string): string {
	if (!secret || secret.length === 0) return text;
	// 用全局替换(escapeRegExp 避免特殊字符问题)
	const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return text.replace(new RegExp(escaped, 'g'), '***REDACTED***');
}
