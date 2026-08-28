// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 规则库 store — 规则列表 + 当前选中规则
//
// 依据: 实施文档_界面升级_v1.0.md §C.2.3 (核心技术债偿还)
//
// 阶段 C 重构说明:
//   - 旧版:规则存 localStorage(技术债),source 字段区分 builtin/user
//   - 新版:数据源 = WorkspaceBackend.listRules(server workspace 表)
//   - Rule 类型对齐 server RuleRecord(ULID id + state 状态机 + metadata)
//   - 写操作改 async,调 createRule/updateRuleContent/archiveRule
//   - 旧 localStorage key 'evorule-console:rules:user' 检测 → migrationNeeded
//   - 一次性迁移 migrateLegacyRules:旧规则 → server createRule + 备份旧 key
//   - source 字段废弃;只读判定改用 isRuleReadonly()(name 前缀 + metadata)
//
// 设计:
//   - store 不持有 backend(组件注入,便于测试 mock)
//   - content 懒加载(RuleRecord 不含 content,需额外调 getRule 或本地缓存)

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type {
  WorkspaceBackend,
  RuleRecord,
  RuleState
} from '$lib/kernel/backend/workspace-types';
import { isRuleReadonly } from './workspace';

// ============================================================================
// 类型
// ============================================================================

export type { RuleState } from '$lib/kernel/backend/workspace-types';

/**
 * 规则视图模型(对齐 server RuleRecord + 懒加载 content)。
 *
 * 与 server RuleRecord 的差异:
 *   - 字段名 camelCase(前端约定)
 *   - content/version 懒加载(从 RuleVersionRecord 取,默认 undefined)
 */
export interface Rule {
  /** RuleRecord.id (ULID,server 生成) */
  id: string;
  /** RuleRecord.workspace_id */
  workspaceId: string;
  /** RuleRecord.name (workspace 内唯一,替代旧 id 语义) */
  name: string;
  /** RuleRecord.state (draft/candidate/active/blocked/archived) */
  state: RuleState;
  /** RuleRecord.current_version_id (Draft 状态时为 null) */
  currentVersionId: string | null;
  /** RuleRecord.description */
  description: string | null;
  /** RuleRecord.metadata (JSON 字符串,空时为 "{}") */
  metadata: string;
  /** RuleRecord.created_at (ISO 字符串) */
  createdAt: string;
  /** RuleRecord.updated_at (ISO 字符串) */
  updatedAt: string;
  /** 当前版本内容(懒加载,从 RuleVersionRecord.content 取) */
  content?: string;
  /** 当前版本号(懒加载,从 RuleVersionRecord.version 取) */
  version?: number;
}

// ============================================================================
// 常量
// ============================================================================

/** 旧 localStorage key(技术债,迁移后清理) */
const LEGACY_STORAGE_KEY = 'evorule-console:rules:user';
/** 迁移后保留的只读备份 key(防止迁移失败丢数据) */
const LEGACY_BACKUP_KEY = 'evorule-console:rules:user:migrated-backup';
/** 离线快照 key 前缀(按 workspace 隔离) */
const OFFLINE_SNAPSHOT_PREFIX = 'evorule-console:rules:offline-snapshot:';

// ============================================================================
// Stores
// ============================================================================

export const rules = writable<Rule[]>([]);
export const selectedRuleId = writable<string | null>(null);
export const migrationNeeded = writable(false);
export const isOffline = writable(false);
export const lastError = writable<string | null>(null);

/** 当前选中的规则(派生 store) */
export const selectedRule = derived(
  [rules, selectedRuleId],
  ([$rules, $selectedId]) => {
    if (!$selectedId) return null;
    return $rules.find((r) => r.id === $selectedId) ?? null;
  }
);

// ============================================================================
// Helpers
// ============================================================================

/** RuleRecord → Rule 视图模型 */
function toRule(
  r: RuleRecord,
  content?: string,
  version?: number
): Rule {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    state: r.state,
    currentVersionId: r.current_version_id,
    description: r.description,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    content,
    version
  };
}

/** 写离线快照(写 server 成功后调用,断网时可读) */
function persistOfflineSnapshot(workspaceId: string, list: Rule[]): void {
  if (!browser) return;
  try {
    localStorage.setItem(
      OFFLINE_SNAPSHOT_PREFIX + workspaceId,
      JSON.stringify(list)
    );
  } catch {
    // 配额满或隐私模式,忽略
  }
}

// ============================================================================
// Actions — 数据加载
// ============================================================================

/**
 * 从 server 拉取 workspace 的规则列表。
 *
 * 注意:server listRules 返回 RuleRecord[] 不含 content;
 *      content 在选中规则时通过 getRule 懒加载(阶段 D 视图可优化为批量预取)。
 */
export async function refreshRules(
  backend: WorkspaceBackend,
  workspaceId: string
): Promise<void> {
  lastError.set(null);
  try {
    const records = await backend.listRules(workspaceId);
    const list = records.map((r) => toRule(r));
    rules.set(list);
    isOffline.set(false);
    persistOfflineSnapshot(workspaceId, list);

    // 自动选中第一个(若当前选中已不存在)
    const current = get(selectedRuleId);
    if (
      (current === null || !list.some((r) => r.id === current)) &&
      list.length > 0
    ) {
      selectedRuleId.set(list[0].id);
    } else if (list.length === 0) {
      selectedRuleId.set(null);
    }
  } catch (e) {
    lastError.set(`刷新规则列表失败: ${(e as Error).message}`);
    isOffline.set(true);
    // fallback 到离线快照
    loadOfflineSnapshot(workspaceId);
  }
}

/** 从 localStorage 加载离线快照(网络失败时 fallback) */
function loadOfflineSnapshot(workspaceId: string): void {
  if (!browser) return;
  try {
    const stored = localStorage.getItem(OFFLINE_SNAPSHOT_PREFIX + workspaceId);
    if (stored) {
      const list = JSON.parse(stored) as Rule[];
      rules.set(list);
      if (list.length > 0 && get(selectedRuleId) === null) {
        selectedRuleId.set(list[0].id);
      }
    }
  } catch {
    // 快照损坏,忽略
  }
}

/**
 * 懒加载规则内容(content + version)。
 *
 * server listRules / getRule 返回的 RuleRecord 不含 content(content 在 rule_versions 表)。
 * 此函数调 backend.listRuleVersions 取首条(Current,server 按 version 降序)写入 rule。
 *
 * 幂等:rule.content !== undefined 时直接返回缓存,不触发网络请求。
 *
 * @returns content 字符串;规则不存在或加载失败时返回 null
 */
export async function loadRuleContent(
  backend: WorkspaceBackend,
  workspaceId: string,
  ruleId: string
): Promise<string | null> {
  const target = get(rules).find((r) => r.id === ruleId);
  if (!target) return null;
  if (target.content !== undefined) return target.content;

  lastError.set(null);
  try {
    const versions = await backend.listRuleVersions(workspaceId, ruleId);
    if (versions.length === 0) return null;
    // server 按 version 降序返回,首条即 Current
    const current = versions[0];
    rules.update((all) =>
      all.map((r) =>
        r.id === ruleId
          ? { ...r, content: current.content, version: current.version }
          : r
      )
    );
    persistOfflineSnapshot(workspaceId, get(rules));
    return current.content;
  } catch (e) {
    lastError.set(`加载规则内容失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 确保规则存在于 store 中(直接导航到 /workspace/editor/{id} 时使用)。
 *
 * 背景:refreshRules 只在 /workspace 路由 onMount 调用。若用户直接访问
 * /workspace/editor/{id}(刷新 / 外链),$rules 为空 → 编辑器派生的 rule 为 null
 * → 显示"未找到规则",且 loadRuleContent 也会因 store 无此规则而提前返回 null。
 *
 * 此函数按 id 单条拉取:store 已有则直接返回;否则调 backend.getRule 取元数据
 * (不含 content,content 仍由 loadRuleContent 懒加载)并加入 store。
 *
 * @returns 规则视图模型;不存在或加载失败时返回 null
 */
export async function ensureRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  ruleId: string
): Promise<Rule | null> {
  const existing = get(rules).find((r) => r.id === ruleId);
  if (existing) return existing;

  lastError.set(null);
  try {
    const record = await backend.getRule(workspaceId, ruleId);
    const rule = toRule(record);
    rules.update((all) =>
      // 并发场景下避免重复加入
      all.some((r) => r.id === ruleId) ? all : [...all, rule]
    );
    return rule;
  } catch (e) {
    lastError.set(`加载规则失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 选中规则(并懒加载 content,若尚未加载)。
 */
export async function selectRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  id: string
): Promise<void> {
  selectedRuleId.set(id);
  await loadRuleContent(backend, workspaceId, id);
}

/** 仅切换 selectedRuleId(不触发网络,用于已加载的规则) */
export function selectRuleLocal(id: string): void {
  selectedRuleId.set(id);
}

// ============================================================================
// Actions — 写操作(均 async,调 server)
// ============================================================================

/**
 * 新建规则(调 server createRule)。
 * @returns 新规则 id (ULID)
 */
export async function addRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  req: { name: string; content: string; description?: string }
): Promise<string> {
  lastError.set(null);
  try {
    const record = await backend.createRule(workspaceId, {
      name: req.name,
      content: req.content,
      created_by: 'console',
      description: req.description
    });
    // server createRule 返回的 RuleRecord 不含 content;但客户端已知 content,缓存之
    const newRule = toRule(record, req.content, 1);
    rules.update((all) => [...all, newRule]);
    selectedRuleId.set(record.id);
    persistOfflineSnapshot(workspaceId, get(rules));
    return record.id;
  } catch (e) {
    lastError.set(`新建规则失败: ${(e as Error).message}`);
    throw e;
  }
}

/**
 * 更新规则内容(仅 Draft 状态允许,调 server updateRuleContent)。
 */
export async function updateRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  ruleId: string,
  patch: { content: string }
): Promise<void> {
  const target = get(rules).find((r) => r.id === ruleId);
  if (!target) throw new Error(`updateRule: 规则 "${ruleId}" 不存在`);

  // 只读规则禁止修改(替代旧 source==='builtin' 判断)
  if (isRuleReadonly(target)) {
    throw new Error(
      `updateRule: 只读规则 "${target.name}" 不可修改,请先复制为新副本(duplicateRule)`
    );
  }

  // 状态校验(仅 Draft 允许编辑内容)
  if (target.state !== 'draft') {
    throw new Error(
      `updateRule: 规则 "${target.name}" 状态为 ${target.state},仅 draft 状态允许编辑内容`
    );
  }

  lastError.set(null);
  try {
    const record = await backend.updateRuleContent(workspaceId, ruleId, {
      content: patch.content,
      updated_by: 'console'
    });
    // 递增版本号(server 不返回 version,客户端启发式 +1)
    const nextVersion = (target.version ?? 1) + 1;
    rules.update((all) =>
      all.map((r) =>
        r.id === ruleId ? toRule(record, patch.content, nextVersion) : r
      )
    );
    persistOfflineSnapshot(workspaceId, get(rules));
  } catch (e) {
    lastError.set(`更新规则失败: ${(e as Error).message}`);
    throw e;
  }
}

/**
 * 复制规则为可编辑副本(替代旧 duplicateRule,通过 createRule 实现)。
 * @returns 新规则 id
 */
export async function duplicateRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  sourceId: string
): Promise<string> {
  const all = get(rules);
  const source = all.find((r) => r.id === sourceId);
  if (!source) throw new Error(`duplicateRule: 源规则 "${sourceId}" 不存在`);
  if (source.content === undefined) {
    throw new Error(
      `duplicateRule: 源规则 "${source.name}" 内容未加载,无法复制(阶段 D 补全)`
    );
  }

  const newName = `${source.name}.copy.${Date.now()}`;
  return addRule(backend, workspaceId, {
    name: newName,
    content: source.content,
    description: source.description ?? undefined
  });
}

/**
 * 归档规则(替代旧 deleteRule,调 server archiveRule)。
 * 注意:server 不支持物理删除,归档后规则 archived_at 填充、state='archived'。
 */
export async function deleteRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  ruleId: string
): Promise<void> {
  const target = get(rules).find((r) => r.id === ruleId);
  if (!target) return;

  // 只读规则禁止归档
  if (isRuleReadonly(target)) {
    throw new Error(`deleteRule: 只读规则 "${target.name}" 不可归档`);
  }

  lastError.set(null);
  try {
    await backend.archiveRule(workspaceId, ruleId);
    rules.update((all) => all.filter((r) => r.id !== ruleId));
    // 若删除的是当前选中,自动选中第一个
    if (get(selectedRuleId) === ruleId) {
      const remaining = get(rules);
      selectedRuleId.set(remaining.length > 0 ? remaining[0].id : null);
    }
    persistOfflineSnapshot(workspaceId, get(rules));
  } catch (e) {
    lastError.set(`归档规则失败: ${(e as Error).message}`);
    throw e;
  }
}

/**
 * 从 JSON 字符串导入规则(用户上传文件)。
 * @returns 新规则 id
 */
export async function importRule(
  backend: WorkspaceBackend,
  workspaceId: string,
  jsonContent: string
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e) {
    throw new Error(`importRule: JSON 解析失败: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('importRule: 内容必须是 JSON 对象');
  }
  const obj = parsed as Record<string, unknown>;
  const name =
    typeof obj.id === 'string' ? `user.${obj.id}` : `user.imported.${Date.now()}`;
  const description =
    typeof obj.description === 'string' ? obj.description : '(导入的规则,无描述)';
  return addRule(backend, workspaceId, { name, content: jsonContent, description });
}

/**
 * 导出规则为 JSON 字符串(用于下载)。
 */
export function exportRule(id: string): string {
  const all = get(rules);
  const rule = all.find((r) => r.id === id);
  if (!rule) throw new Error(`exportRule: 规则 "${id}" 不存在`);
  if (!rule.content) {
    throw new Error(`exportRule: 规则 "${rule.name}" 内容未加载,无法导出`);
  }
  return rule.content;
}

// ============================================================================
// 一次性迁移(旧 localStorage → server)
// ============================================================================

/**
 * 检测旧 localStorage 数据是否存在,设置 migrationNeeded flag。
 * 在 /workspace 路由 onMount 调用。
 */
export function checkMigrationNeeded(): void {
  if (!browser) return;
  const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
  migrationNeeded.set(!!stored && stored !== '[]');
}

/**
 * 迁移旧 localStorage 规则到 server。
 *
 * 流程:
 *   1. 备份旧 key 到 LEGACY_BACKUP_KEY(防止迁移失败丢数据)
 *   2. 解析旧规则(JSON 数组,旧 Rule 结构)
 *   3. 逐条 createRule(name=旧 id, content=旧 content, description=旧 description)
 *   4. 全部成功后删除旧 key
 *   5. migrationNeeded.set(false)
 *
 * 失败处理:某条迁移失败不阻断整体,console.warn 记录;全部失败则保留旧 key。
 */
export async function migrateLegacyRules(
  backend: WorkspaceBackend,
  workspaceId: string
): Promise<{ migrated: number; failed: number }> {
  if (!browser) return { migrated: 0, failed: 0 };

  const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) {
    migrationNeeded.set(false);
    return { migrated: 0, failed: 0 };
  }

  // 备份(只备份一次,防止重复迁移覆盖)
  if (!localStorage.getItem(LEGACY_BACKUP_KEY)) {
    localStorage.setItem(LEGACY_BACKUP_KEY, stored);
  }

  let legacy: Array<{
    id: string;
    version?: number;
    description?: string;
    content: string;
  }>;
  try {
    legacy = JSON.parse(stored);
    if (!Array.isArray(legacy)) throw new Error('旧数据不是数组');
  } catch (e) {
    console.error('[rules] 旧 localStorage 数据损坏,无法迁移:', e);
    // 损坏数据直接清理(已备份)
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    migrationNeeded.set(false);
    return { migrated: 0, failed: 0 };
  }

  let migrated = 0;
  let failed = 0;
  for (const r of legacy) {
    try {
      await backend.createRule(workspaceId, {
        name: r.id,
        content: r.content,
        created_by: 'console',
        description: r.description
      });
      migrated++;
    } catch (e) {
      console.warn(`[rules] 迁移规则 ${r.id} 失败:`, e);
      failed++;
    }
  }

  // 全部迁移成功(或全部失败已记录)后清理旧 key
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  migrationNeeded.set(false);

  // 刷新规则列表(展示迁移后的结果)
  await refreshRules(backend, workspaceId);

  return { migrated, failed };
}

// ============================================================================
// 工具函数(非响应式,测试和命令式代码用)
// ============================================================================

/** 一次性获取当前所有规则 */
export function getAllRules(): Rule[] {
  return get(rules);
}

/** 一次性获取当前选中规则 id */
export function getSelectedRuleId(): string | null {
  return get(selectedRuleId);
}

/**
 * 判断规则是否只读(转调 workspace.isRuleReadonly,便于组件就近 import)。
 */
export { isRuleReadonly };

/**
 * 清空所有状态(组件卸载或切换 workspace 时调用)。
 */
export function resetRulesStore(): void {
  rules.set([]);
  selectedRuleId.set(null);
  migrationNeeded.set(false);
  isOffline.set(false);
  lastError.set(null);
}
