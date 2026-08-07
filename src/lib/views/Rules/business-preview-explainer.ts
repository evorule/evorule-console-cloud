// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务预览结构化解释器(v0 新增,决策 §3.5)。
//
// 设计:
//   - 本地计算(无 LLM),100% 确定性
//   - 根据 evorule JSON 的 condition + action 字段拼装"如果 X 则 Y"
//   - 术语高亮:匹配 ifPart/thenPart 中的术语 label / synonyms
//
// 与 LLM 自然语言层的关系:
//   - 结构化层是基础,LLM 层是锦上添花
//   - LLM 不可用时,只显示结构化层(降级方案)
//
// 输入兼容:
//   - 业务视图形状({condition, action, branch})— 表单转换器产出
//   - 内核 transform 数组({transform: [...]})— 内核 rules store 的 content
//   通过 unwrapKernelTransform 统一转业务视图后再解释
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.4

import type { BusinessTerm } from "$lib/stores/business-terms";
import type { StructuredExplanation } from "$lib/stores/business-preview";
import {
  unwrapKernelTransform,
  type BusinessRuleShape,
} from "./kernel-rule-adapter";

/**
 * 生成结构化解释。
 *
 * @param ruleJson evorule JSON 对象(业务视图或内核 transform 格式)
 * @param terms 当前行业激活术语列表(用于高亮)
 * @returns 结构化解释 { ifPart, thenPart, elsePart?, terms }
 */
export function explainStructured(
  ruleJson: object,
  terms: BusinessTerm[],
): StructuredExplanation {
  // 统一为业务视图
  const shape = toBusinessShape(ruleJson);

  // 优先用 branch(多分支规则)
  if (shape.branch && shape.branch.length > 0) {
    return explainBranch(shape.branch, terms);
  }

  // 单条件 + 单动作
  const ifPart = shape.condition
    ? explainCondition(shape.condition)
    : "(无条件)";
  const thenPart = shape.action ? explainAction(shape.action) : "(无动作)";

  return {
    ifPart,
    thenPart,
    terms: collectTerms(`${ifPart} ${thenPart}`, terms),
    templateId: "single-condition-action",
  };
}

/**
 * 把任意 ruleJson(业务视图 or 内核 transform)统一为业务视图形状。
 */
function toBusinessShape(ruleJson: object): BusinessRuleShape {
  const rule = ruleJson as Record<string, unknown>;
  // 已是业务视图(有 condition/action/branch 之一,且无 transform)
  if (
    !rule.transform &&
    (rule.condition || rule.action || rule.branch)
  ) {
    return rule as unknown as BusinessRuleShape;
  }
  // 内核 transform 格式 → unwrap
  if (rule.transform) {
    return unwrapKernelTransform(rule as never);
  }
  // 空对象
  return {};
}

function explainBranch(
  branch: NonNullable<BusinessRuleShape["branch"]>,
  terms: BusinessTerm[],
): StructuredExplanation {
  // 简化版:取第一个分支作为 ifPart,最后一个分支(all[])作为兜底 elsePart
  const first = branch[0];
  const last = branch[branch.length - 1];

  const ifPart = first?.condition
    ? explainCondition(first.condition)
    : "(默认)";
  const thenPart = first?.action ? explainAction(first.action) : "(无动作)";

  // 检查 last 是否为兜底(无 condition 或 condition.domain 缺失)
  const lastCond = last?.condition;
  const isFallback =
    !lastCond ||
    !lastCond.domain ||
    lastCond.domain === "all";
  const elsePart = isFallback && last?.action
    ? explainAction(last.action)
    : undefined;

  return {
    ifPart,
    thenPart,
    elsePart,
    terms: collectTerms(`${ifPart} ${thenPart} ${elsePart ?? ""}`, terms),
    templateId: "branch-with-fallback",
  };
}

function explainCondition(condition: BusinessRuleShape["condition"]): string {
  if (!condition) return "(无条件)";
  const domain = condition.domain;
  const value = condition.value;
  const path = condition.path;

  // 提取 path 的业务可读名(去掉 __exec__.payload. 前缀)
  const fieldLabel = path
    ? path.replace(/^__exec__\.payload\./, "")
    : "字段";

  switch (domain) {
    case "eq":
      return `${fieldLabel} 等于 ${String(value)}`;
    case "lt":
      return `${fieldLabel} 小于 ${value}`;
    case "gt":
      return `${fieldLabel} 大于 ${value}`;
    case "exists":
      return path
        ? `${fieldLabel} 存在`
        : `满足条件(${String(value ?? "")})`;
    case "instruction":
      return `执行指令 ${String(value)}`;
    case "all":
      return "所有条件满足";
    case "not":
      return `不满足 ${String(value ?? "")}`;
    default:
      if (typeof console !== "undefined") {
        console.warn(`[explainStructured] 未知条件 domain: ${domain}`);
      }
      return `(未知条件类型: ${domain ?? "无"})`;
  }
}

function explainAction(action: BusinessRuleShape["action"]): string {
  if (!action) return "(无动作)";
  const meta = action.meta;
  const params = action.params ?? {};
  const type = action.type;

  // meta 指令:set / push / branch / io_request
  if (meta === "set") {
    const key = params.key ?? params.attr;
    const value = params.value;
    return `设置 ${String(key)} = ${String(value)}`;
  }
  if (meta === "push") {
    const key = params.key ?? params.attr;
    return `追加到 ${String(key)}`;
  }
  if (meta === "branch") {
    return "(分支,详见结构化展示)";
  }
  if (meta === "io_request") {
    const prompt = params.prompt;
    if (prompt) return `调用外部接口:${String(prompt)}`;
    const url = params.url;
    return url ? `调用外部接口 ${String(url)}` : "调用外部接口";
  }

  // 业务动作语义(用术语翻译)
  const role = params.role;
  const channel = params.channel;
  if (role) {
    const channelText = channel ? `(通过 ${String(channel)})` : "";
    return `通知 ${String(role)} ${channelText}`;
  }
  if (params.evidenceType) {
    return `要求证据类型:${String(params.evidenceType)}`;
  }
  if (params.regulator) {
    return `报送监管机构:${String(params.regulator)}`;
  }

  return type ? `执行动作:${type}` : "执行动作(未知)";
}

/**
 * 在解释文本中匹配术语,返回命中的术语列表(用于 UI 高亮)。
 */
function collectTerms(
  text: string,
  terms: BusinessTerm[],
): Array<{ termId: string; label: string; matchedText: string }> {
  const result: Array<{ termId: string; label: string; matchedText: string }> =
    [];

  for (const term of terms) {
    const candidates = [term.label, ...term.synonyms];
    for (const cand of candidates) {
      if (text.includes(cand)) {
        result.push({
          termId: term.id,
          label: term.label,
          matchedText: cand,
        });
        break; // 每个术语只匹配一次
      }
    }
  }

  return result;
}
