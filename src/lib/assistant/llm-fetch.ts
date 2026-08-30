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

/** 对话历史中的一条消息（仅 role + content，不含 system） */
export interface ChatHistoryMessage {
	role: 'user' | 'assistant';
	content: string;
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
	/**
	 * 可选对话历史(多轮):按时间顺序，会拼在 system 之后、当前 userMessage 之前。
	 * 用于右侧 LLM 交互侧栏的连续对话。三个定向任务(draft/explain/input)不传此字段。
	 */
	history?: ChatHistoryMessage[];
	/** 温度(默认 0.2,偏确定性,适合规则草案生成) */
	temperature?: number;
	/** 超时(默认 30 秒) */
	timeoutMs?: number;
}

/**
 * 构造 OpenAI 兼容 messages 数组。
 *
 * 顺序:system(可选) → history(按时间顺序) → 当前 userMessage。
 *
 * 导出动机(审计桥 2026-08-30):audited-llm 侧车协议把 prompt 全文写入
 * 审计链命令事实,必须与本函数实际发给 LLM 的 messages 完全一致
 * (单一构造点,防审计内容与真实请求漂移)。
 */
export function buildMessages(params: Pick<ChatApiParams, 'userMessage' | 'systemMessage' | 'history'>): Array<{ role: string; content: string }> {
	const messages: Array<{ role: string; content: string }> = [];
	if (params.systemMessage) {
		messages.push({ role: 'system', content: params.systemMessage });
	}
	if (params.history && params.history.length > 0) {
		for (const h of params.history) {
			messages.push({ role: h.role, content: h.content });
		}
	}
	messages.push({ role: 'user', content: params.userMessage });
	return messages;
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
		history,
		temperature = 0.2,
		timeoutMs = 30_000
	} = params;

	// 构造 messages(system → history → user,单一构造点见 buildMessages)
	const messages = buildMessages({ userMessage, systemMessage, history });

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
		// 其他网络错误(连接拒绝 / DNS / CORS)— 不写入 apiKey,面向非程序员给出可行动提示
		const host = safeHost(apiEndpoint);
		throw new LlmNetworkError(
			`无法连接 LLM 服务(网络错误)${host ? `,端点 ${host}` : ''}。请检查网络连接与 apiEndpoint 地址`
		);
	}
	clearTimeout(timer);

	// 错误状态码处理
	if (!r.ok) {
		// 读取错误响应体(可能含厂商错误信息)
		const text = await r.text().catch(() => '');
		// 优先提取结构化的厂商错误消息(如 {error:{message}}),提取不到才回退原始文本
		const vendorMsg = extractVendorMessage(text);
		// 防御性脱敏:从响应体中清除 apiKey(防止厂商回显 apiKey 进错误消息)
		const safeText = redactSecret(vendorMsg || text, apiKey).slice(0, 300);
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
		error?: unknown;
	};

	// 2xx 但响应体带 error 字段:部分厂商对业务错误(模型不存在/余额不足/内容安全)返回 200 + error 体。
	// 不静默掩盖:把厂商真实错误透出,避免用户看到误导性的"无 choices"。
	if (data && data.error !== undefined) {
		const vendorMsg = vendorErrorToString(data.error);
		throw new LlmApiError(
			`LLM 返回错误: ${redactSecret(vendorMsg, apiKey).slice(0, 300)}`,
			r.status
		);
	}

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

/**
 * 提取端点的 host(用于错误提示)。端点是连接地址、非密钥,可展示给用户。
 *
 * @param endpoint 完整 apiEndpoint
 * @returns host(如 `api.minimax.chat`);解析失败返回空串
 */
function safeHost(endpoint: string): string {
	try {
		return new URL(endpoint).host;
	} catch {
		return '';
	}
}

/**
 * 从厂商错误响应体文本中提取可读的错误消息(非 2xx 场景)。
 *
 * 兼容形态:
 *   - `{"error":{"message":"..."}}` / `{"error":"..."}` / `{"message":"..."}`
 *   - 非 JSON(纯文本) → 返回空串,由调用方回退原文
 *
 * @param body 响应体文本
 * @returns 提取出的错误消息(无则空串)
 */
function extractVendorMessage(body: string): string {
	if (!body) return '';
	try {
		const parsed = JSON.parse(body) as {
			error?: unknown;
			message?: unknown;
			msg?: unknown;
		};
		if (parsed.error !== undefined) return vendorErrorToString(parsed.error);
		if (typeof parsed.message === 'string') return parsed.message;
		if (typeof parsed.msg === 'string') return parsed.msg;
		return '';
	} catch {
		// 非 JSON(纯文本错误),交给调用方回退原文
		return '';
	}
}

/**
 * 把厂商错误值(已解析)转成可读消息。
 *
 * 兼容:
 *   - 字符串(`"balance insufficient"`)
 *   - `{ message: "..." }` / `{ msg: "..." }`
 *   - 其他对象 → JSON 序列化
 *   - 其他原始值 → String()
 *
 * @param error 厂商返回的 error 值
 * @returns 可读错误消息
 */
function vendorErrorToString(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object') {
		const e = error as { message?: unknown; msg?: unknown };
		if (typeof e.message === 'string') return e.message;
		if (typeof e.msg === 'string') return e.msg;
		// 无法提取,返回序列化(供用户参考)
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	return String(error);
}
