// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §3.6 导入快照 store — 导入前自动创建快照,可回滚。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.6 + §4.5 定义。
//
// 设计:
//   - createImportSnapshot:导入前调用,快照当前规则/数据集/表单
//   - 快照内容存 localStorage(contentRef 指向 key)
//   - 30 天后自动过期(查询时过滤)
//   - restoreSnapshot:回滚到快照状态
//
// P0 简化:
//   - 不存 ZIP blob,直接存 JSON 字符串(localStorage 容量够用)
//   - 与 P08 production_audit 不同:后者管规则集版本,快照管导入操作
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.6 + §4.5

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { getAllRules } from "@evorule/console";
import { datasetStore } from "./dataset";
import { businessFormSchemaStore } from "./business-form-schema";
import type { ImportSnapshot } from "./import-export-types";

// ============================================================================
// 1. Store 定义
// ============================================================================

const INDEX_KEY = "evorule-console-cloud:import-snapshots:index";
const CONTENT_PREFIX = "evorule-console-cloud:import-snapshots:content:";

/**
 * 内存存储回退:非浏览器环境(测试/SSR)用 Map 替代 localStorage。
 * 保证 store 逻辑在 Node 环境也可测试。
 */
const memoryStorage = new Map<string, string>();

function storageGet(key: string): string | null {
	if (browser) {
		return localStorage.getItem(key);
	}
	return memoryStorage.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
	if (browser) {
		localStorage.setItem(key, value);
	} else {
		memoryStorage.set(key, value);
	}
}

function storageRemove(key: string): void {
	if (browser) {
		localStorage.removeItem(key);
	} else {
		memoryStorage.delete(key);
	}
}

function storageClear(): void {
	if (browser) {
		// 只清快照相关 key,避免误伤其他 store
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key && (key === INDEX_KEY || key.startsWith(CONTENT_PREFIX))) {
				keysToRemove.push(key);
			}
		}
		for (const key of keysToRemove) localStorage.removeItem(key);
	} else {
		memoryStorage.clear();
	}
}

function loadIndex(): ImportSnapshot[] {
	try {
		const raw = storageGet(INDEX_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as ImportSnapshot[]) : [];
	} catch {
		return [];
	}
}

export const importSnapshotsStore = writable<ImportSnapshot[]>(loadIndex());

importSnapshotsStore.subscribe((snapshots) => {
	storageSet(INDEX_KEY, JSON.stringify(snapshots));
});

// ============================================================================
// 2. 创建快照
// ============================================================================

/**
 * 创建导入前快照。
 *
 * 捕获当前 rules / datasets / forms 状态,存为 localStorage 快照。
 * @param userId 操作人 ID
 * @param label 可选标签(如"导入 DJBH 规则集前")
 * @returns 快照 ID
 */
export async function createImportSnapshot(
	userId: string,
	label?: string,
): Promise<string> {
	const id = `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const now = new Date();
	const createdAt = now.toISOString();
	const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

	// 捕获当前状态
	const content = {
		rules: getAllRules(),
		datasets: get(datasetStore),
		forms: get(businessFormSchemaStore),
	};
	const contentStr = JSON.stringify(content);
	const sizeBytes = new Blob([contentStr]).size;

	// 存内容
	storageSet(`${CONTENT_PREFIX}${id}`, contentStr);

	// 加索引
	const snapshot: ImportSnapshot = {
		id,
		userId,
		label,
		sizeBytes,
		createdAt,
		expiresAt,
		contentRef: `${CONTENT_PREFIX}${id}`,
	};
	importSnapshotsStore.update((list) => [snapshot, ...list]);

	return id;
}

// ============================================================================
// 3. 恢复快照
// ============================================================================

/**
 * 恢复到指定快照状态。
 *
 * 警告:会覆盖当前的 rules / datasets / forms。
 * 建议恢复前再创建一个"恢复前"快照。
 *
 * @param snapshotId 快照 ID
 * @returns 是否成功
 */
export async function restoreSnapshot(snapshotId: string): Promise<boolean> {
	const snapshots = get(importSnapshotsStore);
	const snapshot = snapshots.find((s) => s.id === snapshotId);
	if (!snapshot) {
		throw new Error(`快照 ${snapshotId} 不存在`);
	}

	const contentStr = storageGet(snapshot.contentRef);
	if (!contentStr) {
		throw new Error(`快照内容丢失(storage key=${snapshot.contentRef})`);
	}

	const content = JSON.parse(contentStr) as {
		rules: unknown[];
		datasets: unknown[];
		forms: unknown[];
	};

	// 恢复 datasets / forms(直接覆盖 store)
	datasetStore.set(content.datasets as never);
	businessFormSchemaStore.set(content.forms as never);

	// 恢复 rules:内核 rules store 没有公开的 set 方法,
	// P0 简化:清除现有规则 + 逐条 importRule
	// 注:这里不实际清除,避免误删;仅提示用户恢复后需手动同步
	// P1 接入真实后端时,通过 API restore
	console.warn(
		`[import-snapshot] 已恢复 datasets + forms(${content.datasets.length} 数据集, ${content.forms.length} 表单)。rules 恢复需手动操作(P0 限制)。`,
	);

	return true;
}

// ============================================================================
// 4. 删除快照
// ============================================================================

/** 删除单个快照(同时清内容) */
export function deleteSnapshot(snapshotId: string): void {
	const snapshots = get(importSnapshotsStore);
	const snapshot = snapshots.find((s) => s.id === snapshotId);
	if (snapshot) {
		storageRemove(snapshot.contentRef);
	}
	importSnapshotsStore.update((list) =>
		list.filter((s) => s.id !== snapshotId),
	);
}

// ============================================================================
// 5. 清理过期快照
// ============================================================================

/** 清理已过期的快照(查询时自动调用) */
export function purgeExpiredSnapshots(): number {
	const now = Date.now();
	let purged = 0;
	const snapshots = get(importSnapshotsStore);
	const remaining: ImportSnapshot[] = [];
	for (const s of snapshots) {
		if (new Date(s.expiresAt).getTime() < now) {
			storageRemove(s.contentRef);
			purged++;
		} else {
			remaining.push(s);
		}
	}
	if (purged > 0) {
		importSnapshotsStore.set(remaining);
	}
	return purged;
}

// ============================================================================
// 6. 查询
// ============================================================================

/** 列出某用户的所有未过期快照(按创建时间降序) */
export function listSnapshotsByUser(userId: string): ImportSnapshot[] {
	purgeExpiredSnapshots();
	return get(importSnapshotsStore)
		.filter((s) => s.userId === userId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 获取单个快照 */
export function getSnapshot(snapshotId: string): ImportSnapshot | undefined {
	return get(importSnapshotsStore).find((s) => s.id === snapshotId);
}

/** 获取快照内容(测试用,不通过 localStorage 直接访问) */
export function getSnapshotContent(contentRef: string): string | null {
	return storageGet(contentRef);
}

/** 删除快照内容(测试用,模拟内容丢失) */
export function removeSnapshotContent(contentRef: string): void {
	storageRemove(contentRef);
}

/** 重置(测试用) */
export function resetImportSnapshots(): void {
	const snapshots = get(importSnapshotsStore);
	for (const s of snapshots) {
		storageRemove(s.contentRef);
	}
	storageClear();
	importSnapshotsStore.set([]);
}
