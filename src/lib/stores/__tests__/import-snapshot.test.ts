// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P09 import-snapshot 单测 — 快照创建/恢复/过期/清理
//
// 运行: npx vitest run src/lib/stores/__tests__/import-snapshot.test.ts
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.6 + §4.5

import { describe, test, expect, beforeEach } from "vitest";
import {
	importSnapshotsStore,
	createImportSnapshot,
	restoreSnapshot,
	deleteSnapshot,
	purgeExpiredSnapshots,
	listSnapshotsByUser,
	getSnapshot,
	getSnapshotContent,
	removeSnapshotContent,
	resetImportSnapshots,
} from "../import-snapshot";
import { get } from "svelte/store";

// ============================================================================
// 1. 准备:mock localStorage + browser 环境
// ============================================================================

// node 环境 browser=false,store 用内存 Map 替代 localStorage
beforeEach(() => {
	resetImportSnapshots();
});

// ============================================================================
// 2. createImportSnapshot
// ============================================================================

describe("P09 createImportSnapshot", () => {
	test("创建快照,返回 ID", async () => {
		const id = await createImportSnapshot("user-1", "导入前");
		expect(id).toMatch(/^snapshot-/);
	});

	test("快照写入 importSnapshotsStore", async () => {
		const id = await createImportSnapshot("user-1");
		const snapshots = get(importSnapshotsStore);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.id).toBe(id);
	});

	test("快照含 userId + label + sizeBytes + 时间戳", async () => {
		const id = await createImportSnapshot("user-1", "测试标签");
		const snap = getSnapshot(id);
		expect(snap).toBeDefined();
		expect(snap?.userId).toBe("user-1");
		expect(snap?.label).toBe("测试标签");
		expect(snap?.sizeBytes).toBeGreaterThan(0);
		expect(snap?.createdAt).toBeTruthy();
		expect(snap?.expiresAt).toBeTruthy();
	});

	test("快照内容存到 localStorage(contentRef)", async () => {
		const id = await createImportSnapshot("user-1");
		const snap = getSnapshot(id);
		expect(snap?.contentRef).toContain("import-snapshots:content:");
		expect(getSnapshotContent(snap?.contentRef ?? "")).toBeTruthy();
	});

	test("多次创建快照,按时间降序", async () => {
		await createImportSnapshot("user-1", "snap1");
		await new Promise((r) => setTimeout(r, 10));
		await createImportSnapshot("user-1", "snap2");
		const list = listSnapshotsByUser("user-1");
		expect(list).toHaveLength(2);
		// 降序:最新的在前
		expect(list[0].label).toBe("snap2");
		expect(list[1].label).toBe("snap1");
	});
});

// ============================================================================
// 3. restoreSnapshot
// ============================================================================

describe("P09 restoreSnapshot", () => {
	test("恢复存在的快照返回 true", async () => {
		const id = await createImportSnapshot("user-1", "恢复前");
		const result = await restoreSnapshot(id);
		expect(result).toBe(true);
	});

	test("恢复不存在的快照抛错", async () => {
		await expect(restoreSnapshot("nonexistent")).rejects.toThrow(/不存在/);
	});

	test("快照内容丢失抛错", async () => {
		const id = await createImportSnapshot("user-1");
		const snap = getSnapshot(id);
		// 删除内容但保留索引(模拟内容丢失)
		removeSnapshotContent(snap?.contentRef ?? "");
		await expect(restoreSnapshot(id)).rejects.toThrow(/丢失/);
	});
});

// ============================================================================
// 4. deleteSnapshot
// ============================================================================

describe("P09 deleteSnapshot", () => {
	test("删除快照,索引 + 内容都清掉", async () => {
		const id = await createImportSnapshot("user-1");
		const snap = getSnapshot(id);
		const contentRef = snap?.contentRef ?? "";
		expect(getSnapshotContent(contentRef)).toBeTruthy();

		deleteSnapshot(id);
		expect(getSnapshot(id)).toBeUndefined();
		expect(getSnapshotContent(contentRef)).toBeNull();
	});

	test("删除不存在的快照不报错", () => {
		expect(() => deleteSnapshot("nonexistent")).not.toThrow();
	});
});

// ============================================================================
// 5. purgeExpiredSnapshots
// ============================================================================

describe("P09 purgeExpiredSnapshots", () => {
	test("清理已过期的快照", async () => {
		// 创建一个快照
		const id = await createImportSnapshot("user-1");
		const snap = getSnapshot(id);
		// 手动改 expiresAt 为过去
		if (snap) {
			snap.expiresAt = "2020-01-01T00:00:00.000Z";
			importSnapshotsStore.update((list) =>
				list.map((s) => (s.id === id ? snap : s)),
			);
		}

		const purged = purgeExpiredSnapshots();
		expect(purged).toBe(1);
		expect(getSnapshot(id)).toBeUndefined();
	});

	test("未过期的快照保留", async () => {
		const id = await createImportSnapshot("user-1");
		const purged = purgeExpiredSnapshots();
		expect(purged).toBe(0);
		expect(getSnapshot(id)).toBeDefined();
	});
});

// ============================================================================
// 6. listSnapshotsByUser
// ============================================================================

describe("P09 listSnapshotsByUser", () => {
	test("按 userId 过滤", async () => {
		await createImportSnapshot("user-1", "u1-snap");
		await createImportSnapshot("user-2", "u2-snap");
		expect(listSnapshotsByUser("user-1")).toHaveLength(1);
		expect(listSnapshotsByUser("user-2")).toHaveLength(1);
		expect(listSnapshotsByUser("user-3")).toHaveLength(0);
	});

	test("返回按 createdAt 降序", async () => {
		await createImportSnapshot("user-1", "first");
		await new Promise((r) => setTimeout(r, 10));
		await createImportSnapshot("user-1", "second");
		const list = listSnapshotsByUser("user-1");
		expect(list[0].label).toBe("second");
	});
});
