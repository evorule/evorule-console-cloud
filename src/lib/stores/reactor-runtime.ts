// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Reactor 运行态 store(2s 轮询)。
// 轮询 GET /state + /invariants + /finished,聚合为 ReactorRuntimeState。
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §4.2 + §5.5 + §3.1(决策 1)
//
// 设计:evorule-server SSE 只推 Fact/anomaly/session_switched,不推 ReactorState 变化,
//   故 ReactorState 用 2s 轮询(轻量,无压力)。

import { writable } from "svelte/store";
import { browser } from "$app/environment";

/** Reactor 6 phase(对齐内核 ReactorState.phase) */
export type ReactorPhase =
  | "idle"
  | "draining"
  | "executing"
  | "awaiting_io"
  | "stable"
  | "error";

/** Reactor 运行态(2s 轮询聚合) */
export interface ReactorRuntimeState {
  /** 当前 phase */
  phase: ReactorPhase;
  /** 因果深度 */
  causalDepth: number;
  /** 当前 step */
  currentStep: number;
  /** 等待中的 IO 数 */
  pendingIoCount: number;
  /** reactor 版本号 */
  reactorVersion: number;
  /** 结构不变量违规数(>0 表示异常) */
  invariantViolations: number;
  /** session 是否已结束 */
  finished: boolean;
}

export const reactorRuntimeStore = writable<ReactorRuntimeState | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 开始 2s 轮询 Reactor 运行态。
 * 立即执行一次,然后每 2s 轮询。
 * 轮询失败时保持上次状态(不报错,避免刷屏)。
 */
export function startReactorPolling(
  sessionId: number,
  baseUrl: string,
): void {
  if (!browser) return;
  stopReactorPolling();

  const poll = async (): Promise<void> => {
    try {
      const [stateResp, invResp, finResp] = await Promise.all([
        fetch(`${baseUrl}/api/sessions/${sessionId}/state`).then((r) => r.json()),
        fetch(`${baseUrl}/api/sessions/${sessionId}/invariants`).then((r) => r.json()),
        fetch(`${baseUrl}/api/sessions/${sessionId}/finished`).then((r) => r.json()),
      ]);

      const reactor = stateResp?.reactor ?? {};

      reactorRuntimeStore.set({
        phase: (reactor.phase as ReactorPhase) ?? "idle",
        causalDepth: typeof reactor.causal_depth === "number" ? reactor.causal_depth : 0,
        currentStep: typeof reactor.current_step === "number" ? reactor.current_step : 0,
        pendingIoCount:
          typeof reactor.pending_io_count === "number" ? reactor.pending_io_count : 0,
        reactorVersion: typeof reactor.version === "number" ? reactor.version : 0,
        invariantViolations:
          typeof invResp?.violations === "number" ? invResp.violations : 0,
        finished: typeof finResp?.finished === "boolean" ? finResp.finished : false,
      });
    } catch {
      // 轮询失败,保持上次状态(不报错,避免刷屏)
    }
  };

  void poll(); // 立即执行一次
  pollTimer = setInterval(() => void poll(), 2000);
}

/** 停止轮询 */
export function stopReactorPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
