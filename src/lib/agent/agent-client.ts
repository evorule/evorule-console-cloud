// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — evo-agent AgentClient(WS 双向为主 + REST 兜底)
//
// WS 双向为主(/api/sessions/{id}/ws?agent_type=&token=),REST 兜底
// (listAgents / approve / cancel)。
//
// 状态机:
//   connect() → connecting → connected
//     断线(非用户关闭)→ reconnecting(指数退避 1s/2s/4s/8s/16s,封顶 30s)
//       → 重连成功 → connected(同一 sessionId 续接,上下文留在 evo-agent 侧)
//       → 超过 maxAttempts → disconnected(显式断线态;可再次 connect 续接)
//   首次连接失败/超时 → disconnected(不自动重连,UI 呈现不可达空态,场景④)
//   close() → disconnected(用户主动;会话保留在服务端,可再 connect 续接)
//
// 纪律:token 仅进 WS URL query(evo-agent 协议既定)与 REST Bearer 头;
//      不进日志/错误消息。发送帧前置条件 = WS 已 open,否则抛 not-connected。

import { parseAgentEvent } from './types';
import type { AgentClientFrame, AgentServerEvent, AgentSummary } from './types';

/** 链路状态(idle=尚未连接;disconnected=终止态,可重新 connect) */
export type AgentLinkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** 状态变化附加信息 */
export interface AgentStatusDetail {
	sessionId?: string;
	/** reconnecting 时的第几次重试(1 起) */
	attempt?: number;
	/** 终态原因:connect-timeout / connect-failed / reconnect-exhausted */
	error?: string;
}

/** 最小 WebSocket 接口(与浏览器 WebSocket 行为同构,测试可注入桩) */
export interface AgentWebSocketLike {
	readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: (() => void) | null;
	onclose: ((ev: { code?: number; reason?: string }) => void) | null;
	onerror: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface AgentReconnectPolicy {
	/** 自动重连最大尝试次数(超过进入 disconnected) */
	maxAttempts: number;
	/** 首次重试延迟(此后翻倍) */
	baseDelayMs: number;
	/** 重试延迟封顶 */
	maxDelayMs: number;
}

export interface AgentClientOptions {
	baseUrl: string;
	agentType: string;
	/** 鉴权 Token(serve 未开鉴权可空;不进日志/错误) */
	authToken?: string;
	/** 已有会话 ID(续接);缺省 'new' 由服务端新建 */
	sessionId?: string;
	onEvent: (e: AgentServerEvent) => void;
	onStatus: (status: AgentLinkStatus, detail?: AgentStatusDetail) => void;
	/** 建连超时(含 WS 握手),超时判本次失败;缺省 10s */
	connectTimeoutMs?: number;
	reconnect?: Partial<AgentReconnectPolicy>;
	/** 测试注入用 WS 工厂;缺省 new WebSocket(url) */
	wsFactory?: (url: string) => AgentWebSocketLike;
	/** 测试注入用 fetch;缺省全局 fetch */
	fetchImpl?: typeof fetch;
}

const WS_OPEN = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT: AgentReconnectPolicy = {
	maxAttempts: 5,
	baseDelayMs: 1_000,
	maxDelayMs: 30_000
};

export class AgentClient {
	private readonly baseUrl: string;
	private readonly agentType: string;
	private readonly authToken: string;
	private readonly onEvent: (e: AgentServerEvent) => void;
	private readonly onStatus: (status: AgentLinkStatus, detail?: AgentStatusDetail) => void;
	private readonly connectTimeoutMs: number;
	private readonly reconnectPolicy: AgentReconnectPolicy;
	private readonly wsFactory: (url: string) => AgentWebSocketLike;
	private readonly fetchImpl: typeof fetch;

	private ws: AgentWebSocketLike | null = null;
	private status: AgentLinkStatus = 'idle';
	private _sessionId: string;
	private userClosed = false;
	private phase: 'initial' | 'retry' = 'initial';
	private attempt = 0;
	private timeoutFired = false;
	private connectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private settle: { resolve: () => void; reject: (e: Error) => void } | null = null;

	constructor(options: AgentClientOptions) {
		this.baseUrl = options.baseUrl;
		this.agentType = options.agentType;
		this.authToken = options.authToken ?? '';
		this._sessionId = options.sessionId ?? 'new';
		this.onEvent = options.onEvent;
		this.onStatus = options.onStatus;
		this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		this.reconnectPolicy = { ...DEFAULT_RECONNECT, ...options.reconnect };
		this.wsFactory =
			options.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as AgentWebSocketLike);
		this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
	}

	/** 当前会话 ID('new' 表示尚未从服务端拿到真实 ID) */
	get sessionId(): string {
		return this._sessionId;
	}

	/** 当前链路状态 */
	get linkStatus(): AgentLinkStatus {
		return this.status;
	}

	/**
	 * 建立连接(首轮)。已在连接中/已连接/重连中时拒绝(connect-already-active)。
	 * 首次连接失败不自动重连(显式不可达态);resolve = 已连上。
	 */
	connect(): Promise<void> {
		if (
			this.status === 'connecting' ||
			this.status === 'connected' ||
			this.status === 'reconnecting'
		) {
			return Promise.reject(new Error('connect-already-active'));
		}
		this.userClosed = false;
		this.phase = 'initial';
		this.attempt = 0;
		this.setStatus('connecting');
		return this.openAttempt();
	}

	/** 用户主动关闭(不触发重连;会话保留在服务端,可再 connect 续接) */
	close(): void {
		if (this.status === 'idle') return;
		this.userClosed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.clearConnectTimer();
		const ws = this.ws;
		this.ws = null;
		if (ws) this.detach(ws);
		if (this.settle) {
			this.settle.reject(new Error('connect-cancelled'));
			this.settle = null;
		}
		this.setStatus('disconnected');
	}

	/** 发送消息(开启/续接一轮;未连接抛 not-connected) */
	send(content: string): void {
		this.sendFrame({ type: 'message', content });
	}

	/** 中断当前轮次 */
	interrupt(): void {
		this.sendFrame({ type: 'interrupt' });
	}

	/** 回滚到指定版本(须无活跃轮次,否则服务端报错 → UI 层转译提示) */
	rewind(version: number): void {
		this.sendFrame({ type: 'rewind', version });
	}

	/** REST 兜底:列出 agent 角色(GET /agents) */
	async listAgents(): Promise<AgentSummary[]> {
		const res = await this.fetchImpl(`${this.restBase()}/agents`, { headers: this.restHeaders() });
		if (!res.ok) throw new Error(`list-agents-http-${res.status}`);
		const data = (await res.json()) as { agents?: AgentSummary[] };
		if (!Array.isArray(data.agents)) throw new Error('list-agents-bad-payload');
		return data.agents;
	}

	/** REST 兜底:送达审批结果(POST /agents/{type}/approve) */
	async approve(approved: boolean): Promise<void> {
		if (this._sessionId === 'new') throw new Error('no-session');
		const res = await this.fetchImpl(
			`${this.restBase()}/agents/${encodeURIComponent(this.agentType)}/approve`,
			{
				method: 'POST',
				headers: { ...this.restHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ session_id: this._sessionId, approved })
			}
		);
		if (!res.ok) throw new Error(`approve-http-${res.status}`);
	}

	/** REST 兜底:取消运行中会话(POST /agents/{type}/cancel?session_id=) */
	async cancel(): Promise<void> {
		if (this._sessionId === 'new') throw new Error('no-session');
		const res = await this.fetchImpl(
			`${this.restBase()}/agents/${encodeURIComponent(this.agentType)}/cancel?session_id=${encodeURIComponent(this._sessionId)}`,
			{ method: 'POST', headers: this.restHeaders() }
		);
		if (!res.ok) throw new Error(`cancel-http-${res.status}`);
	}

	// ==== 内部 ====

	private restBase(): string {
		return this.baseUrl.trim().replace(/\/+$/, '');
	}

	private restHeaders(): Record<string, string> {
		const h: Record<string, string> = { Accept: 'application/json' };
		if (this.authToken) h.Authorization = `Bearer ${this.authToken}`;
		return h;
	}

	private buildUrl(): string {
		// http(s) → ws(s);token 走 URL query 为 evo-agent 协议既定形态
		const wsBase = this.restBase().replace(/^http/i, 'ws');
		const params = new URLSearchParams({ agent_type: this.agentType });
		if (this.authToken) params.set('token', this.authToken);
		return `${wsBase}/api/sessions/${encodeURIComponent(this._sessionId)}/ws?${params.toString()}`;
	}

	private sendFrame(frame: AgentClientFrame): void {
		const ws = this.ws;
		if (!ws || ws.readyState !== WS_OPEN) throw new Error('not-connected');
		ws.send(JSON.stringify(frame));
	}

	private setStatus(status: AgentLinkStatus, detail?: AgentStatusDetail): void {
		this.status = status;
		this.onStatus(status, detail);
	}

	private clearConnectTimer(): void {
		if (this.connectTimer) {
			clearTimeout(this.connectTimer);
			this.connectTimer = null;
		}
	}

	/** 摘除处理器后关闭(防 close 事件重复进入状态机) */
	private detach(ws: AgentWebSocketLike): void {
		ws.onopen = null;
		ws.onclose = null;
		ws.onmessage = null;
		ws.onerror = null;
		try {
			ws.close();
		} catch {
			// 连接可能已死,关闭失败忽略
		}
	}

	/** 发起一次建连尝试;resolve = 打开成功(reconnect 场景无外部等待方) */
	private openAttempt(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.timeoutFired = false;
			let opened = false;
			let ws: AgentWebSocketLike;
			try {
				ws = this.wsFactory(this.buildUrl());
			} catch {
				this.setStatus('disconnected', { error: 'connect-failed' });
				reject(new Error('connect-failed'));
				return;
			}
			this.ws = ws;
			this.settle = { resolve, reject };

			this.connectTimer = setTimeout(() => {
				this.connectTimer = null;
				if (this.ws !== ws || opened) return;
				this.timeoutFired = true;
				this.ws = null;
				this.detach(ws); // 先摘处理器再关,防 onclose 重复进入
				this.handleAttemptEnd(false);
			}, this.connectTimeoutMs);

			ws.onopen = () => {
				if (this.ws !== ws) return;
				opened = true;
				this.clearConnectTimer();
				this.attempt = 0;
				this.setStatus('connected', { sessionId: this._sessionId });
				this.settle?.resolve();
				this.settle = null;
			};

			ws.onmessage = (ev: { data: unknown }) => {
				if (this.ws !== ws || typeof ev.data !== 'string') return;
				const event = parseAgentEvent(ev.data);
				if (event === null) return;
				if (event.type === 'SessionCreated') this._sessionId = event.session_id;
				this.onEvent(event);
			};

			ws.onclose = () => {
				if (this.ws !== ws) return; // 已被超时路径/新一轮尝试接管
				this.handleAttemptEnd(opened);
			};

			ws.onerror = () => {
				// 浏览器 WS 错误后必有 close,统一在 close 处理
			};
		});
	}

	/** 一次尝试结束(未开即断 / 已开后断),推进状态机 */
	private handleAttemptEnd(opened: boolean): void {
		this.clearConnectTimer();
		this.ws = null;
		if (this.userClosed) {
			if (this.settle) {
				this.settle.reject(new Error('connect-cancelled'));
				this.settle = null;
			}
			this.setStatus('disconnected');
			return;
		}
		if (!opened) {
			if (this.phase === 'initial') {
				const reason = this.timeoutFired ? 'connect-timeout' : 'connect-failed';
				this.setStatus('disconnected', { error: reason });
				this.settle?.reject(new Error(reason));
				this.settle = null;
				return;
			}
			// 重连尝试失败:退避后下一次,直至耗尽
			if (this.settle) this.settle = null;
			if (this.attempt >= this.reconnectPolicy.maxAttempts) {
				this.setStatus('disconnected', { error: 'reconnect-exhausted' });
				return;
			}
			this.attempt += 1;
			this.scheduleReconnect();
			return;
		}
		// 已连上后断开 → 自动重连(同一 sessionId 续接)
		this.settle = null;
		this.attempt = 1;
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		this.phase = 'retry';
		const { baseDelayMs, maxDelayMs } = this.reconnectPolicy;
		const delay = Math.min(baseDelayMs * 2 ** (this.attempt - 1), maxDelayMs);
		this.setStatus('reconnecting', { attempt: this.attempt });
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.openAttempt().catch(() => {
				// 失败路径已在 handleAttemptEnd 收敛,此处仅兜底防未处理拒绝
			});
		}, delay);
	}
}
