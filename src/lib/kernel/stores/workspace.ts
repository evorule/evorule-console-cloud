// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console workspace store — 工作空间 + 规则种入 + 发布/生产状态
//
// 依据: 实施文档_界面升级_v1.0.md §C.2.1
//
// 设计:
//   - store 不持有 backend 实例(backend 由组件注入,便于测试 mock)
//   - 函数签名带 backend 参数,组件调 useWorkspaceBackend() 后传入
//   - 首次启动自动 ensureDefaultWorkspace + seedBuiltinRules (开箱可见 3 条示例)
//   - localStorage 仅记录 default-workspace-id(记住"上次进入哪个 ws")
//   - 不缓存规则列表(规则列表归 rules.ts 管,本 store 只管 workspace 元信息)

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type {
  WorkspaceBackend,
  WorkspaceRecord,
  SessionRecord,
  SandboxSession,
  PublishQueueItem,
  ProductionStateRecord
} from '$lib/kernel/backend/workspace-types';
import { BUILTIN_RULES } from '$lib/kernel/views/RuleLibrary/example-rules';

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_WS_KEY = 'evorule-console:default-workspace-id';
const DEFAULT_WS_NAME = '默认工作空间';
const DEFAULT_WS_OWNER = 'console';
const DEFAULT_WS_DESC = 'evorule-console 自动创建';

/** 种入 BUILTIN_RULES 时写入 metadata 的标记 */
const BUILTIN_METADATA = JSON.stringify({ readonly: true, builtin: true });

// ============================================================================
// Stores
// ============================================================================

export const workspaces = writable<WorkspaceRecord[]>([]);
export const currentWorkspace = writable<WorkspaceRecord | null>(null);
export const workspaceSessions = writable<SessionRecord[]>([]);
export const workspaceSandboxes = writable<SandboxSession[]>([]);
export const publishQueue = writable<PublishQueueItem[]>([]);
export const productionState = writable<ProductionStateRecord | null>(null);
export const isLoading = writable(false);
export const lastError = writable<string | null>(null);

/** 当前 workspace id (派生,只读) */
export const currentWorkspaceId = derived(
  currentWorkspace,
  ($ws) => $ws?.id ?? null
);

// ============================================================================
// Actions
// ============================================================================

/**
 * 拉取 workspace 列表。
 * 列表为空时自动 ensureDefaultWorkspace(开箱可用)。
 */
export async function refreshWorkspaces(backend: WorkspaceBackend): Promise<void> {
  isLoading.set(true);
  lastError.set(null);
  try {
    const list = await backend.listWorkspaces();
    workspaces.set(list);

    if (list.length === 0) {
      // 首次启动:创建默认工作空间 + 种入示例规则
      await ensureDefaultWorkspace(backend);
      return;
    }

    // 恢复上次选中的 workspace (localStorage 记录的 default id)
    const savedId = browser ? localStorage.getItem(DEFAULT_WS_KEY) : null;
    const target = savedId
      ? list.find((w) => w.id === savedId) ?? list[0]
      : list[0];
    await selectWorkspace(backend, target.id);
  } catch (e) {
    lastError.set(`刷新 workspace 列表失败: ${(e as Error).message}`);
  } finally {
    isLoading.set(false);
  }
}

/**
 * 首次启动逻辑:创建默认工作空间 + 种入 3 条 BUILTIN_RULES。
 *
 * 流程:
 *   1. listWorkspaces 确认为空
 *   2. createWorkspace({name:'默认工作空间', owner_id:'console', ...})
 *   3. seedBuiltinRules(backend, workspaceId) — 种入 3 条示例
 *   4. localStorage 记录 default-workspace-id
 *   5. 切换 currentWorkspace 到新建的 ws
 *
 * 幂等性:若已存在 workspace 则不重复创建(由 refreshWorkspaces 保证)。
 */
export async function ensureDefaultWorkspace(
  backend: WorkspaceBackend
): Promise<WorkspaceRecord> {
  // 二次确认(防止并发调用)
  const existing = await backend.listWorkspaces();
  if (existing.length > 0) {
    const target = existing[0];
    currentWorkspace.set(target);
    if (browser) localStorage.setItem(DEFAULT_WS_KEY, target.id);
    return target;
  }

  const ws = await backend.createWorkspace({
    name: DEFAULT_WS_NAME,
    owner_id: DEFAULT_WS_OWNER,
    description: DEFAULT_WS_DESC
  });

  // 种入示例规则(失败不阻断 — workspace 已建好,用户可手动加规则)
  try {
    await seedBuiltinRules(backend, ws.id);
  } catch (e) {
    console.warn('[workspace] 种入 BUILTIN_RULES 部分失败:', e);
  }

  // 更新 stores
  workspaces.update((all) => (all.some((w) => w.id === ws.id) ? all : [...all, ws]));
  currentWorkspace.set(ws);
  if (browser) localStorage.setItem(DEFAULT_WS_KEY, ws.id);

  return ws;
}

/**
 * 种入 3 条 BUILTIN_RULES 到指定 workspace。
 *
 * 幂等:先 listRules 查重,已存在(按 name 匹配)则跳过。
 * 元数据:metadata = {readonly:true, builtin:true}(isReadonly 据此判定)
 */
export async function seedBuiltinRules(
  backend: WorkspaceBackend,
  workspaceId: string
): Promise<number> {
  // 先查重(按 name)
  const existing = await backend.listRules(workspaceId);
  const existingNames = new Set(existing.map((r) => r.name));

  let seeded = 0;
  for (const seed of BUILTIN_RULES) {
    if (existingNames.has(seed.name)) continue;
    try {
      await backend.createRule(workspaceId, {
        name: seed.name,
        content: seed.content,
        created_by: DEFAULT_WS_OWNER,
        description: seed.description
      });
      // 注意:server createRule 不接受 metadata 字段(接口未暴露)
      // readonly 标记通过 client 端 isReadonly() 启发式判断(name 以 example. 开头)
      seeded++;
    } catch (e) {
      console.warn(`[workspace] 种入规则 ${seed.name} 失败:`, e);
    }
  }
  return seeded;
}

/**
 * 切换当前 workspace,刷新其会话列表。
 */
export async function selectWorkspace(
  backend: WorkspaceBackend,
  id: string
): Promise<void> {
  isLoading.set(true);
  lastError.set(null);
  try {
    const ws = await backend.getWorkspace(id);
    currentWorkspace.set(ws);
    if (browser) localStorage.setItem(DEFAULT_WS_KEY, id);

    // 顺带刷新会话列表(沙盒/规则列表由各自 store 管)
    try {
      const sessions = await backend.listWorkspaceSessions(id);
      workspaceSessions.set(sessions);
    } catch {
      workspaceSessions.set([]);
    }
  } catch (e) {
    lastError.set(`切换 workspace 失败: ${(e as Error).message}`);
  } finally {
    isLoading.set(false);
  }
}

/**
 * 刷新发布队列。
 */
export async function refreshPublishQueue(
  backend: WorkspaceBackend,
  status?: string
): Promise<void> {
  lastError.set(null);
  try {
    const items = await backend.listPublishQueue(status);
    publishQueue.set(items);
  } catch (e) {
    lastError.set(`刷新发布队列失败: ${(e as Error).message}`);
  }
}

/**
 * 刷新生产状态(单行表)。
 */
export async function refreshProductionState(
  backend: WorkspaceBackend
): Promise<void> {
  lastError.set(null);
  try {
    const state = await backend.getProductionState();
    productionState.set(state);
  } catch (e) {
    lastError.set(`刷新生产状态失败: ${(e as Error).message}`);
    productionState.set(null);
  }
}

/**
 * 刷新当前 workspace 的沙盒列表。
 */
export async function refreshSandboxes(
  backend: WorkspaceBackend,
  workspaceId: string
): Promise<void> {
  lastError.set(null);
  try {
    const list = await backend.listSandboxes(workspaceId);
    workspaceSandboxes.set(list);
  } catch (e) {
    lastError.set(`刷新沙盒列表失败: ${(e as Error).message}`);
  }
}

/**
 * 清空所有状态(组件卸载或切换 view 时调用)。
 */
export function resetWorkspaceStore(): void {
  workspaces.set([]);
  currentWorkspace.set(null);
  workspaceSessions.set([]);
  workspaceSandboxes.set([]);
  publishQueue.set([]);
  productionState.set(null);
  isLoading.set(false);
  lastError.set(null);
}

// ============================================================================
// 工具:从 metadata 判断规则是否只读(替代旧 source==='builtin')
// ============================================================================

/**
 * 判断规则是否只读(内置示例或 archived)。
 *
 * 启发式:
 *   1. metadata.readonly === true → 只读
 *   2. metadata.builtin === true → 只读
 *   3. name 以 "example." 开头 → 只读(种子规则约定)
 *
 * 注意:server 端 createRule 接口未暴露 metadata 字段(阶段 A.1 表已加列但 API 未透出),
 *      故此处 name 前缀判断是核心依据;metadata 字段留作阶段 D 透出后的二次校验。
 */
export function isRuleReadonly(rule: {
  name: string;
  metadata?: string;
}): boolean {
  // name 前缀判断(种子规则约定,核心依据)
  if (rule.name.startsWith('example.')) return true;

  // metadata 字段判断(二次校验,server 透出后生效)
  if (rule.metadata) {
    try {
      const meta = JSON.parse(rule.metadata) as { readonly?: boolean; builtin?: boolean };
      if (meta.readonly === true || meta.builtin === true) return true;
    } catch {
      // metadata 损坏,忽略
    }
  }
  return false;
}

// 暴露 get 给测试用
export { get };
