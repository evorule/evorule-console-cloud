// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — evo-agent 会话协议类型(对齐 evo-agent API.md §6 全表)
//
// 帧格式对齐 evo-agent API.md §6 全表:
//   - Server → Client 事件:type 为 PascalCase
//     (SessionCreated / LlmDelta / ToolCall / ToolResult / ApprovalRequired /
//      ApprovalResult / Done / Error / Info)
//   - Client → Server 帧:type 为 snake_case(message / interrupt / rewind)
//
// parseAgentEvent() 为解析守卫:非法/未知帧返回 null(调用方静默忽略),
// 必填字段缺失视为坏帧——把协议合法性收敛在一处,UI 层不散落判空。

export type { AgentSummary } from '../config/agent-config';

// ==== Server → Client ====

/** 会话建立(首轮连接后必达;session_id 为 evorule 会话 ID,续接/审批/取消均以此为准) */
export interface SessionCreatedEvent {
	type: 'SessionCreated';
	session_id: string;
}

/** LLM 增量输出(流式对话渲染源) */
export interface LlmDeltaEvent {
	type: 'LlmDelta';
	text: string;
}

/** 工具调用开始 */
export interface ToolCallEvent {
	type: 'ToolCall';
	name: string;
	args: unknown;
}

/** 工具调用结果 */
export interface ToolResultEvent {
	type: 'ToolResult';
	name: string;
	result: unknown;
}

/** 审批请求(candidate 工具触发;60s 未响应服务端自动拒绝,UI 须显式倒计时) */
export interface ApprovalRequiredEvent {
	type: 'ApprovalRequired';
	tool_name: string;
	command?: string;
	risk?: string;
	alternative?: string;
}

/** 审批结果回执(REST /approve 送达后服务端回推) */
export interface ApprovalResultEvent {
	type: 'ApprovalResult';
	tool_name: string;
	approved: boolean;
}

/** 一轮完成(汇总:最终内容 + 步数 + 耗时) */
export interface DoneEvent {
	type: 'Done';
	success: boolean;
	content: string;
	steps: number;
	duration_ms: number;
}

/** 错误(含服务端语义报错,如「a turn is already active」→ UI 层转译提示) */
export interface ErrorEvent {
	type: 'Error';
	error: string;
}

/** 提示信息(如 interrupt sent) */
export interface InfoEvent {
	type: 'Info';
	message: string;
}

export type AgentServerEvent =
	| SessionCreatedEvent
	| LlmDeltaEvent
	| ToolCallEvent
	| ToolResultEvent
	| ApprovalRequiredEvent
	| ApprovalResultEvent
	| DoneEvent
	| ErrorEvent
	| InfoEvent;

// ==== Client → Server ====

/** 发送消息(开启/续接一轮) */
export interface MessageFrame {
	type: 'message';
	content: string;
}

/** 中断当前轮次 */
export interface InterruptFrame {
	type: 'interrupt';
}

/** 回滚到指定版本(须无活跃轮次,否则服务端报错) */
export interface RewindFrame {
	type: 'rewind';
	version: number;
}

export type AgentClientFrame = MessageFrame | InterruptFrame | RewindFrame;

// ==== 解析守卫 ====

function isStr(v: unknown): v is string {
	return typeof v === 'string';
}

function isNum(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 解析一条 Server → Client JSON 帧;非法/未知帧返回 null(调用方静默忽略)。
 * 帧内多余字段忽略(向前兼容);必填字段缺失或类型不符视为坏帧。
 */
export function parseAgentEvent(raw: string): AgentServerEvent | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== 'object' || data === null) return null;
	const f = data as Record<string, unknown>;
	switch (f.type) {
		case 'SessionCreated':
			return isStr(f.session_id) ? { type: 'SessionCreated', session_id: f.session_id } : null;
		case 'LlmDelta':
			return isStr(f.text) ? { type: 'LlmDelta', text: f.text } : null;
		case 'ToolCall':
			return isStr(f.name) ? { type: 'ToolCall', name: f.name, args: f.args } : null;
		case 'ToolResult':
			return isStr(f.name) ? { type: 'ToolResult', name: f.name, result: f.result } : null;
		case 'ApprovalRequired':
			return isStr(f.tool_name)
				? {
						type: 'ApprovalRequired',
						tool_name: f.tool_name,
						command: isStr(f.command) ? f.command : undefined,
						risk: isStr(f.risk) ? f.risk : undefined,
						alternative: isStr(f.alternative) ? f.alternative : undefined
					}
				: null;
		case 'ApprovalResult':
			return isStr(f.tool_name) && typeof f.approved === 'boolean'
				? { type: 'ApprovalResult', tool_name: f.tool_name, approved: f.approved }
				: null;
		case 'Done':
			return typeof f.success === 'boolean' && isStr(f.content) && isNum(f.steps) && isNum(f.duration_ms)
				? {
						type: 'Done',
						success: f.success,
						content: f.content,
						steps: f.steps,
						duration_ms: f.duration_ms
					}
				: null;
		case 'Error':
			return isStr(f.error) ? { type: 'Error', error: f.error } : null;
		case 'Info':
			return isStr(f.message) ? { type: 'Info', message: f.message } : null;
		default:
			return null;
	}
}
