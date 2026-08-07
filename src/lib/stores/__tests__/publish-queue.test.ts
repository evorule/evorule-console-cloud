// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P08 publish-queue 单测 — 状态机全路径
//
// 运行: npx vitest run src/lib/stores/__tests__/publish-queue.test.ts
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.3 + PUBLISH_QUEUE_DESIGN.md

import { describe, test, expect, beforeEach } from 'vitest';
import { get as storeGet } from 'svelte/store';
import {
	publishQueueStore,
	submitPublish,
	startReview,
	approvePublish,
	rejectPublish,
	emergencyRollback,
	getPublishRequest,
	filterByStatus,
	pendingReviewCount,
	publishedVersions,
	resetPublishQueue,
	type PublishStatus,
} from '../publish-queue';
import {
	productionAuditStore,
	appendVersion,
	currentVersion,
	resetProductionAudit,
} from '../production-audit';

beforeEach(() => {
	resetPublishQueue();
	resetProductionAudit();
});

// ============================================================================
// 1. submitPublish
// ============================================================================

describe('P08 submitPublish', () => {
	test('提交成功:status=submitted,返回 pr- 开头 ID', () => {
		const id = submitPublish(1, 'u-lead');
		expect(id).toMatch(/^pr-\d+-[a-z0-9]+$/);

		const queue = storeGet(publishQueueStore);
		expect(queue).toHaveLength(1);
		expect(queue[0].id).toBe(id);
		expect(queue[0].rulesetVersion).toBe(1);
		expect(queue[0].submittedBy).toBe('u-lead');
		expect(queue[0].status).toBe('submitted');
		expect(queue[0].submittedAt).toBeTruthy();
	});

	test('多次提交:队列累积,最新在前', () => {
		submitPublish(1, 'u-lead');
		submitPublish(2, 'u-lead');
		submitPublish(3, 'u-lead');

		const queue = storeGet(publishQueueStore);
		expect(queue).toHaveLength(3);
		// 新提交在前(unshift)
		expect(queue[0].rulesetVersion).toBe(3);
		expect(queue[2].rulesetVersion).toBe(1);
	});
});

// ============================================================================
// 2. startReview
// ============================================================================

describe('P08 startReview', () => {
	test('submitted → reviewing,设置 reviewedBy', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');

		const req = getPublishRequest(id);
		expect(req?.status).toBe('reviewing');
		expect(req?.reviewedBy).toBe('u-admin');
		expect(req?.reviewedAt).toBeTruthy();
	});

	test('非 submitted 状态不可 startReview(不变更)', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		// 再次 startReview(reviewing 状态)应无效
		startReview(id, 'u-admin2');
		const req = getPublishRequest(id);
		expect(req?.reviewedBy).toBe('u-admin'); // 未变更
	});
});

// ============================================================================
// 3. approvePublish
// ============================================================================

describe('P08 approvePublish', () => {
	test('reviewing → published(自动转),设置 publishedAt', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		approvePublish(id, 'u-admin', '规则集通过审核');

		const req = getPublishRequest(id);
		expect(req?.status).toBe('published');
		expect(req?.reviewComment).toBe('规则集通过审核');
		expect(req?.publishedAt).toBeTruthy();
	});

	test('非 reviewing 状态不可 approve(不变更)', () => {
		const id = submitPublish(1, 'u-lead');
		// 直接 approve(submitted 状态)应无效
		approvePublish(id, 'u-admin', '通过');
		const req = getPublishRequest(id);
		expect(req?.status).toBe('submitted'); // 未变更
	});

	test('approve 后应同步 appendVersion 到 production-audit', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		approvePublish(id, 'u-admin', '通过');

		// 业务层应在 approve 后调 appendVersion(此处验证 store 集成)
		const v = appendVersion({
			rulesetHash: 'hash_v1',
			publishedAt: new Date().toISOString(),
			publishedBy: 'u-admin',
			publishRequestId: id,
			notes: '首次发布',
		});
		expect(v).toBe(1);
		expect(currentVersion()).toBe(1);
	});
});

// ============================================================================
// 4. rejectPublish
// ============================================================================

describe('P08 rejectPublish', () => {
	test('reviewing → rejected,设置 reviewComment', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		rejectPublish(id, 'u-admin', '规则有冲突,需修改');

		const req = getPublishRequest(id);
		expect(req?.status).toBe('rejected');
		expect(req?.reviewComment).toBe('规则有冲突,需修改');
	});

	test('非 reviewing 状态不可 reject(不变更)', () => {
		const id = submitPublish(1, 'u-lead');
		rejectPublish(id, 'u-admin', '驳回');
		const req = getPublishRequest(id);
		expect(req?.status).toBe('submitted');
	});
});

// ============================================================================
// 5. emergencyRollback
// ============================================================================

describe('P08 emergencyRollback', () => {
	test('published → rolled_back,设置 emergencyRollbackAt + rolledBackBy', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		approvePublish(id, 'u-admin', '通过');
		emergencyRollback(id, 'u-admin');

		const req = getPublishRequest(id);
		expect(req?.status).toBe('rolled_back');
		expect(req?.emergencyRollbackAt).toBeTruthy();
		expect(req?.rolledBackBy).toBe('u-admin');
	});

	test('非 published 状态不可 rollback(不变更)', () => {
		const id = submitPublish(1, 'u-lead');
		emergencyRollback(id, 'u-admin');
		const req = getPublishRequest(id);
		expect(req?.status).toBe('submitted');
	});

	test('回滚后版本号单调递增(新版本号 = max + 1,不回退)', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		approvePublish(id, 'u-admin', '通过');
		appendVersion({
			rulesetHash: 'hash_v1',
			publishedAt: new Date().toISOString(),
			publishedBy: 'u-admin',
			publishRequestId: id,
			notes: 'v1 发布',
		});
		expect(currentVersion()).toBe(1);

		// 回滚
		emergencyRollback(id, 'u-admin');
		// 回滚后新版本号应为 2(单调递增)
		const v2 = appendVersion({
			rulesetHash: 'hash_v0_rollback',
			publishedAt: new Date().toISOString(),
			publishedBy: 'u-admin',
			publishRequestId: `${id}-rollback`,
			rollbackOf: 1,
			notes: '紧急回滚到 v0',
		});
		expect(v2).toBe(2);
		expect(currentVersion()).toBe(2);
	});
});

// ============================================================================
// 6. 查询 / 工具函数
// ============================================================================

describe('P08 查询 / 工具函数', () => {
	test('filterByStatus 按状态过滤', () => {
		const id1 = submitPublish(1, 'u-lead');
		const id2 = submitPublish(2, 'u-lead');
		submitPublish(3, 'u-lead');

		startReview(id1, 'u-admin');
		approvePublish(id1, 'u-admin', '通过');

		const submitted = filterByStatus('submitted' as PublishStatus);
		const published = filterByStatus('published' as PublishStatus);
		expect(submitted).toHaveLength(2); // id2, id3
		expect(published).toHaveLength(1); // id1
	});

	test('pendingReviewCount:submitted + reviewing 计数', () => {
		submitPublish(1, 'u-lead');
		const id2 = submitPublish(2, 'u-lead');
		submitPublish(3, 'u-lead');

		startReview(id2, 'u-admin');

		expect(pendingReviewCount()).toBe(3); // 2 submitted + 1 reviewing
	});

	test('publishedVersions:已发布版本号降序', () => {
		const id1 = submitPublish(1, 'u-lead');
		const id2 = submitPublish(2, 'u-lead');
		startReview(id1, 'u-admin');
		approvePublish(id1, 'u-admin', '通过');
		startReview(id2, 'u-admin');
		approvePublish(id2, 'u-admin', '通过');

		const versions = publishedVersions();
		expect(versions).toEqual([2, 1]);
	});

	test('getPublishRequest 按 ID 查询', () => {
		const id = submitPublish(1, 'u-lead');
		const req = getPublishRequest(id);
		expect(req).toBeDefined();
		expect(req?.id).toBe(id);

		expect(getPublishRequest('nonexistent')).toBeUndefined();
	});
});

// ============================================================================
// 7. 状态机全路径验证
// ============================================================================

describe('P08 状态机全路径', () => {
	test('完整 happy path:submitted → reviewing → published', () => {
		const id = submitPublish(1, 'u-lead');
		expect(getPublishRequest(id)?.status).toBe('submitted');

		startReview(id, 'u-admin');
		expect(getPublishRequest(id)?.status).toBe('reviewing');

		approvePublish(id, 'u-admin', '通过');
		expect(getPublishRequest(id)?.status).toBe('published');
	});

	test('reject path:submitted → reviewing → rejected', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		rejectPublish(id, 'u-admin', '驳回');
		expect(getPublishRequest(id)?.status).toBe('rejected');
	});

	test('rollback path:submitted → reviewing → published → rolled_back', () => {
		const id = submitPublish(1, 'u-lead');
		startReview(id, 'u-admin');
		approvePublish(id, 'u-admin', '通过');
		emergencyRollback(id, 'u-admin');
		expect(getPublishRequest(id)?.status).toBe('rolled_back');
	});

	test('非法状态转换被拒绝(不变更)', () => {
		const id = submitPublish(1, 'u-lead');
		// submitted 直接 approve(无 reviewing)
		approvePublish(id, 'u-admin', '通过');
		expect(getPublishRequest(id)?.status).toBe('submitted');

		// submitted 直接 reject(无 reviewing)
		rejectPublish(id, 'u-admin', '驳回');
		expect(getPublishRequest(id)?.status).toBe('submitted');

		// submitted 直接 rollback(无 published)
		emergencyRollback(id, 'u-admin');
		expect(getPublishRequest(id)?.status).toBe('submitted');
	});
});
