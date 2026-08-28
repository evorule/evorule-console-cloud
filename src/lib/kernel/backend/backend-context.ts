// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 执行后端 — Svelte context 注入
//
// 依据: docs/IMPLEMENTATION_PLAN.md 阶段1
// 设计:evorule-console 视图通过 Svelte context 拿到 ExecutionBackend 实例,
//       不直接 new HttpBackend,便于:
//   - 单元测试时注入 MockBackend
//   - 高级版切换为 EmbeddedBackend(Tauri)时,只在 root 改一处

import { getContext, setContext, hasContext } from 'svelte';
import type { ExecutionBackend } from './types';
import { HttpBackend } from './http-backend';

const BACKEND_CONTEXT_KEY = Symbol('evorule-console:execution-backend');

/**
 * 在根组件(+layout.svelte)调用一次,注入 backend 实例。
 *
 * 默认用 HttpBackend(开发期 / 大众版)。
 * 高级版替换为 EmbeddedBackend 时,只需在 root 处显式传 backend 参数。
 *
 * @param backend  可选,自定义 backend(测试或高级版用)
 */
export function provideBackend(backend?: ExecutionBackend): ExecutionBackend {
  const instance = backend ?? new HttpBackend();
  setContext<ExecutionBackend>(BACKEND_CONTEXT_KEY, instance);
  return instance;
}

/**
 * 在子组件调用,取出注入的 backend 实例。
 *
 * @throws 若未在父组件调用过 provideBackend,抛出明确错误(便于排查)
 */
export function useBackend(): ExecutionBackend {
  if (!hasContext(BACKEND_CONTEXT_KEY)) {
    throw new Error(
      'useBackend: no ExecutionBackend provided. ' +
        'Call provideBackend() in +layout.svelte first.'
    );
  }
  return getContext<ExecutionBackend>(BACKEND_CONTEXT_KEY);
}

/**
 * 非抛错版,用于"可能未注入"的场景(如临时组件、e2e 测试页)。
 */
export function useBackendOrNull(): ExecutionBackend | null {
  if (!hasContext(BACKEND_CONTEXT_KEY)) return null;
  return getContext<ExecutionBackend>(BACKEND_CONTEXT_KEY);
}

export { HttpBackend } from './http-backend';
export type { ExecutionBackend } from './types';
