// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 桥接单测:本地装配 → 治理域 rule_set 注册
//
// 运行: npx vitest run src/lib/governance/__tests__/bridge.test.ts
//
// 覆盖:
//   - 正常链:装配物化 → 建集体 → 逐条入条体（entry_id/version/rule_body）
//   - 参数覆盖物化进 rule_body
//   - 缺失规则跳过并如实报告,不阻断
//   - 入条 4xx 中止 + 已入条数报告（数据集保留可重入）
//   - 建集失败中止（governanceDatasetId=null）
//   - dataset_id 派生:本地 id 消毒 + 时间尾快照语义

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
	bridgeDatasetToGovernance,
	deriveGovernanceDatasetId,
	type BridgeBackend,
} from '../bridge';
import { rules } from '$lib/kernel';
import type { Dataset } from '$lib/stores/dataset-types';
import type { Rule } from '$lib/kernel';
import type { CreateDatasetRequest, AddEntryRequest } from '../types';

function mkRule(id: string, content: object): Rule {
	return {
		id,
		workspaceId: 'ws-test',
		name: `rule-${id}`,
		state: 'active',
		currentVersionId: 'v1',
		content: JSON.stringify(content)
	} as unknown as Rule;
}

function mkDataset(overrides?: Partial<Dataset>): Dataset {
	return {
		id: 'dataset_local1_abc',
		name: '心内科核心规则集',
		description: '测试装配',
		ruleIds: ['r1', 'r2'],
		paramOverrides: [],
		tagIds: [],
		categoryId: null,
		status: 'draft',
		lastTestedAt: null,
		publishedVersion: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	} as unknown as Dataset;
}

describe('deriveGovernanceDatasetId', () => {
	test('本地 id 消毒 + 时间尾', () => {
		const id = deriveGovernanceDatasetId('dataset_local1_abc');
		expect(id).toMatch(/^ds-local-dataset_local1_abc-[0-9a-z]+$/);
	});
});

describe('bridgeDatasetToGovernance', () => {
	let created: CreateDatasetRequest[];
	let entries: { datasetId: string; req: AddEntryRequest }[];

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
		created = [];
		entries = [];
		rules.set([mkRule('r1', { type: 'set', params: { threshold: 1 } }), mkRule('r2', { type: 'noop' })]);
	});

	function mkBackend(failEntryAt?: (i: number) => boolean): BridgeBackend {
		return {
			createDataset: vi.fn(async (req: CreateDatasetRequest) => {
				created.push(req);
				return { dataset_id: req.dataset_id } as never;
			}),
			addEntry: vi.fn(async (datasetId: string, req: AddEntryRequest) => {
				const i = entries.filter((e) => e.datasetId === datasetId).length;
				if (failEntryAt?.(i)) throw new Error('403 forbidden');
				entries.push({ datasetId, req });
				return {} as never;
			})
		};
	}

	test('正常链:建集体+逐条入条体(entry_id/version/rule_body 物化)', async () => {
		const backend = mkBackend();
		const result = await bridgeDatasetToGovernance(mkDataset(), backend);

		expect(result.aborted).toBe(false);
		expect(result.entriesAdded).toBe(2);
		expect(created).toHaveLength(1);
		expect(created[0].dataset_id).toMatch(/^ds-local-dataset_local1_abc-/);
		expect(created[0].name).toBe('[装配] 心内科核心规则集');
		// 入条体:rule_body 为物化 JSON 对象(非字符串)
		expect(entries[0].req.entry_id).toBe('r1');
		expect(entries[0].req.version).toBe(1);
		expect(entries[0].req.rule_body).toEqual({
			type: 'set',
			params: { threshold: 1 }
		});
	});

	test('参数覆盖物化进 rule_body', async () => {
		const ds = mkDataset({
			paramOverrides: [
				{ ruleId: 'r1', patch: [{ op: 'replace', path: '/params/threshold', value: 99 }] }
			]
		});
		await bridgeDatasetToGovernance(ds, mkBackend());
		expect(entries[0].req.rule_body).toEqual({
			type: 'set',
			params: { threshold: 99 }
		});
	});

	test('缺失规则跳过并如实报告,不阻断', async () => {
		const ds = mkDataset({ ruleIds: ['r1', 'ghost', 'r2'] });
		const result = await bridgeDatasetToGovernance(ds, mkBackend());
		expect(result.aborted).toBe(false);
		expect(result.skippedRuleIds).toEqual(['ghost']);
		expect(result.plannedRuleIds).toEqual(['r1', 'r2']);
		expect(result.entriesAdded).toBe(2);
	});

	test('入条 4xx 中止+已入条数报告,数据集保留(重入可补)', async () => {
		const backend = mkBackend((i) => i === 1); // 第 2 条失败
		const result = await bridgeDatasetToGovernance(mkDataset(), backend);
		expect(result.aborted).toBe(true);
		expect(result.entriesAdded).toBe(1);
		expect(result.error).toContain('r2');
		expect(result.error).toContain('1/2');
		expect(result.governanceDatasetId).not.toBeNull();
	});

	test('建集失败中止,governanceDatasetId=null', async () => {
		const backend: BridgeBackend = {
			createDataset: vi.fn(async () => {
				throw new Error('409 already exists');
			}),
			addEntry: vi.fn(async () => ({}))
		};
		const result = await bridgeDatasetToGovernance(mkDataset(), backend);
		expect(result.aborted).toBe(true);
		expect(result.governanceDatasetId).toBeNull();
		expect(result.error).toContain('建集失败');
	});
});
