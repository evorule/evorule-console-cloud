// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 评论线程 store(P08 §6.5)。
// 持久化:localStorage(key: evorule-console-cloud:comments)
//
// 设计:
//   - P0 mock:localStorage,无后端调用
//   - 支持 3 种 target:rule / workspace / publish_request
//   - @提及自动解析:从 content 中提取 @username,转为 mentions 数组
//   - resolve:标记评论已解决(不删除)
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.5

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { BUILTIN_USERS } from './auth';

export type CommentTarget = 'rule' | 'workspace' | 'publish_request';

export interface Comment {
	id: string;
	targetId: string;
	targetType: CommentTarget;
	authorId: string;
	authorName: string;
	content: string;
	/** @提及的 username 数组(从 content 自动解析) */
	mentions: string[];
	createdAt: string;
	resolved: boolean;
}

const STORAGE_KEY = 'evorule-console-cloud:comments';

function loadComments(): Comment[] {
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

export const commentsStore = writable<Comment[]>(loadComments());

commentsStore.subscribe((comments) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
});

function generateId(): string {
	return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 从评论内容解析 @提及。
 * 匹配 @username,只保留 BUILTIN_USERS 中存在的 username。
 */
export function parseMentions(content: string): string[] {
	const matches = content.match(/@(\w+)/g) ?? [];
	const usernames = matches.map((m) => m.slice(1)); // 去掉 @
	const validUsernames = new Set(BUILTIN_USERS.map((u) => u.username));
	return [...new Set(usernames.filter((u) => validUsernames.has(u)))];
}

/**
 * 添加评论(自动解析 @提及)。resolved 始终初始化为 false。
 * @returns 评论 ID
 */
export function addComment(
	c: Omit<Comment, 'id' | 'createdAt' | 'mentions' | 'resolved'>,
): string {
	const id = generateId();
	const mentions = parseMentions(c.content);
	const comment: Comment = {
		...c,
		id,
		mentions,
		createdAt: new Date().toISOString(),
		resolved: false,
	};
	commentsStore.update((list) => [...list, comment]);
	return id;
}

/** 标记评论已解决 */
export function resolveComment(id: string): void {
	commentsStore.update((list) =>
		list.map((c) => (c.id === id ? { ...c, resolved: true } : c)),
	);
}

/** 重新打开评论(resolved → false) */
export function reopenComment(id: string): void {
	commentsStore.update((list) =>
		list.map((c) => (c.id === id ? { ...c, resolved: false } : c)),
	);
}

/** 删除评论 */
export function deleteComment(id: string): void {
	commentsStore.update((list) => list.filter((c) => c.id !== id));
}

/** 按 target 查评论(按时间升序) */
export function getCommentsByTarget(targetId: string): Comment[] {
	return get(commentsStore)
		.filter((c) => c.targetId === targetId)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 按 target 类型查全部 */
export function getCommentsByType(targetType: CommentTarget): Comment[] {
	return get(commentsStore).filter((c) => c.targetType === targetType);
}

/** 查提及某用户的全部评论 */
export function getCommentsMentioning(username: string): Comment[] {
	return get(commentsStore).filter((c) => c.mentions.includes(username));
}

/** 重置(测试用) */
export function resetComments(): void {
	commentsStore.set([]);
}
