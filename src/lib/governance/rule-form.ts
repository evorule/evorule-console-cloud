// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理页规则表单辅助(纯函数,UV-058 W2.2)
//
// 职责(43 号方案 W2.2):
//   - localSaveGate:保存分层第 1 层(本地 error 阻断,不发起网络请求)
//   - formatIssues:校验面板/entryError 的 error/warning 明细格式化
//   - summarizeTransformSteps:transform 步骤只读摘要预览(合法 JSON 后,
//     textarea 下显示"① branch[...] → ② set ..."单行摘要;不做双向编辑)
//
// 权威口径:
//   - 校验 = RuleValidator(_shared/v1.0.json 对齐版);本层只是展示/门控编排,不复造校验
//   - transform 归一化 = ruleValidator.extractTransforms(单一权威导出)
//   - 本地过 ≠ 权威过:server validateRules(F5 链)仍在保存第 2 层执行,失败明细照透

import {
  RuleValidator,
  extractTransforms,
  type ValidationIssue
} from '$lib/kernel/validators/ruleValidator';

/** 单条 transform 步骤摘要(只读预览模型) */
export interface TransformStepSummary {
  /** 序号(1-based,展示用) */
  index: number;
  /** 单行可读摘要 */
  text: string;
}

/** 保存分层第 1 层:本地门控结果 */
export interface LocalSaveGate {
  /** true = 存在 error,阻断保存(不发起网络请求) */
  blocked: boolean;
  /** 阻断时的明细(多行,含 gate/path/message) */
  message?: string;
}

/** 校验问题明细格式化(面板黄字/entryError 共用) */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((i) => `[${i.gate}]${i.path ? ` ${i.path}:` : ':'} ${i.message}`)
    .join('\n');
}

/**
 * 保存分层第 1 层(43 号方案 W2.2):本地 error 阻断。
 * 空 rule_body 由调用方先行必填校验;G1(JSON 非法)与所有 error 均阻断。
 * warning 不阻断(G3 双路径/G6 兜底为建议级,面板黄字提示)。
 */
export function localSaveGate(ruleBody: string): LocalSaveGate {
  const r = RuleValidator.validate(ruleBody);
  if (r.valid) return { blocked: false };
  return {
    blocked: true,
    message: `本地校验未通过(未发起网络请求,共 ${r.errors.length} 项 error):\n${formatIssues(r.errors)}`
  };
}

/** 摘要文本截断(超长 value/路径只保留前 40 字符,预览用途) */
function trunc(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 域(domain)单行摘要 */
function summarizeDomain(d: unknown, depth = 0): string {
  if (typeof d === 'string') return d; // 动态域(__ 路径引用)
  if (!d || typeof d !== 'object') return '?';
  const o = d as Record<string, unknown>;
  const t = typeof o.type === 'string' ? o.type : '?';
  switch (t) {
    case 'eq':
      return `eq ${String(o.path)}=${trunc(JSON.stringify(o.value))}`;
    case 'lt':
      return `lt ${String(o.path)}<${trunc(JSON.stringify(o.value))}`;
    case 'exists':
      return `exists ${String(o.path)}`;
    case 'instruction':
      return `instruction=${String(o.instruction_type)}`;
    case 'has_fields':
      return `has_fields ${String(o.path)}(${(Array.isArray(o.fields) ? o.fields : []).join(',')})`;
    case 'all':
      return `all[${Array.isArray(o.inner) ? o.inner.length : 0} 域]`;
    case 'not': {
      const first = Array.isArray(o.inner) ? o.inner[0] : undefined;
      return depth < 2 ? `not[${summarizeDomain(first, depth + 1)}]` : 'not[…]';
    }
    default:
      return t;
  }
}

/** 单条 transform 步骤单行摘要 */
function summarizeStep(step: unknown): string {
  if (!step || typeof step !== 'object') return '(非法步骤)';
  const o = step as Record<string, unknown>;
  const p = o.params && typeof o.params === 'object' ? (o.params as Record<string, unknown>) : {};
  switch (o.type) {
    case 'branch': {
      // 兜底规则(branch + all(inner:[]))显式标注,引导 G6 最佳实践
      const d = p.domain as Record<string, unknown> | undefined;
      if (d && d.type === 'all' && Array.isArray(d.inner) && d.inner.length === 0) {
        return '兜底规则 all(inner:[]) — 未匹配指令走此路径';
      }
      const t = Array.isArray(p.on_true) ? p.on_true.length : 0;
      const f = Array.isArray(p.on_false) ? p.on_false.length : 0;
      return `branch[${summarizeDomain(p.domain)}] → 真${t}步/假${f}步`;
    }
    case 'set':
      return `set ${String(p.attr)} ${String(p.operation ?? 'set')} ${trunc(JSON.stringify(p.value))}`;
    case 'push':
      return `push ${Array.isArray(p.instructions) ? p.instructions.length : '?'} 条指令`;
    case 'io_request':
      return `io_request(${String(p.io_type ?? '?')})`;
    case 'collect':
      return `collect ${String(p.from)} 每项执行模板`;
    case 'merge':
      return `merge 消息源=${String(p.messages)}`;
    default:
      return `${String(o.type)}(未知指令)`;
  }
}

/**
 * transform 步骤只读摘要预览(43 号方案 W2.2 可选增强,用户已批"做")。
 * 输入为 rule_body 原文;JSON 非法或提取不到 transform → null(不显示预览)。
 * 仅作可读性辅助:预览与校验相互独立,合法但无 transform 结构的对象同样返回 null。
 */
export function summarizeTransformSteps(ruleBody: string): TransformStepSummary[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ruleBody);
  } catch {
    return null;
  }
  const steps = extractTransforms(parsed);
  if (!steps) return null;
  return steps.map((s, i) => ({ index: i + 1, text: summarizeStep(s) }));
}
