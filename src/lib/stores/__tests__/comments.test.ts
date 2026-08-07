// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P08 comments 单测 — @提及解析 + resolve + 按 target 查询
//
// 运行: npx vitest run src/lib/stores/__tests__/comments.test.ts

import { describe, test, expect, beforeEach } from 'vitest';
import { get as storeGet } from 'svelte/store';
import {
	commentsStore,
	addComment,
	resolveComment,
	reopenComment,
	deleteComment,
	getCommentsByTarget,
	getCommentsByType,
	getCommentsMentioning,
	parseMentions,
	resetComments,
} from '../comments';

beforeEach(() => {
	resetComments();
});

// ============================================================================
// 1. parseMentions(@提及解析)
// ============================================================================

describe('P08 parseMentions', () => {
	test('解析 @admin @lead 等有效 username', () => {
		const mentions = parseMentions('请 @admin 审核这条规则,@lead 也看一下');
		expect(mentions).toContain('admin');
		expect(mentions).toContain('lead');
		expect(mentions).toHaveLength(2);
	});

	test('忽略不存在的 username', () => {
		const mentions = parseMentions('@admin 请查看,@nonexistent 无效');
		expect(mentions).toEqual(['admin']);
	});

	test('去重:同一 username 多次提及只保留一次', () => {
		const mentions = parseMentions('@admin @admin @admin');
		expect(mentions).toEqual(['admin']);
	});

	test('无提及返回空数组', () => {
		expect(parseMentions('这条评论没有提及任何人')).toEqual([]);
	});

	test('空字符串返回空数组', () => {
		expect(parseMentions('')).toEqual([]);
	});

	test('连续提及:多 username 无空格', () => {
		const mentions = parseMentions('@admin@lead@doctor');
		expect(mentions).toEqual(['admin', 'lead', 'doctor']);
	});
});

// ============================================================================
// 2. addComment
// ============================================================================

describe('P08 addComment', () => {
	test('添加评论:自动生成 ID + createdAt + mentions', () => {
		const id = addComment({
			targetId: 'rule-1',
			targetType: 'rule',
			authorId: 'u-doctor',
			authorName: '王医生',
			content: '这条规则需要 @admin 审核',
		});

		expect(id).toMatch(/^c-\d+-[a-z0-9]+$/);

		const comments = storeGet(commentsStore);
		expect(comments).toHaveLength(1);
		expect(comments[0].id).toBe(id);
		expect(comments[0].mentions).toEqual(['admin']);
		expect(comments[0].createdAt).toBeTruthy();
		expect(comments[0].resolved).toBe(false);
	});

	test('添加多条评论:按时间正序', () => {
		addComment({
			targetId: 'rule-1',
			targetType: 'rule',
			authorId: 'u-doctor',
			authorName: '王医生',
			content: '第一条',
		});
		addComment({
			targetId: 'rule-1',
			targetType: 'rule',
			authorId: 'u-lead',
			authorName: '李科长',
			content: '第二条',
		});

		const list = getCommentsByTarget('rule-1');
		expect(list).toHaveLength(2);
		// createdAt 字符串比较(ISO 时间正序)
		expect(list[0].content).toBe('第一条');
		expect(list[1].content).toBe('第二条');
	});
});

// ============================================================================
// 3. resolve / reopen / delete
// ============================================================================

describe('P08 resolveComment / reopenComment', () => {
	test('resolveComment 标记 resolved=true', () => {
		const id = addComment({
			targetId: 'r1',
			targetType: 'rule',
			authorId: 'u-doctor',
			authorName: '王医生',
			content: '待审核',
		});
		resolveComment(id);
		expect(storeGet(commentsStore).find((c) => c.id === id)?.resolved).toBe(
			true,
		);
	});

	test('reopenComment 标记 resolved=false', () => {
		const id = addComment({
			targetId: 'r1',
			targetType: 'rule',
			authorId: 'u-doctor',
			authorName: '王医生',
			content: '待审核',
		});
		resolveComment(id);
		reopenComment(id);
		expect(storeGet(commentsStore).find((c) => c.id === id)?.resolved).toBe(
			false,
		);
	});

	test('deleteComment 删除指定评论', () => {
		const id = addComment({
			targetId: 'r1',
			targetType: 'rule',
			authorId: 'u-doctor',
			authorName: '王医生',
			content: '待删除',
		});
		deleteComment(id);
		expect(storeGet(commentsStore)).toHaveLength(0);
	});
});

// ============================================================================
// 4. 查询
// ============================================================================

describe('P08 查询', () => {
	beforeEach(() => {
		addComment({
			targetId: 'rule-1',
			targetType: 'rule',
			authorId: 'u-doctor',
			authorName: '王医生',
			content: '规则评论',
		});
		addComment({
			targetId: 'rule-2',
			targetType: 'rule',
			authorId: 'u-lead',
			authorName: '李科长',
			content: '另一条规则评论 @admin',
		});
		addComment({
			targetId: 'pr-1',
			targetType: 'publish_request',
			authorId: 'u-admin',
			authorName: '张主任',
			content: '发布请求评论',
		});
	});

	test('getCommentsByTarget 按 targetId 查', () => {
		expect(getCommentsByTarget('rule-1')).toHaveLength(1);
		expect(getCommentsByTarget('rule-2')).toHaveLength(1);
		expect(getCommentsByTarget('rule-1')[0].content).toBe('规则评论');
	});

	test('getCommentsByType 按 targetType 查', () => {
		expect(getCommentsByType('rule')).toHaveLength(2);
		expect(getCommentsByType('publish_request')).toHaveLength(1);
		expect(getCommentsByType('workspace')).toHaveLength(0);
	});

	test('getCommentsMentioning 查提及某用户的评论', () => {
		const mentioned = getCommentsMentioning('admin');
		expect(mentioned).toHaveLength(1);
		expect(mentioned[0].targetId).toBe('rule-2');
	});

	test('getCommentsMentioning 无提及返回空', () => {
		expect(getCommentsMentioning('doctor')).toHaveLength(0);
	});
});
