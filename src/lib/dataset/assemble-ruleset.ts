// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 数据集运行规则集组装(应用参数覆盖后的规则 JSON 字符串数组)。
// 用于推入 Reactor(L3 沙盒测试 or L1 发布)。
//
// 关联设计:P03_DATASET_DESIGN.md §8.2 + §7.2/§7.3(测试/发布流)
//
// 设计要点:
// - 数据集只存 ruleIds,不复制规则内容(单一数据源,规则更新自动生效)
// - 运行时用 getAllRules() 拿到最新规则,再 applyJsonPatch 应用参数覆盖
// - 缺失规则跳过并告警(不阻断组装)

import { getAllRules } from "$lib/kernel";
import type { Rule } from "$lib/kernel";
import type { Dataset } from "$lib/stores/dataset-types";
import { applyJsonPatch } from "$lib/utils/json-patch";

/** 组装结果(规则 JSON 数组 + 跳过的缺失规则 ID) */
export interface AssembleResult {
  /** 应用参数覆盖后的规则 JSON 字符串数组(顺序与 dataset.ruleIds 一致,缺失规则被跳过) */
  ruleset: string[];
  /** 组装时跳过的规则 ID(规则库中不存在) */
  skippedRuleIds: string[];
  /** 组装时应用了参数覆盖的规则 ID */
  overriddenRuleIds: string[];
}

/**
 * 组装数据集的运行规则集。
 *
 * 对每条 ruleId:
 * 1. 从内核 rules store 查找规则(getAllRules,非响应式)
 * 2. 若存在 paramOverride,应用 JSON Patch 到 rule.content
 * 3. 推入结果数组;缺失规则跳过并记录
 *
 * @param dataset 数据集
 * @returns AssembleResult
 */
export function assembleRuleset(dataset: Dataset): AssembleResult {
  const allRules = getAllRules();
  const ruleset: string[] = [];
  const skippedRuleIds: string[] = [];
  const overriddenRuleIds: string[] = [];

  for (const ruleId of dataset.ruleIds) {
    const rule: Rule | undefined = allRules.find((r) => r.id === ruleId);
    if (!rule) {
      console.warn(
        `[assembleRuleset] 数据集 ${dataset.id}: 规则 ${ruleId} 不存在,已跳过`,
      );
      skippedRuleIds.push(ruleId);
      continue;
    }

    const override = dataset.paramOverrides.find((p) => p.ruleId === ruleId);
    if (override && override.patch.length > 0) {
      if (rule.content === undefined) {
        console.warn(
          `[assembleRuleset] 数据集 ${dataset.id}: 规则 ${ruleId} 内容未加载,已跳过`,
        );
        skippedRuleIds.push(ruleId);
        continue;
      }
      const patched = applyJsonPatch(rule.content, override.patch);
      ruleset.push(patched);
      overriddenRuleIds.push(ruleId);
    } else {
      if (rule.content === undefined) {
        console.warn(
          `[assembleRuleset] 数据集 ${dataset.id}: 规则 ${ruleId} 内容未加载,已跳过`,
        );
        skippedRuleIds.push(ruleId);
        continue;
      }
      ruleset.push(rule.content);
    }
  }

  return { ruleset, skippedRuleIds, overriddenRuleIds };
}

/**
 * 仅组装指定规则(单条,用于影响预览 P04)。
 * 若规则不存在或无覆盖,返回原 content。
 */
export function assembleSingleRule(
  dataset: Dataset,
  ruleId: string,
): string | null {
  const allRules = getAllRules();
  const rule = allRules.find((r) => r.id === ruleId);
  if (!rule) return null;

  const override = dataset.paramOverrides.find((p) => p.ruleId === ruleId);
  if (override && override.patch.length > 0) {
    if (rule.content === undefined) return null;
    return applyJsonPatch(rule.content, override.patch);
  }
  return rule.content ?? null;
}
