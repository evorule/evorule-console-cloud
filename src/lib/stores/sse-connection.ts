// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// SSE 连接管理 store(订阅 + 重连 + 降级轮询 + U7 session_switched)。
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §4.3 + §5.4 + §3.4(重连策略)+ §7.3(U7 切换)
//
// 生命周期:
//   startSSE(sessionId, baseUrl, switchHandler)
//     → connecting → connected(open 事件)
//     → onerror → reconnecting(指数退避 2s/4s/8s,最多 3 次)
//     → 3 次失败 → degraded(5s 轮询 GET /state 降级)
//     → 轮询恢复 → 重连 SSE
//   stopSSE() → disconnected
//
// U7 session_switched:
//   旧 SSE 推送 session_switched → 清空 Fact/异常/audit → 通知上层 → 订阅新 session SSE

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import type { SessionSwitchedEvent } from "./sse-events";
import { appendFact, clearFacts } from "./fact-stream";
import { appendAnomaly, clearAnomalies } from "./anomaly";
import { resetAuditStore } from "@evorule/console";

/** SSE 连接状态 */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "disconnected";

/** SSE 连接状态数据 */
export interface ConnectionState {
  status: ConnectionStatus;
  retryCount: number;
  lastConnectedAt: string | null;
  lastError: string | null;
}

const DEFAULT_CONNECTION_STATE: ConnectionState = {
  status: "disconnected",
  retryCount: 0,
  lastConnectedAt: null,
  lastError: null,
};

export const sseConnectionStore = writable<ConnectionState>(
  DEFAULT_CONNECTION_STATE,
);

// 模块级状态(非响应式,管理 EventSource 生命周期)
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let onSessionSwitched: ((e: SessionSwitchedEvent) => void) | null = null;
// 当前 baseUrl(供 handleSessionSwitched 重连新 session 用,修复设计 §5.4 getBaseUrl() 未定义)
let currentBaseUrl: string = "";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000]; // 指数退避

/**
 * 开始 SSE 订阅。
 *
 * @param sessionId 要订阅的 session ID
 * @param baseUrl evorule-server 基址
 * @param switchHandler U7 session_switched 回调(通知上层更新 productionStateStore)
 */
export function startSSE(
  sessionId: number,
  baseUrl: string,
  switchHandler?: (e: SessionSwitchedEvent) => void,
): void {
  if (!browser) return;
  onSessionSwitched = switchHandler ?? null;
  currentBaseUrl = baseUrl;

  stopSSE();
  connectSSE(sessionId, baseUrl);
}

/** 连接 SSE(创建 EventSource,绑定事件监听) */
function connectSSE(sessionId: number, baseUrl: string): void {
  sseConnectionStore.update((s) => ({ ...s, status: "connecting" }));

  const url = `${baseUrl}/api/sessions/${sessionId}/events`;
  eventSource = new EventSource(url);

  eventSource.addEventListener("open", () => {
    sseConnectionStore.update((s) => ({
      ...s,
      status: "connected",
      retryCount: 0,
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
    }));
  });

  eventSource.addEventListener("fact", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      appendFact(data);
    } catch {
      // 忽略解析失败的单条 Fact
    }
  });

  eventSource.addEventListener("anomaly", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      appendAnomaly(data);
    } catch {
      // 忽略解析失败的单条告警
    }
  });

  eventSource.addEventListener("session_switched", (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data) as SessionSwitchedEvent;
      handleSessionSwitched(event);
    } catch {
      // 忽略解析失败
    }
  });

  eventSource.addEventListener("heartbeat", () => {
    // 心跳保活,无需处理
  });

  eventSource.onerror = () => {
    handleSSEError(sessionId, baseUrl);
  };
}

/** SSE 断连处理(指数退避重连 / 降级轮询) */
function handleSSEError(sessionId: number, baseUrl: string): void {
  eventSource?.close();
  eventSource = null;

  const state = get(sseConnectionStore);
  const retryCount = state.retryCount + 1;

  if (retryCount <= MAX_RETRIES) {
    // 指数退避重连
    sseConnectionStore.update((s) => ({
      ...s,
      status: "reconnecting",
      retryCount,
      lastError: `SSE 断连,第 ${retryCount} 次重连...`,
    }));

    const delay = RETRY_DELAYS[retryCount - 1] ?? 8000;
    reconnectTimer = setTimeout(() => connectSSE(sessionId, baseUrl), delay);
  } else {
    // 3 次失败,降级为 5s 轮询
    sseConnectionStore.update((s) => ({
      ...s,
      status: "degraded",
      lastError: "SSE 3 次重连失败,降级为轮询模式",
    }));
    startDegradedPolling(sessionId, baseUrl);
  }
}

/** 降级轮询(5s 间隔调 GET /state,恢复后重连 SSE) */
function startDegradedPolling(sessionId: number, baseUrl: string): void {
  pollTimer = setInterval(async () => {
    try {
      const resp = await fetch(`${baseUrl}/api/sessions/${sessionId}/state`);
      if (resp.ok) {
        // 轮询恢复,尝试重连 SSE
        stopDegradedPolling();
        // 重置 retryCount,给 SSE 一个新的机会
        sseConnectionStore.update((s) => ({ ...s, retryCount: 0 }));
        connectSSE(sessionId, baseUrl);
      }
    } catch {
      // 轮询也失败,保持降级状态
    }
  }, 5000);
}

/** 停止降级轮询 */
function stopDegradedPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * U7:处理 session_switched 事件(滚动 session 热重载)。
 *
 * 流程(设计 §7.3):
 * 1. 清空旧 session 的 Fact 流和异常
 * 2. 清空内核 audit store
 * 3. 关闭旧 SSE 连接
 * 4. 通知上层(更新 productionStateStore + 显示 SessionSwitchToast)
 * 5. 订阅新 session 的 SSE
 */
function handleSessionSwitched(event: SessionSwitchedEvent): void {
  // 1. 清空旧 session 数据
  clearFacts();
  clearAnomalies();
  resetAuditStore();

  // 2. 关闭旧 SSE
  eventSource?.close();
  eventSource = null;

  // 3. 通知上层(更新 productionStateStore)
  onSessionSwitched?.(event);

  // 4. 订阅新 session 的 SSE(用 currentBaseUrl,修复设计 getBaseUrl() 未定义)
  const { new_session_id } = event.data;
  // 重置重连计数(新 session,全新连接)
  sseConnectionStore.update((s) => ({ ...s, retryCount: 0 }));
  connectSSE(new_session_id, currentBaseUrl);
}

/** 停止 SSE 订阅 + 清理所有定时器 */
export function stopSSE(): void {
  eventSource?.close();
  eventSource = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopDegradedPolling();

  sseConnectionStore.set({ ...DEFAULT_CONNECTION_STATE });
}
