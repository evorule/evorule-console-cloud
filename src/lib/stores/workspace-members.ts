// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Workspace 成员管理 store(P08 §6.2)。
// 持久化:localStorage(key: evorule-console-cloud:workspace-members)
//
// 设计:
//   - P0 mock:localStorage 持久化,无后端调用
//   - 设计文档 §6.2 是 fetch-based,P0 改写为 localStorage CRUD
//   - P0 单 Workspace:成员全局共享(无 workspaceId 区分)
//     P1+ 多 Workspace 时按 workspaceId 分组
//   - 预填 3 个成员(admin/lead/doctor),覆盖 3 种 WorkspaceRole
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.2

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export type WorkspaceRole = 'author' | 'reviewer' | 'observer';

export interface WorkspaceMember {
	userId: string;
	username: string;
	displayName: string;
	role: WorkspaceRole;
	addedAt: string;
	addedBy: string;
}

const STORAGE_KEY = 'evorule-console-cloud:workspace-members';

/** 预填 3 个成员(P0 demo,覆盖 3 种 WorkspaceRole) */
const BUILTIN_MEMBERS: WorkspaceMember[] = [
	{
		userId: 'u-admin',
		username: 'admin',
		displayName: '张主任',
		role: 'reviewer',
		addedAt: '2026-08-01T09:00:00Z',
		addedBy: 'system',
	},
	{
		userId: 'u-lead',
		username: 'lead',
		displayName: '李科长',
		role: 'author',
		addedAt: '2026-08-01T09:00:00Z',
		addedBy: 'system',
	},
	{
		userId: 'u-doctor',
		username: 'doctor',
		displayName: '王医生',
		role: 'observer',
		addedAt: '2026-08-01T09:00:00Z',
		addedBy: 'system',
	},
];

function loadMembers(): WorkspaceMember[] {
	if (!browser) return BUILTIN_MEMBERS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return BUILTIN_MEMBERS;
		const parsed = JSON.parse(raw) as WorkspaceMember[];
		if (!Array.isArray(parsed)) return BUILTIN_MEMBERS;
		return parsed;
	} catch {
		return BUILTIN_MEMBERS;
	}
}

export const workspaceMembersStore = writable<WorkspaceMember[]>(loadMembers());

// 持久化
workspaceMembersStore.subscribe((members) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
});

/**
 * 添加成员(若 userId 已存在则抛错)。
 */
export function addMember(m: Omit<WorkspaceMember, 'addedAt'>): void {
	const existing = get(workspaceMembersStore).find((x) => x.userId === m.userId);
	if (existing) {
		throw new Error(`成员已存在: ${m.username}`);
	}
	const newMember: WorkspaceMember = {
		...m,
		addedAt: new Date().toISOString(),
	};
	workspaceMembersStore.update((list) => [...list, newMember]);
}

/** 修改成员角色 */
export function updateMemberRole(
	userId: string,
	role: WorkspaceRole,
): void {
	workspaceMembersStore.update((list) =>
		list.map((m) => (m.userId === userId ? { ...m, role } : m)),
	);
}

/** 移除成员 */
export function removeMember(userId: string): void {
	workspaceMembersStore.update((list) =>
		list.filter((m) => m.userId !== userId),
	);
}

/** 按 userId 查成员 */
export function getMember(userId: string): WorkspaceMember | undefined {
	return get(workspaceMembersStore).find((m) => m.userId === userId);
}

/** 当前用户在 Workspace 内的角色(null = 非成员) */
export function myRoleInWorkspace(userId: string): WorkspaceRole | null {
	return get(workspaceMembersStore).find((m) => m.userId === userId)?.role ?? null;
}

/** 重置为 builtin(测试 / demo 用) */
export function resetMembers(): void {
	workspaceMembersStore.set(BUILTIN_MEMBERS);
}
