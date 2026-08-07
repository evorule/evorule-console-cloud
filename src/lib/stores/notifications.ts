// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 站内通知 store(P08 §6.6)。
// 持久化:localStorage(key: evorule-console-cloud:notifications)
//
// 设计:
//   - P0 mock:localStorage,无后端推送
//   - 通知由前端事件触发(@提及 / 审核请求 / 发布状态变更 / 系统)
//   - 未读计数派生(组件订阅 unreadCount)
//   - 限 50 条(FIFO,超限移除最早)
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.6

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export type NotificationType =
	| 'mention'
	| 'review_request'
	| 'publish_status'
	| 'system';

export interface Notification {
	id: string;
	type: NotificationType;
	title: string;
	body: string;
	createdAt: string;
	read: boolean;
	/** 点击跳转链接(可选) */
	link?: string;
}

const STORAGE_KEY = 'evorule-console-cloud:notifications';
const MAX_NOTIFICATIONS = 50;

function loadNotifications(): Notification[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export const notificationsStore = writable<Notification[]>(loadNotifications());

notificationsStore.subscribe((notifications) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
});

function generateId(): string {
	return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 推送通知。
 * @returns 通知 ID
 */
export function pushNotification(
	n: Omit<Notification, 'id' | 'createdAt' | 'read'>,
): string {
	const id = generateId();
	const notification: Notification = {
		...n,
		id,
		createdAt: new Date().toISOString(),
		read: false,
	};
	notificationsStore.update((list) => {
		const next = [notification, ...list];
		// FIFO 限 50 条
		if (next.length > MAX_NOTIFICATIONS) {
			return next.slice(0, MAX_NOTIFICATIONS);
		}
		return next;
	});
	return id;
}

/** 标记单条已读 */
export function markAsRead(id: string): void {
	notificationsStore.update((list) =>
		list.map((n) => (n.id === id ? { ...n, read: true } : n)),
	);
}

/** 全部标记已读 */
export function markAllAsRead(): void {
	notificationsStore.update((list) => list.map((n) => ({ ...n, read: true })));
}

/** 删除通知 */
export function deleteNotification(id: string): void {
	notificationsStore.update((list) => list.filter((n) => n.id !== id));
}

/** 清空全部 */
export function clearAllNotifications(): void {
	notificationsStore.set([]);
}

/** 未读计数(派生 store) */
export const unreadCount = derived(
	notificationsStore,
	($n) => $n.filter((x) => !x.read).length,
);

/** 最近 N 条通知(默认 10) */
export function recentNotifications(limit = 10): Notification[] {
	return get(notificationsStore).slice(0, limit);
}

/** 重置(测试用) */
export function resetNotifications(): void {
	notificationsStore.set([]);
}
