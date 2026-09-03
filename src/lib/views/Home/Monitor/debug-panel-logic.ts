// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 调试面板纯逻辑(DebugPanel 组件的纯函数化抽出层,UV-062 W2 接线3)。
//
// 职责:
//   - 六路调试通道定义(step / snapshot / phase / queue / pending_io / pending_io_count)
//   - session id 输入解析(非法输入显式报错,不静默)
//   - 各通道数据 → 展示文本格式化(空数据与错误分开,null ≠ 0)
//   - 通道 → backend 方法分发(供组件层并发独立拉取)
//
// 设计:
//   - 完全纯函数,无副作用(不读 store,不读 DOM),方便 vitest 单元测试
//   - 组件层(DebugPanel.svelte)只做薄包装:调用这里的函数 + 渲染 UI
//   - 六路独立:一路失败只落自己通道的错误态,不拖垮其他路
//
// 端点对齐:evorule-server /api/sessions/{id}/step|snapshot|debug/phase|
//   debug/queue|debug/pending_io|pending_io_count(见 kernel/backend/types.ts)

import type {
	SessionId,
	StepInfo,
	SessionSnapshot,
	DebugPhaseInfo,
	DebugQueueInfo,
	DebugPendingIoInfo,
	PendingIoCountInfo,
	ExecutionBackend,
} from "$lib/kernel";

/** 六路调试通道 key(与 server 调试端点一一对应) */
export type DebugChannelKey =
	| "step"
	| "snapshot"
	| "phase"
	| "queue"
	| "pending_io"
	| "pending_io_count";

/** 单路通道状态(各路独立;idle=未加载,ok=成功,error=本路失败) */
export interface DebugChannelState {
	status: "idle" | "loading" | "ok" | "error";
	data: unknown | null;
	error: string | null;
}

/** 通道 key → 展示标签 */
export const DEBUG_CHANNEL_LABELS: Readonly<
	Record<DebugChannelKey, string>
> = {
	step: "单步计数",
	snapshot: "状态快照",
	phase: "执行阶段",
	queue: "待执行队列",
	pending_io: "悬挂 I/O",
	pending_io_count: "悬挂 I/O 计数",
};

/** 通道展示顺序(高频信息在前) */
export const DEBUG_CHANNEL_ORDER: readonly DebugChannelKey[] = [
	"step",
	"phase",
	"snapshot",
	"queue",
	"pending_io",
	"pending_io_count",
];

/** 初始通道状态(全部 idle) */
export function createInitialChannels(): Record<
	DebugChannelKey,
	DebugChannelState
> {
	const idle: DebugChannelState = { status: "idle", data: null, error: null };
	return {
		step: { ...idle },
		snapshot: { ...idle },
		phase: { ...idle },
		queue: { ...idle },
		pending_io: { ...idle },
		pending_io_count: { ...idle },
	};
}

/**
 * 解析 session id 输入(纯数字字符串且为正整数才有效)。
 * 拒绝科学计数法("1e3")/十六进制/小数/负数/空串 → null,
 * 由调用方展示错误,不静默取默认值。
 */
export function parseSessionIdInput(raw: string): SessionId | null {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const n = Number(trimmed);
	if (n <= 0) return null;
	return n;
}

/**
 * snapshot 是否为失败态:server 在反应器已结束/锁中毒时返回
 * 200 + 仅含 { session_id, error }——HTTP 成功但语义失败,
 * 数据字段缺失 ≠ 隐式 0,须按失败态展示。
 */
export function isSnapshotFailed(s: SessionSnapshot): boolean {
	return typeof s.error === "string" && s.error.length > 0;
}

/** phase 展示文本(null = 反应器未启动,显式标注而非留白) */
export function formatPhase(phase: string | null): string {
	return phase ?? "未启动(反应器不存在)";
}

/** queue 展示文本(server 当前恒为空数组 → 明示"空"而非无内容) */
export function formatQueue(queue: unknown[]): string {
	if (queue.length === 0) return "(空队列)";
	return JSON.stringify(queue);
}

/** pending_io 列表展示文本(空列表 → 明示"无",与错误态区分) */
export function formatPendingIoList(pending: unknown[]): string {
	if (pending.length === 0) return "(无悬挂 I/O)";
	return JSON.stringify(pending);
}

/** snapshot 成功态摘要行(可选字段缺失显示 "—" 而非 0) */
export function formatSnapshotSummary(s: SessionSnapshot): string {
	const parts: string[] = [];
	parts.push(`phase=${s.phase ?? "—"}`);
	parts.push(`steps=${s.steps ?? "—"}`);
	parts.push(`pending_io=${s.pending_io_count ?? "—"}`);
	parts.push(`violations=${s.structural_invariant_violations ?? "—"}`);
	parts.push(`version=${s.version ?? "—"}`);
	parts.push(`finished=${s.finished ?? "—"}`);
	return parts.join("  ");
}

/**
 * 数据内嵌失败态(HTTP 200 但响应自带 error 字段)。
 * 当前仅 snapshot 有此形态;返回错误文本供面板按错误样式渲染,无则 null。
 */
export function channelSemanticError(
	key: DebugChannelKey,
	data: unknown,
): string | null {
	if (key === "snapshot" && data !== null) {
		const s = data as SessionSnapshot;
		return isSnapshotFailed(s) ? (s.error as string) : null;
	}
	return null;
}

/** ok 态数据 → 展示文本(组件只在 status=ok 时调用) */
export function formatChannelValue(key: DebugChannelKey, data: unknown): string {
	switch (key) {
		case "step":
			return `current_step = ${(data as StepInfo).current_step}`;
		case "snapshot": {
			const s = data as SessionSnapshot;
			// 防御:若被误传失败态 snapshot,展示失败原因而非编造数值
			return isSnapshotFailed(s)
				? `快照失败: ${s.error}`
				: formatSnapshotSummary(s);
		}
		case "phase":
			return formatPhase((data as DebugPhaseInfo).phase);
		case "queue":
			return formatQueue((data as DebugQueueInfo).queue);
		case "pending_io": {
			const p = data as DebugPendingIoInfo;
			return `计数 ${p.pending_io_count}  ${formatPendingIoList(p.pending_io)}`;
		}
		case "pending_io_count":
			return `pending_io_count = ${(data as PendingIoCountInfo).pending_io_count}`;
	}
}

/** 通道 → backend 方法分发(组件层对六路并发独立调用,各自 try/catch) */
export function fetchDebugChannel(
	backend: ExecutionBackend,
	sessionId: SessionId,
	key: DebugChannelKey,
): Promise<unknown> {
	switch (key) {
		case "step":
			return backend.getStep(sessionId);
		case "snapshot":
			return backend.getSessionSnapshot(sessionId);
		case "phase":
			return backend.getDebugPhase(sessionId);
		case "queue":
			return backend.getDebugQueue(sessionId);
		case "pending_io":
			return backend.getDebugPendingIo(sessionId);
		case "pending_io_count":
			return backend.getPendingIoCount(sessionId);
	}
}
