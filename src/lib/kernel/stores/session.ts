// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 会话 store — 当前 session + session 列表 + 命令历史
//
// 依据: docs/IMPLEMENTATION_PLAN.md 阶段3 + 实施文档_界面升级_v1.0.md §C.2.4
// 设计:
//   - store 本身不持有 backend 实例(backend 由组件注入,便于测试 mock)
//   - store 函数签名带 backend 参数,组件调 useBackend() 后传给 store
//   - 命令历史存最近 N 条,用于"确定性"可视化(同输入同输出对比)
//
// 阶段 C.2.4 改造:
//   - 新增 createWorkspaceSession(execBackend, wsBackend, workspaceId, ...)
//     先在 server 创建 workspace 会话(含规则绑定),拿到 SessionRecord.id
//     该 id 即 evorule runtime session id(server 端联动创建),直接设为 currentSessionId
//   - 保留 createSession(backend) 简化路径(ExecutionPad 用,无 workspace 上下文)
//   - 新增 subscribeSessionSwitched SSE 留桩(发布后 server 推 session_switched 事件)

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { ExecutionBackend, SessionId, SessionState, CommandResult } from '$lib/kernel/backend/types';
import type { WorkspaceBackend, SessionRecord } from '$lib/kernel/backend/workspace-types';

/** 命令历史一条记录 */
export interface CommandHistoryEntry {
  /** 提交时间(用于排序和显示) */
  timestamp: number;
  /** 提交的 instruction(JSON 对象) */
  instruction: object;
  /** 提交结果 */
  result: CommandResult;
  /** 提交时的 session version(便于追溯) */
  versionBefore: number | undefined;
}

const MAX_HISTORY = 50;

// ============================================================================
// Stores
// ============================================================================

export const sessions = writable<SessionId[]>([]);
export const currentSessionId = writable<SessionId | null>(null);
export const sessionState = writable<SessionState | null>(null);
export const commandHistory = writable<CommandHistoryEntry[]>([]);
export const isLoading = writable(false);
export const lastError = writable<string | null>(null);

/** 当前 session 关联的 workspace 会话记录(可选,workspace 上下文) */
export const currentWorkspaceSession = writable<SessionRecord | null>(null);

/** 当前 session state 的派生视图(只读) */
export const reactorPhase = derived(sessionState, ($s) => $s?.reactor?.phase ?? null);
export const reactorVersion = derived(sessionState, ($s) => $s?.version ?? null);
export const reactorCausalDepth = derived(
  sessionState,
  ($s) => $s?.reactor?.causal_depth ?? null
);
export const reactorPendingIO = derived(
  sessionState,
  ($s) => $s?.reactor?.pending_io_count ?? null
);

// ============================================================================
// Actions
// ============================================================================

/**
 * 刷新 session 列表(从 execBackend 拉取)。
 * 保留原签名,ExecutionPad 用。
 */
export async function refreshSessions(backend: ExecutionBackend): Promise<void> {
  isLoading.set(true);
  lastError.set(null);
  try {
    const ids = await backend.listSessions();
    sessions.set(ids);
    // 若当前 session 不在列表中,自动选第一个
    const current = get(currentSessionId);
    if (current === null || !ids.includes(current)) {
      currentSessionId.set(ids.length > 0 ? ids[0] : null);
    }
  } catch (e) {
    lastError.set(`刷新 session 列表失败: ${(e as Error).message}`);
  } finally {
    isLoading.set(false);
  }
}

/**
 * 创建新 session (简化路径,仅 evorule runtime 会话,无 workspace 上下文)。
 * ExecutionPad 用。
 * @returns 新 session id,失败返回 null
 */
export async function createSession(backend: ExecutionBackend): Promise<SessionId | null> {
  isLoading.set(true);
  lastError.set(null);
  try {
    const id = await backend.createSession();
    sessions.update((all) => (all.includes(id) ? all : [...all, id]));
    currentSessionId.set(id);
    currentWorkspaceSession.set(null); // 简化路径无 workspace 上下文
    // 创建后立即拉取状态
    await refreshSessionState(backend, id);
    return id;
  } catch (e) {
    lastError.set(`创建 session 失败: ${(e as Error).message}`);
    return null;
  } finally {
    isLoading.set(false);
  }
}

/**
 * 创建 workspace 会话(阶段 C.2.4 新增)。
 *
 * 流程:
 *   1. 调 wsBackend.createWorkspaceSession(workspaceId, {rule_id, rule_version_id, ...})
 *      — server 端联动创建 evorule runtime session 并返回 SessionRecord(id 即 runtime id)
 *   2. 将 SessionRecord.id 设为 currentSessionId(无需再调 execBackend.createSession)
 *   3. 记录 currentWorkspaceSession(workspace 上下文,供 UI 显示规则绑定)
 *   4. 立即拉取 session 状态
 *
 * @returns 新 session id,失败返回 null
 */
export async function createWorkspaceSession(
  execBackend: ExecutionBackend,
  wsBackend: WorkspaceBackend,
  workspaceId: string,
  ruleId?: string,
  ruleVersionId?: string
): Promise<SessionId | null> {
  isLoading.set(true);
  lastError.set(null);
  try {
    const record = await wsBackend.createWorkspaceSession(workspaceId, {
      rule_id: ruleId,
      rule_version_id: ruleVersionId,
      created_by: 'console'
    });

    // SessionRecord.id 即 evorule runtime session id(server 端联动创建)
    const id = record.id;
    sessions.update((all) => (all.includes(id) ? all : [...all, id]));
    currentSessionId.set(id);
    currentWorkspaceSession.set(record);

    await refreshSessionState(execBackend, id);
    return id;
  } catch (e) {
    lastError.set(`创建 workspace session 失败: ${(e as Error).message}`);
    return null;
  } finally {
    isLoading.set(false);
  }
}

/**
 * 关闭当前 session (简化路径,仅关 evorule runtime)。
 */
export async function closeSession(backend: ExecutionBackend, id: SessionId): Promise<void> {
  isLoading.set(true);
  lastError.set(null);
  try {
    await backend.closeSession(id);
    sessions.update((all) => all.filter((s) => s !== id));
    if (get(currentSessionId) === id) {
      const remaining = get(sessions);
      currentSessionId.set(remaining.length > 0 ? remaining[0] : null);
      // 状态清空
      sessionState.set(null);
      commandHistory.set([]);
      currentWorkspaceSession.set(null);
    }
  } catch (e) {
    lastError.set(`关闭 session 失败: ${(e as Error).message}`);
  } finally {
    isLoading.set(false);
  }
}

/**
 * 切换到指定 session
 */
export async function selectSession(
  backend: ExecutionBackend,
  id: SessionId
): Promise<void> {
  currentSessionId.set(id);
  sessionState.set(null);
  commandHistory.set([]);
  currentWorkspaceSession.set(null);
  await refreshSessionState(backend, id);
}

/**
 * 刷新当前 session 的状态
 */
export async function refreshSessionState(
  backend: ExecutionBackend,
  id?: SessionId
): Promise<void> {
  const targetId = id ?? get(currentSessionId);
  if (targetId === null) return;
  lastError.set(null);
  try {
    const state = await backend.getSessionState(targetId);
    sessionState.set(state);
  } catch (e) {
    lastError.set(`获取 session 状态失败: ${(e as Error).message}`);
    sessionState.set(null);
  }
}

/**
 * 提交命令到当前 session
 *
 * @param backend       执行后端
 * @param instruction   要提交的 instruction(JSON 对象)
 * @returns 命令结果,失败返回 null
 */
export async function submitCommand(
  backend: ExecutionBackend,
  instruction: object
): Promise<CommandResult | null> {
  const id = get(currentSessionId);
  if (id === null) {
    lastError.set('没有当前 session,请先创建');
    return null;
  }

  isLoading.set(true);
  lastError.set(null);
  const versionBefore = get(reactorVersion) ?? undefined;

  try {
    const result = await backend.submitCommand(id, instruction);
    // 加入历史
    commandHistory.update((hist) => {
      const entry: CommandHistoryEntry = {
        timestamp: Date.now(),
        instruction,
        result,
        versionBefore
      };
      const next = [...hist, entry];
      // 限制历史长度
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
    // 提交后刷新状态
    await refreshSessionState(backend, id);
    return result;
  } catch (e) {
    lastError.set(`提交命令失败: ${(e as Error).message}`);
    return null;
  } finally {
    isLoading.set(false);
  }
}

// ============================================================================
// session_switched SSE 留桩 (阶段 C.2.4)
// ============================================================================
//
// 依据: 实施文档_界面升级_v1.0.md §C.2.4
//   发布队列 publish 后,server 应通过 SSE 推 session_switched 事件,
//   客户端监听并更新 currentSessionId(切换到新生产 session)。
//
// 阶段 C 状态:server 端 SSE 端点 (/api/sessions/events) 尚未实现,
//   此处留桩 — 端点不存在时 EventSource 报错被 catch 静默,
//   待 server 补端点后自动生效(无需改客户端)。

/** 当前活跃的 SSE 订阅(防止重复订阅) */
let sessionSwitchedSource: EventSource | null = null;

/**
 * 订阅 session_switched SSE 事件。
 *
 * @param onSwitched 收到事件时的回调(参数为新 session id)
 * @returns 取消订阅函数
 *
 * 注意:server 端 SSE 端点未实现前,此函数会静默失败(onerror 触发后自动关闭)。
 *       待 server 补端点后,无需改客户端即可生效。
 */
export function subscribeSessionSwitched(
  onSwitched: (newSessionId: SessionId) => void
): () => void {
  if (!browser) return () => {};

  // 防止重复订阅
  if (sessionSwitchedSource) {
    sessionSwitchedSource.close();
    sessionSwitchedSource = null;
  }

  try {
    const source = new EventSource('/api/sessions/events');
    sessionSwitchedSource = source;

    source.addEventListener('session_switched', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { session_id?: SessionId };
        if (typeof data.session_id === 'number') {
          onSwitched(data.session_id);
        }
      } catch {
        // 数据解析失败,忽略
      }
    });

    source.onerror = () => {
      // 端点不存在或断连 — 静默关闭,不抛错(留桩设计)
      source.close();
      sessionSwitchedSource = null;
    };
  } catch {
    // EventSource 构造失败(SSR 或非浏览器环境),忽略
  }

  return () => {
    if (sessionSwitchedSource) {
      sessionSwitchedSource.close();
      sessionSwitchedSource = null;
    }
  };
}

/**
 * 清空所有状态(组件卸载或切换 view 时调用)
 */
export function resetSessionStore(): void {
  sessions.set([]);
  currentSessionId.set(null);
  sessionState.set(null);
  commandHistory.set([]);
  currentWorkspaceSession.set(null);
  isLoading.set(false);
  lastError.set(null);
  if (sessionSwitchedSource) {
    sessionSwitchedSource.close();
    sessionSwitchedSource = null;
  }
}
