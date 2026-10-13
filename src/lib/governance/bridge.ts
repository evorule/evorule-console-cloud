// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 桥接：本地数据集装配 → 治理域 rule_set 数据集注册（06 号方案 B1）。
//
// 语义:
//   - 一次桥接 = 一个治理域快照数据集（dataset_id 带时间尾,可重复桥接不冲突）
//   - ruleIds 逐条物化(assembleRuleset:规则内容+JSON Patch 参数覆盖)后作为
//     entry 入条,rule_body 零转译原样上传(evorule-bundle SSOT 不受扰)
//   - 止步于 Draft 态:生命周期推进(Candidate/Active/Published)全部由人在
//     /governance 页按既有闸操作,本模块不代推任何跃迁（约束红线）
//   - 失败可见:任一条入条 4xx 即中止,报告已入条数;重入幂等靠 entry_id
//
// 关联:05 号尽调报告(衔接条件核查/逐跳闸链) + 06 号施工方案(字段映射表)

import {
	assembleRuleset,
} from '$lib/dataset/assemble-ruleset';
import type { Dataset } from '$lib/stores/dataset-types';
import type {
	AddEntryRequest,
	CreateDatasetRequest,
	GovernanceDataset,
} from './types';

/** 桥接所需的最小后端面(GovernanceBackend 结构性满足,测试可注入 mock) */
export interface BridgeBackend {
	createDataset(req: CreateDatasetRequest): Promise<GovernanceDataset>;
	addEntry(datasetId: string, req: AddEntryRequest): Promise<unknown>;
}

export interface BridgeResult {
	/** 治理域数据集 ID(中止时为已建集 ID 或 null=建集即败) */
	governanceDatasetId: string | null;
	/** 成功入条数 */
	entriesAdded: number;
	/** 计划入条的规则 ID(剔除装配跳过后,顺序与入条一致) */
	plannedRuleIds: string[];
	/** 装配时跳过的规则 ID(规则库不存在/内容未加载) */
	skippedRuleIds: string[];
	/** 应用了参数覆盖的规则 ID */
	overriddenRuleIds: string[];
	/** false = 全部入条成功;true = 中途失败(error 给出原因与已入条数) */
	aborted: boolean;
	error?: string;
}

/** 治理域 dataset_id:本地 id 派生 + 时间尾(快照语义,重复桥接不冲突) */
export function deriveGovernanceDatasetId(localId: string): string {
	const safe = localId.replace(/[^a-zA-Z0-9_-]/g, '');
	return `ds-local-${safe}-${Date.now().toString(36)}`;
}

/**
 * 把本地数据集装配注册为治理域 rule_set 数据集。
 *
 * 步骤:装配物化 → 建集(Draft) → 逐规则入条。
 * 止步于 Draft;生命周期推进由人在 /governance 页按既有闸操作。
 *
 * @param dataset 本地数据集(装配语义:ruleIds + paramOverrides)
 * @param backend 治理后端(须已登录 18081;角色不足时 server 403 原样上抛)
 */
export async function bridgeDatasetToGovernance(
	dataset: Dataset,
	backend: BridgeBackend
): Promise<BridgeResult> {
	// 1. 装配物化(缺失规则跳过并记录;参数覆盖应用进 rule_body)
	const assembled = assembleRuleset(dataset);
	const plannedRuleIds = dataset.ruleIds.filter(
		(id) => !assembled.skippedRuleIds.includes(id)
	);

	const result: BridgeResult = {
		governanceDatasetId: null,
		entriesAdded: 0,
		plannedRuleIds,
		skippedRuleIds: [...assembled.skippedRuleIds],
		overriddenRuleIds: [...assembled.overriddenRuleIds],
		aborted: false
	};

	// 2. 建集(Draft;dataset_kind 不传=后端缺省 rule_set;tags 不映射防脏数据)
	const governanceDatasetId = deriveGovernanceDatasetId(dataset.id);
	const createReq: CreateDatasetRequest = {
		dataset_id: governanceDatasetId,
		name: `[装配] ${dataset.name}`,
		description: `桥接自本地数据集 ${dataset.id}${dataset.description ? `:${dataset.description}` : ''}`
	};
	try {
		await backend.createDataset(createReq);
		result.governanceDatasetId = governanceDatasetId;
	} catch (e) {
		result.aborted = true;
		result.error = `建集失败: ${(e as Error).message}`;
		return result;
	}

	// 3. 逐规则入条(entry_id=本地规则 id 溯源;version 从 1 递增)
	for (let i = 0; i < plannedRuleIds.length; i++) {
		const entryId = plannedRuleIds[i];
		const req: AddEntryRequest = {
			entry_id: entryId,
			version: 1,
			rule_body: JSON.parse(assembled.ruleset[i])
		};
		try {
			await backend.addEntry(governanceDatasetId, req);
			result.entriesAdded += 1;
		} catch (e) {
			result.aborted = true;
			result.error = `入条中止于 ${entryId}(已入 ${result.entriesAdded}/${plannedRuleIds.length}): ${(e as Error).message}`;
			return result;
		}
	}

	return result;
}
