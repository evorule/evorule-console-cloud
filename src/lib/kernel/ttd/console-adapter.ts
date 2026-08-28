// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// console-adapter — 把 evorule-console 的 ExecutionBackend 适配成 ttd 的 api 对象
//
// 依据: docs/IMPLEMENTATION_PLAN.md 阶段5
// 依据: ./VERSION.md(适配说明)
//
// 设计动机:
//   - ttd 的 core/api.js 自己用 fetch() 调 evorule-server
//   - console 已有 HttpBackend(ExecutionBackend 实现),端点对齐已验证(4 修复点全 PASS)
//   - 为避免双重 fetch 实现 / 双重 baseUrl 管理 / 双重错误处理,
//     用 console HttpBackend 替换 ttd api 的方法实现
//
// 实现:
//   - 在 TimeTravel.svelte onMount 中调用 injectBackend(backend)
//   - 通过对象属性赋值覆盖 ttd api 单例的方法(ES module export 的对象属性可改)
//   - ttd 各 view 仍 `import { api } from '../core/api.js'`,但调用的已是 console 实现
//
// 边界对齐:
//   - ttd 期望的响应 shape 与 console HttpBackend 返回 shape 略有差异(如下注释)
//   - 适配层做最小转换,不重算任何业务数据

import type { ExecutionBackend, SessionId } from '$lib/kernel/backend/types';
import { api as ttdApi } from './core/api.js';

/**
 * 把 console 的 ExecutionBackend 注入到 ttd api 模块。
 *
 * 调用时机:TimeTravel.svelte onMount 后,backend 实例已就绪时。
 * 调用一次即可,后续 ttd 各 view 调 api.xxx() 会走 console 实现。
 *
 * @param backend  console 的执行后端实例(HttpBackend 或 EmbeddedBackend)
 */
export function injectBackend(backend: ExecutionBackend): void {
  // === Session 管理 ===

  // ttd 期望: { sessions: [...] } 或裸数组; console 返回: SessionId[]
  ttdApi.listSessions = async () => {
    const ids = await backend.listSessions();
    return { sessions: ids };
  };

  // ttd 期望: { id: number } 或裸数字; console 返回: SessionId(number)
  ttdApi.createSession = async () => {
    const id = await backend.createSession();
    return { id };
  };

  ttdApi.closeSession = async (id: SessionId) => {
    await backend.closeSession(id);
  };

  // === 时间旅行 ===

  // ttd rewind 直接返回 session state(console getStateAtVersion 已对齐 ?version= query)
  ttdApi.rewind = async (id: SessionId, version: number) => {
    return backend.getStateAtVersion(id, version);
  };

  // ttd state(id) 拿当前快照; console getSessionState 已对齐
  ttdApi.state = async (id: SessionId) => {
    return backend.getSessionState(id);
  };

  // ttd diff 期望 { items, removed, summary }(D1-B 修复后契约)。
  // console HttpBackend.getDiff 返回 DiffResult { items, removed },与 ttd diff.js 对齐。
  // ttd diff.js 的 renderServerDiff 从 items 中按元组长度分离 added(2元组)/changed(3元组),
  // 并兜底兼容旧 added/changed 字段(过渡期不崩)。
  // 这里透传 backend 返回,不做转换。
  ttdApi.diff = async (id: SessionId, a: number, b: number) => {
    return backend.getDiff(id, a, b) as unknown as Record<string, unknown>;
  };

  // === 审计 ===

  // ttd audit 期望 { fact_count, verified, last_hash, entries }; console SessionAudit 已对齐
  ttdApi.audit = async (id: SessionId) => {
    return backend.getAudit(id);
  };

  // ttd auditVerify 期望 { verified, fact_count, last_hash }; console VerifyResult { verified, detail? }
  // 适配:补 fact_count / last_hash 为 undefined(ttd audit-badge.js 会显示 ? 但不崩)
  // 注意:evorule-console 的 AuditView 用 verifyAuditChain 显示 detail,
  //       ttd 内嵌时只展示 verified 状态,不需要 detail(避免重复)
  ttdApi.auditVerify = async (id: SessionId) => {
    return backend.verifyAudit(id);
  };

  // ttd causal 期望 { chain: CausalEntry[] }; console CausalChain { chain: CausalEntry[] } 已对齐
  // (C3 修复,2026-08-03:chain 元素是 CausalEntry(fact_id/fact_type),不是 Fact(type/id))
  ttdApi.causal = async (id: SessionId, factId: number) => {
    return backend.getCausalChain(id, factId);
  };

  // === 历史 / 回放 ===

  // ttd replay 期望裸数组或 { facts: [...] }; console 返回 Fact[]
  ttdApi.replay = async (id: SessionId, from: number = 0, to: number | null = null) => {
    return backend.getReplay(id, from, to);
  };

  ttdApi.history = async (id: SessionId) => {
    return backend.getHistory(id);
  };

  ttdApi.facts = async (id: SessionId, prefix?: string) => {
    return backend.getFacts(id, prefix);
  };

  // === 命令执行 ===

  // ttd command 期望 { success: boolean, message?: string } 或类似;
  // console CommandResult { accepted, version?, error? }
  // 适配:把 accepted 映射为 success,error 映射为 message
  ttdApi.command = async (id: SessionId, instruction: object) => {
    const r = await backend.submitCommand(id, instruction);
    return {
      success: r.accepted,
      message: r.error,
      version: r.version
    };
  };

  // ttd fork 期望 { session_id: number }; console 返回 SessionId(number)
  ttdApi.fork = async (parentId: SessionId, version: number) => {
    const id = await backend.forkSession(parentId, version);
    return { session_id: id };
  };
}

/**
 * 把 console 当前选中的 session 同步给 ttd store + emit SESSION_SELECT。
 *
 * 调用时机:console session store 的 currentSessionId 变化时,
 * TimeTravel.svelte 监听变化后调用本函数。
 *
 * @param sessionId  console 当前 session id(null 表示无 session)
 */
export async function syncSessionToTtd(sessionId: number | null): Promise<void> {
  // 动态 import 避免循环依赖(console-adapter 不被 store 层 import)
  const { store } = await import('./core/store.js');
  const { eventbus, EVENTS } = await import('./core/eventbus.js');

  if (sessionId === null) {
    store.dispatch({ currentSessionId: null, selectedVersion: 0 });
    return;
  }

  // 避免重复 emit:只有当 ttd store 的 currentSessionId 与传入不同时才同步
  if (store.getState().currentSessionId !== sessionId) {
    store.dispatch({ currentSessionId: sessionId, selectedVersion: 0 });
    eventbus.emit(EVENTS.SESSION_SELECT, sessionId);
  }
}
