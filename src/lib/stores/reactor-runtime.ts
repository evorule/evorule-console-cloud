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
// UV-079 ②: 404 显式识别——会话不存在时停止轮询并置 sessionMissing 态,
//   由 UI 报警提示;禁止与瞬时网络错误混同后静默保持旧状态(静默通过形态)。

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
  /** 会话不存在(404): 轮询目标已失效(幻影引用/已回收),轮询已停止(UV-079 ②) */
  sessionMissing: boolean;
}

export const reactorRuntimeStore = writable<ReactorRuntimeState | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 开始 2s 轮询 Reactor 运行态。
 * 立即执行一次,然后每 2s 轮询。
 * 轮询失败时保持上次状态(不报错,避免刷屏);404 例外——停止轮询并置
 * sessionMissing 态(会话已失效属持续性错误,静默重试只会无限刷 404)。
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
        fetch(`${baseUrl}/api/sessions/${sessionId}/state`),
        fetch(`${baseUrl}/api/sessions/${sessionId}/invariants`),
        fetch(`${baseUrl}/api/sessions/${sessionId}/finished`),
      ]);

      // UV-079 ②: 404 = 轮询目标已失效(幻影引用/已被回收)。
      // 旧实现直接 r.json():404 空 body 解析抛错落入 catch,与瞬时网络
      // 错误混同后静默保持旧状态——幻影会话轮询完全无感知。
      // 现显式识别:停止轮询 + 置 missing 态,由 ReactorStateBar 报警提示。
      if (
        stateResp.status === 404 ||
        invResp.status === 404 ||
        finResp.status === 404
      ) {
        stopReactorPolling();
        reactorRuntimeStore.set({
          phase: "idle",
          causalDepth: 0,
          currentStep: 0,
          pendingIoCount: 0,
          reactorVersion: 0,
          invariantViolations: 0,
          finished: false,
          sessionMissing: true,
        });
        return;
      }

      const [stateRespJson, invRespJson, finRespJson] = await Promise.all([
        stateResp.json(),
        invResp.json(),
        finResp.json(),
      ]);

      const reactor = stateRespJson?.reactor ?? {};

      reactorRuntimeStore.set({
        phase: (reactor.phase as ReactorPhase) ?? "idle",
        causalDepth: typeof reactor.causal_depth === "number" ? reactor.causal_depth : 0,
        currentStep: typeof reactor.current_step === "number" ? reactor.current_step : 0,
        pendingIoCount:
          typeof reactor.pending_io_count === "number" ? reactor.pending_io_count : 0,
        reactorVersion: typeof reactor.version === "number" ? reactor.version : 0,
        invariantViolations:
          typeof invRespJson?.violations === "number" ? invRespJson.violations : 0,
        finished: typeof finRespJson?.finished === "boolean" ? finRespJson.finished : false,
        sessionMissing: false,
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
