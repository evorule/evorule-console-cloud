// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console workspace 后端 — Svelte context 注入
//
// 依据: 实施文档_界面升级_v1.0.md §C.1
// 设计: 仿照 backend-context.ts 模式(并列 context + 独立 Symbol key)。
//   与 assistant-context 的"默认 null"不同,WorkspaceBackend 不默认 null ——
//   evorule-console 自身在 +layout.svelte 注入 HttpWorkspaceBackend(大众版默认实例),
//   因为 workspace 能力是 console 的核心依赖(规则库/沙盒/发布都靠它)。
//
//   - 大众版: +layout.svelte 调 provideWorkspaceBackend(new HttpWorkspaceBackend())
//   - 高级版: 替换为 EmbeddedWorkspaceBackend(Tauri)时,只在 root 改一处
//   - 单元测试: 注入 MockWorkspaceBackend

import { getContext, setContext, hasContext } from 'svelte';
import type { WorkspaceBackend } from './workspace-types';
import { HttpWorkspaceBackend } from './http-workspace-backend';

const WORKSPACE_CONTEXT_KEY = Symbol('evorule-console:workspace-backend');

/**
 * 在根组件(+layout.svelte)调用一次,注入 workspace backend 实例。
 *
 * 默认用 HttpWorkspaceBackend(开发期 / 大众版,loopback 免认证)。
 * 高级版替换为 EmbeddedWorkspaceBackend 时,显式传 backend 参数。
 *
 * @param backend  可选,自定义 backend(测试或高级版用)
 */
export function provideWorkspaceBackend(
  backend?: WorkspaceBackend
): WorkspaceBackend {
  const instance = backend ?? new HttpWorkspaceBackend();
  setContext<WorkspaceBackend>(WORKSPACE_CONTEXT_KEY, instance);
  return instance;
}

/**
 * 在子组件调用,取出注入的 workspace backend 实例。
 *
 * @throws 若未在父组件调用过 provideWorkspaceBackend,抛出明确错误(便于排查)
 */
export function useWorkspaceBackend(): WorkspaceBackend {
  if (!hasContext(WORKSPACE_CONTEXT_KEY)) {
    throw new Error(
      'useWorkspaceBackend: no WorkspaceBackend provided. ' +
        'Call provideWorkspaceBackend() in +layout.svelte first.'
    );
  }
  return getContext<WorkspaceBackend>(WORKSPACE_CONTEXT_KEY);
}

/**
 * 非抛错版,用于"可能未注入"的场景(如临时组件、e2e 测试页)。
 */
export function useWorkspaceBackendOrNull(): WorkspaceBackend | null {
  if (!hasContext(WORKSPACE_CONTEXT_KEY)) return null;
  return getContext<WorkspaceBackend>(WORKSPACE_CONTEXT_KEY);
}

export { HttpWorkspaceBackend } from './http-workspace-backend';
export type { WorkspaceBackend } from './workspace-types';
