// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 审计桥(浏览器侧 AuditedLlm 侧车协议)
//
// 对齐 evo-agent audited_llm.rs 的协议契约(2026-08-30 审计桥专项):
//   create_session → subscribe_events(SSE) → submit_command(call_external)
//     └─ 命令事实入审计链(承载 prompt 全文,即实际发给 LLM 的 messages)
//   IoRequest 事件 → 浏览器本地执行 LLM(callChatApi) → submit_io_response
//     └─ io_response 事实入审计链(承载结果全文)
//   Stable 事件 → 返回本地执行结果
//
// 关键约束(与 server/governance 侧联动):
//   - server 端 IoSubscriber 已带 skip 谓词(is_llm_audit_request):call_external
//     且带 messages 的 IoRequest 不被内置订阅者自动应答,留给本桥处理
//   - 必须先订阅 SSE 再提交命令(broadcast 通道不重放历史)
//   - LLM 执行失败也要回写错误 io_response(引擎状态机收尾,不留悬空 IoRequest)
//   - 无静默直连兜底:server 不可达/协议失败如实报错,调用方展示
//
// server 基址与凭据:复用 netConfig store(与 CloudHttpBackend 同一解析逻辑:
// offline → DEFAULT_LOCAL_BASE_URL,online → remoteBaseUrl;authToken 可选)。
// SSE 用 fetch 流式读取而非 EventSource:后者无法携带 Authorization 头
// (server 开启认证时 SSE 也会 401)。

import { get } from 'svelte/store';
import { netConfig } from '$lib/config/net-config';
import { DEFAULT_LOCAL_BASE_URL } from '$lib/backend/types';
import { buildMessages, callChatApi, type ChatApiParams } from './llm-fetch';

/**
 * 每个等待点的超时(毫秒)。
 *
 * 与 evo-agent DEFAULT_AUDITED_CALL_TIMEOUT_SECS(90s)同量级:作用于
 * HTTP 请求 / 下一个 SSE 事件,并非全周期硬上限。LLM 本地执行沿用
 * callChatApi 自身的 timeoutMs(默认 30s)。
 */
export const SIDECAR_WAIT_TIMEOUT_MS = 90_000;

/** 审计用途标签(随命令事实入审计链,供审计侧区分调用类别) */
export type AuditPurpose =
	| 'draft_rule'
	| 'explain_rule'
	| 'gen_tests'
	| 'chat'
	| 'help_qa'
	// L2 P2(07 立项 §2.2):执行台 NL→命令转译器,第 4 操作
	| 'transpile_command';

/** 审计桥错误(kind 便于 UI/日志区分失败阶段) */
export class AuditedBridgeError extends Error {
	constructor(
		message: string,
		public readonly kind: 'server_unreachable' | 'protocol' | 'engine',
		public readonly sessionId?: string
	) {
		super(message);
		this.name = 'AuditedBridgeError';
	}
}

/** SSE 事件(server 侧事实 JSON,type 字段区分事件类别) */
interface SidecarEvent {
	type?: string;
	id?: number;
	message?: string;
	io_type?: string;
	[key: string]: unknown;
}

/** 带超时的 fetch(每个 HTTP 等待点;调用方 signal 与超时任一触发即中止) */
async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	step: string
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	// 桥接调用方 signal:若直接 { ...init, signal } 覆盖,init.signal 会被静默
	// 丢弃,调用方(如 SSE 订阅收尾的中止)失效,流只能靠页面卸载被浏览器强制
	// 中止并产生 net::ERR_ABORTED 控制台噪声。桥接后任一方触发即中止;且
	// JS 主动中止不产生浏览器 ERR_ABORTED 报错(浏览器强制中止才有)。
	const external = init.signal;
	const onExternalAbort = () => controller.abort();
	if (external) {
		if (external.aborted) controller.abort();
		else external.addEventListener('abort', onExternalAbort);
		// 监听器不主动移除:SSE 场景调用方需在 body 读取期间持续保有中止
		// 通道,而本函数职责止于响应头返回;监听器闭包随调用方 signal 一起
		// 被 GC,无累积泄漏。caller abort 在等待阶段触发时报"被调用方中止"。
	}
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (e) {
		const err = e as Error;
		if (err.name === 'AbortError') {
			throw new AuditedBridgeError(
				external?.aborted
					? `审计桥 ${step} 被调用方中止`
					: `审计桥超时(${step},${timeoutMs}ms)`,
				'protocol'
			);
		}
		throw new AuditedBridgeError(
			`无法连接 evorule-server(审计桥 ${step}),请确认服务已启动:${url}`,
			'server_unreachable'
		);
	} finally {
		clearTimeout(timer);
	}
}

/** 非 2xx 统一转 AuditedBridgeError(带状态码与截断响应体) */
async function assertOk(r: Response, step: string, sessionId: string): Promise<void> {
	if (r.ok) return;
	let body = '';
	try {
		body = (await r.text()).slice(0, 200);
	} catch {
		// 响应体不可读时留空
	}
	throw new AuditedBridgeError(
		`evorule-server ${step} 失败(HTTP ${r.status})${body ? `: ${body}` : ''}`,
		'protocol',
		sessionId
	);
}

/** 解析当前 server 基址(与 CloudHttpBackend.resolveBaseUrl 同逻辑) */
function resolveBaseUrl(): string {
	const cfg = get(netConfig);
	const url = cfg.mode === 'online' ? cfg.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
	return url.replace(/\/+$/, '');
}

/** 请求头(可选 Bearer 凭据,与内核 HttpBackend 一致) */
function buildHeaders(): Record<string, string> {
	const cfg = get(netConfig);
	const h: Record<string, string> = { 'Content-Type': 'application/json' };
	if (cfg.authToken) {
		h['Authorization'] = `Bearer ${cfg.authToken}`;
	}
	return h;
}

/**
 * 审计链内执行一次 LLM 对话(浏览器侧侧车协议)。
 *
 * @param params 与 callChatApi 相同的聊天参数(含 system/history)
 * @param auditPurpose 审计用途标签(写入命令事实 params.audit_purpose)
 * @returns assistant 回复文本(与 callChatApi 返回一致)
 * @throws AuditedBridgeError(server 不可达 / 协议失败 / 引擎 Error 事件)
 * @throws LlmError 子类(LLM 本身执行失败,错误已先回写 io_response)
 */
export async function callChatApiAudited(
	params: ChatApiParams & { auditPurpose: AuditPurpose }
): Promise<string> {
	const { auditPurpose, ...chatParams } = params;
	const base = resolveBaseUrl();
	const headers = buildHeaders();
	const wait = SIDECAR_WAIT_TIMEOUT_MS;

	// 1. 一次性 sidecar 会话
	let sessionId = '';
	try {
		const r = await fetchWithTimeout(
			`${base}/api/sessions`,
			{ method: 'POST', headers, body: '{}' },
			wait,
			'create_session'
		);
		const json = (await r.json().catch(() => null)) as { session_id?: unknown } | null;
		if (!r.ok || !json || typeof json.session_id !== 'number') {
			sessionId = json && typeof json.session_id === 'number' ? String(json.session_id) : '';
			throw new AuditedBridgeError(
				`evorule-server create_session 失败(HTTP ${r.status})`,
				'protocol'
			);
		}
		sessionId = String(json.session_id);
	} catch (e) {
		if (e instanceof AuditedBridgeError) throw e;
		throw new AuditedBridgeError(
			`无法连接 evorule-server(审计桥 create_session),请确认服务已启动:${base}`,
			'server_unreachable'
		);
	}

	// 2. 必须先订阅再提交命令(broadcast 通道不重放历史)
	//    SSE 用 fetch 流式读取(可带 Authorization 头,EventSource 不行)。
	const streamCtl = new AbortController();
	try {
		const r = await fetchWithTimeout(
			`${base}/api/sessions/${sessionId}/events`,
			{ headers, signal: streamCtl.signal },
			wait,
			'subscribe_events'
		);
		await assertOk(r, 'subscribe_events', sessionId);
		if (!r.body) {
			throw new AuditedBridgeError('SSE 响应无 body(协议异常)', 'protocol', sessionId);
		}
		const rd = r.body.getReader();

		// 3. 提交 call_external 命令 —— prompt 全文(messages)入审计链
		const commandParams = {
			model: chatParams.model,
			temperature: chatParams.temperature ?? 0.2,
			messages: buildMessages({
				userMessage: chatParams.userMessage,
				systemMessage: chatParams.systemMessage,
				history: chatParams.history
			}),
			audit_purpose: auditPurpose
		};
		const cr = await fetchWithTimeout(
			`${base}/api/sessions/${sessionId}/command`,
			{
				method: 'POST',
				headers,
				body: JSON.stringify({ instruction: { type: 'call_external', params: commandParams } })
			},
			wait,
			'submit_command'
		);
		await assertOk(cr, 'submit_command', sessionId);

		// 4. 事件回路:IoRequest → 本地执行 → io_response;Stable → 完成
		let llmReply: string | null = null;
		let buffer = '';
		const decoder = new TextDecoder();

		// 读下一个 SSE data 事件(带超时;流关闭返回 null)
		async function nextEvent(): Promise<SidecarEvent | null> {
			for (;;) {
				const idx = buffer.indexOf('\n\n');
				if (idx !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const dataLine = raw
						.split('\n')
						.find((l) => l.startsWith('data:'));
					if (!dataLine) continue; // 注释/心跳行,跳过
					const jsonPart = dataLine.slice(5).trim();
					if (!jsonPart) continue;
					try {
						return JSON.parse(jsonPart) as SidecarEvent;
					} catch {
						throw new AuditedBridgeError(
							`SSE 事件 JSON 解析失败:${jsonPart.slice(0, 100)}`,
							'protocol',
							sessionId
						);
					}
				}
				const chunk = await withEventTimeout(rd.read());
				if (chunk.done) return null;
				buffer += decoder.decode(chunk.value, { stream: true });
			}
		}

		// 单个事件等待的超时包装(超时即取消流并报错,不留悬挂等待)
		async function withEventTimeout<T>(p: Promise<T>): Promise<T> {
			// 超时后底层 read() 会因 abort 迟到拒绝,提前吞掉防 unhandled rejection
			p.catch(() => {});
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await Promise.race([
					p,
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() =>
								reject(
									new AuditedBridgeError(
										`审计桥等待 SSE 事件超时(${wait}ms)`,
										'protocol',
										sessionId
									)
								),
							wait
						);
					})
				]);
			} finally {
				if (timer !== undefined) clearTimeout(timer);
			}
		}

		for (;;) {
			const event = await nextEvent();
			if (event === null) {
				throw new AuditedBridgeError(
					'SSE 流在 Stable 前关闭(审计回路未完成)',
					'protocol',
					sessionId
				);
			}
			const type = typeof event.type === 'string' ? event.type : '';
			if (type === 'IoRequest') {
				const requestId = event.id;
				if (typeof requestId !== 'number') {
					throw new AuditedBridgeError('IoRequest 事件缺少 id', 'protocol', sessionId);
				}
				// 本地执行;失败也要把错误写进 io_response 再抛(不留悬空 IoRequest)
				try {
					const reply = await callChatApi(chatParams);
					llmReply = reply;
					await postIoResponse(requestId, { content: reply }, null);
				} catch (e) {
					const msg = (e as Error).message;
					await postIoResponse(requestId, { error: msg }, msg).catch(() => {
						// 回写失败不掩盖原始 LLM 错误,但需如实留痕
						console.error('[audited-llm] io_response 回写失败(LLM 错误原样上抛)');
					});
					throw e;
				}
			} else if (type === 'Stable') {
				if (llmReply === null) {
					throw new AuditedBridgeError(
						'Stable 到达但未执行 LLM(审计回路异常)',
						'protocol',
						sessionId
					);
				}
				return llmReply;
			} else if (type === 'Error') {
				const msg =
					typeof event.message === 'string' ? event.message : 'evorule 引擎报 Error 事件';
				throw new AuditedBridgeError(`evorule 引擎错误: ${msg}`, 'engine', sessionId);
			}
			// StateTransition 等其他事件忽略
		}
	} finally {
		// 收尾:关闭 SSE 流 + 尽力关闭 sidecar 会话(防会话数耗尽;失败不掩盖主流程)
		streamCtl.abort();
		void closeSession(base, headers, sessionId);
	}

	async function postIoResponse(
		requestId: number,
		result: Record<string, unknown>,
		error: string | null
	): Promise<void> {
		const r = await fetchWithTimeout(
			`${base}/api/sessions/${sessionId}/io_response`,
			{
				method: 'POST',
				headers,
				body: JSON.stringify({ request_id: requestId, result, error })
			},
			wait,
			'submit_io_response'
		);
		await assertOk(r, 'submit_io_response', sessionId);
	}
}

/** 尽力关闭 sidecar 会话(fire-and-forget,任何失败静默忽略) */
async function closeSession(
	base: string,
	headers: Record<string, string>,
	sessionId: string
): Promise<void> {
	if (!sessionId) return;
	try {
		await fetch(`${base}/api/sessions/${sessionId}`, {
			method: 'DELETE',
			headers,
			signal: AbortSignal.timeout(5_000),
			// keepalive:页面卸载(刷新/关闭)时请求由浏览器接管发完,避免
			// in-flight DELETE 被强制中止产生 net::ERR_ABORTED 控制台噪声;
			// DELETE 无 body,不受 keepalive 64KB 请求体上限约束。
			keepalive: true
		});
	} catch {
		// 尽力而为:会话残留由 server 会话上限兜底
	}
}

// ============================================================================
// server 执行通道(UV-172 P2):LLM 执行整体委托 ai-plugin 服务端点
// ============================================================================

/**
 * server 通道整体超时(毫秒)。契约 v1.2 服务 timeout_ms 钳制上限 120s
 * (ai-plugin 声明即此值):单次 invoke 内含插件自编排审计回路(LLM 可达
 * 60s+),客户端须 ≥ 服务端上限,否则服务端仍在执行而客户端已放弃。
 */
export const SERVER_CHANNEL_TIMEOUT_MS = 120_000;

/**
 * 经 server 执行通道执行一次 LLM 对话(审计链内,服务端托管凭据)。
 *
 * 与 callChatApiAudited 的区别:LLM 不在浏览器执行 —— 调用 ai-plugin 服务
 * 端点(POST /api/services/ai_plugin_chat/invoke),插件进程自编排完整
 * sidecar 审计回路(call_external → LLM → io_response → Stable),prompt
 * 与结果全文入审计链。浏览器只拿 reply 与 session_id(供审计对账)。
 *
 * @param params 与 callChatApiAudited 相同的聊天参数;apiEndpoint/apiKey
 *        在此通道不使用(凭据在 ai-plugin 配置),model 可选覆盖插件缺省
 * @returns assistant 回复文本
 * @throws AuditedBridgeError(server 不可达 / 协议失败)
 */
export async function callChatApiServerChannel(
	params: ChatApiParams & { auditPurpose: AuditPurpose }
): Promise<string> {
	const { auditPurpose, apiEndpoint: _ep, apiKey: _key, ...chatParams } = params;
	void _ep;
	void _key;
	const base = resolveBaseUrl();
	const headers = buildHeaders();

	const body = {
		messages: buildMessages({
			userMessage: chatParams.userMessage,
			systemMessage: chatParams.systemMessage,
			history: chatParams.history
		}),
		// model 空串 = 不覆盖,用 ai-plugin 配置的缺省模型
		...(chatParams.model?.trim() ? { model: chatParams.model.trim() } : {}),
		temperature: chatParams.temperature ?? 0.2,
		audit_purpose: auditPurpose
	};

	let r: Response;
	try {
		r = await fetch(`${base}/api/services/ai_plugin_chat/invoke`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(SERVER_CHANNEL_TIMEOUT_MS)
		});
	} catch {
		// 网络错误/超时(含 AbortSignal.timeout 触发的 TimeoutError DOMException)
		throw new AuditedBridgeError(
			`无法连接 evorule-server(server 通道 invoke),请确认服务已启动:${base}`,
			'server_unreachable'
		);
	}

	if (!r.ok) {
		let detail = '';
		try {
			detail = (await r.text()).slice(0, 200);
		} catch {
			// 响应体不可读时留空
		}
		throw new AuditedBridgeError(
			`server 通道 invoke 失败(HTTP ${r.status})${detail ? `: ${detail}` : ''}`,
			'protocol'
		);
	}

	let json: unknown = null;
	try {
		json = await r.json();
	} catch {
		json = null;
	}
	// HttpHandler 机制层语义可能把服务返回体再包一层 JSON 字符串(e2e 同款双层解析)
	if (typeof json === 'string') {
		try {
			json = JSON.parse(json);
		} catch {
			// 解不开就按结构异常如实报错
			json = null;
		}
	}
	const payload = json as { reply?: unknown } | null;
	if (!payload || typeof payload.reply !== 'string') {
		throw new AuditedBridgeError(
			'server 通道响应结构异常: 无 reply 字段(协议失败,无静默兜底)',
			'protocol'
		);
	}
	return payload.reply;
}
