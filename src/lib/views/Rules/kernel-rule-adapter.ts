// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 内核规则适配层(v0 新增)。
//
// 设计动机:
//   - 业务表单产出"业务视图"简化形状({condition, action, branch}),
//     便于字段映射与结构化解释
//   - 内核 RuleValidator 要求 transform 数组格式 + 末条 all([]) 兜底(G6),
//     元指令类型必须是 set/push/branch/io_request(G2),
//     域类型必须是 eq/lt/exists/instruction/all/not(G4)
//   - 本适配层负责两种形状之间的双向转换,确保保存到内核的规则通过 G1-G7
//
// 与设计文档的关系:
//   - P02 §9.3 的 formValuesToEvoruleJson 产出业务视图,本文件负责包装
//   - P02 §9.4 的 explainStructured 可读业务视图(unwrap 后)或直接读 transform
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.3 + 内核 ruleValidator.d.ts

/** 业务视图条件(简化形状) */
export interface BusinessCondition {
  /** 域类型:gt/lt/eq/exists(业务表单常用,映射到内核域类型) */
  domain?: string;
  /** 比较值 */
  value?: unknown;
  /** 字段路径(可选,如 __exec__.payload.amount) */
  path?: string;
  /** 附加参数(如 expenseType) */
  params?: Record<string, unknown>;
}

/** 业务视图动作(简化形状) */
export interface BusinessAction {
  /** 动作类型(业务语义,如 require_approval / report_to_regulator) */
  type?: string;
  /** meta 元指令(若已知:set/push/branch/io_request) */
  meta?: string;
  /** 动作参数 */
  params?: Record<string, unknown>;
}

/** 业务视图规则形状(表单转换器产出) */
export interface BusinessRuleShape {
  condition?: BusinessCondition;
  action?: BusinessAction;
  branch?: Array<{ condition?: BusinessCondition; action?: BusinessAction }>;
}

/** 内核 transform 数组中的单条指令 */
export interface KernelTransformStep {
  type: "set" | "push" | "branch" | "io_request";
  params: Record<string, unknown>;
}

/** 内核规则 JSON 形状 */
export interface KernelRuleJson {
  id?: string;
  version?: number;
  description?: string;
  transform: KernelTransformStep[];
}

/**
 * 业务视图域类型 → 内核域类型映射。
 *
 * 内核 G4 仅允许:eq / lt / exists / instruction / all / not(6 种,有限性 = 确定性)。
 * 业务表单常用 gt,但内核不支持 gt — 用 lt + on_false 表达"大于"语义
 * (见 template-finance.ts 的 FINANCE_RULE_CFO:domain=lt value=10000,动作在 on_false)。
 * 此处 domain=gt 不在白名单 → 回退到 exists(业务语义"满足条件时执行")。
 * LLM 草案若用 gt,业务专家应在表单模式中改为 lt + 反向动作。
 *
 * 其他 domain 缺失 → exists 兜底。
 */
function mapDomain(domain: string | undefined): string {
  // 对齐内核 ruleValidator.js VALID_DOMAIN_TYPES
  const allowed = ["eq", "lt", "exists", "instruction", "all", "not"];
  if (domain && allowed.includes(domain)) return domain;
  // 业务表单 condition 默认语义:字段值满足比较时触发 → exists
  return "exists";
}

/**
 * 把业务视图动作转换为内核 transform step(s)。
 *
 * 业务动作 type(如 require_approval)不是内核元指令,
 * 映射为 io_request(调用外部审批/通知系统),prompt 携带业务语义。
 *
 * G3 合规:io_request 必须在 exists(__io_result__) 分支内(双路径 IO 模式)。
 *   - on_true:结果已存在 → 处理结果(此处为空,由后续规则处理)
 *   - on_false:结果不存在 → 发起 io_request
 * 故 io_request 动作会被包成一个内层 branch,而非裸 io_request step。
 *
 * 返回数组以便调用方 spread 到 on_true/on_false。
 */
function actionToSteps(action: BusinessAction): KernelTransformStep[] {
  // 已是合法元指令且非 io_request:直接用
  if (
    action.meta &&
    ["set", "push", "branch"].includes(action.meta)
  ) {
    return [
      {
        type: action.meta as KernelTransformStep["type"],
        params: action.params ?? {},
      },
    ];
  }

  // io_request 或业务动作 → 包成 exists(__io_result__) 双路径 branch(G3 合规)
  const ioParams: Record<string, unknown> = {
    io_type: "call_external",
    prompt: action.type ?? "执行业务动作",
  };
  if (action.params) {
    for (const [k, v] of Object.entries(action.params)) {
      ioParams[k] = v;
    }
  }

  return [
    {
      type: "branch",
      params: {
        domain: {
          type: "exists",
          path: "__exec__.payload.__io_result__",
        },
        on_true: [], // 结果已存在 → 此规则不处理(由后续规则消费)
        on_false: [{ type: "io_request", params: ioParams }],
      },
    },
  ];
}

/**
 * 把业务视图条件转换为内核 branch 的 domain。
 *
 * 内核 domain 形状:{ type, path?, value?, domains? }
 */
function conditionToDomain(
  cond: BusinessCondition,
): Record<string, unknown> {
  const type = mapDomain(cond.domain);
  const domain: Record<string, unknown> = { type };
  if (cond.path) domain.path = cond.path;
  if (cond.value !== undefined) domain.value = cond.value;
  // 附加 params 合并进 domain(业务层扩展,内核忽略未识别字段)
  if (cond.params) {
    for (const [k, v] of Object.entries(cond.params)) {
      domain[k] = v;
    }
  }
  return domain;
}

/**
 * wrapAsKernelTransform:业务视图 → 内核 transform 数组(含 G6 兜底)。
 *
 * 转换规则:
 *   - 单条件 + 单动作 → 一个 branch(on_true 放动作)+ 末条 all([]) 兜底
 *   - branch 数组 → 逐分支转 branch step + 末条 all([]) 兜底
 *   - 无 condition 只有 action → 直接放 action step(s)+ 末条 all([]) 兜底
 *   - 空业务视图 → 仅 all([]) 兜底(最简合法规则)
 *
 * G3 合规:io_request 类动作会被 actionToSteps 包成 exists(__io_result__) 内层 branch,
 *          不会出现裸 io_request step。
 */
export function wrapAsKernelTransform(
  business: BusinessRuleShape,
): KernelRuleJson {
  const transform: KernelTransformStep[] = [];

  if (business.branch && business.branch.length > 0) {
    // 多分支:每分支一个 branch step
    for (const br of business.branch) {
      const domain = br.condition
        ? conditionToDomain(br.condition)
        : { type: "all", domains: [] };
      const onTrue = br.action ? actionToSteps(br.action) : [];
      transform.push({
        type: "branch",
        params: { domain, on_true: onTrue, on_false: [] },
      });
    }
  } else if (business.condition && business.action) {
    // 单条件 + 单动作:一个 branch
    const domain = conditionToDomain(business.condition);
    transform.push({
      type: "branch",
      params: {
        domain,
        on_true: actionToSteps(business.action),
        on_false: [],
      },
    });
  } else if (business.action) {
    // 无条件有动作:直接执行(actionToSteps 可能返回多个 step)
    transform.push(...actionToSteps(business.action));
  } else if (business.condition) {
    // 只有条件无动作:branch 空动作(语义=标记)
    const domain = conditionToDomain(business.condition);
    transform.push({
      type: "branch",
      params: { domain, on_true: [], on_false: [] },
    });
  }

  // G6 兜底:末条必须是 branch + all([])
  transform.push({
    type: "branch",
    params: { domain: { type: "all", domains: [] }, on_true: [] },
  });

  return { transform };
}

/**
 * unwrapKernelTransform:内核 transform 数组 → 业务视图(用于反向解析回表单)。
 *
 * 提取策略(简化):
 *   - 找第一个 branch(非兜底、非 __io_result__ 检查)→ condition + action
 *   - 兜底 branch(all([]))忽略
 *   - __io_result__ 包装 branch(由 actionToSteps 产生)→ 提取内层 io_request 作为 action
 *   - 非 branch step 作为独立 action
 *
 * 未识别的复杂结构保留在 rawTransform 中,供开发者模式查看。
 */
export function unwrapKernelTransform(
  kernel: KernelRuleJson,
): BusinessRuleShape & { rawTransform?: KernelTransformStep[] } {
  const result: BusinessRuleShape & { rawTransform?: KernelTransformStep[] } =
    {};

  if (!kernel.transform || kernel.transform.length === 0) {
    return result;
  }

  const transform = kernel.transform;
  result.rawTransform = transform;

  // 找第一个非兜底 branch(且非 __io_result__ 检查 branch)
  const firstBranch = transform.find(
    (step) =>
      step.type === "branch" && !isFallbackBranch(step) && !isIoResultCheckBranch(step),
  );

  if (firstBranch) {
    const domain = firstBranch.params.domain as Record<string, unknown> | undefined;
    if (domain) {
      result.condition = {
        domain: domain.type as string,
        value: domain.value,
        path: domain.path as string | undefined,
      };
    }
    const onTrue = firstBranch.params.on_true as KernelTransformStep[] | undefined;
    if (onTrue && onTrue.length > 0) {
      result.action = stepToAction(onTrue[0]);
    }
  } else if (transform.length > 0) {
    // 无业务 branch,取第一个非兜底 step 作为 action
    const firstStep = transform.find((s) => s.type !== "branch" || !isFallbackBranch(s));
    if (firstStep) {
      result.action = stepToAction(firstStep);
    }
  }

  return result;
}

/** 判断是否为 G6 兜底 branch(all([])) */
function isFallbackBranch(step: KernelTransformStep): boolean {
  if (step.type !== "branch") return false;
  const domain = step.params.domain as Record<string, unknown> | undefined;
  return (
    domain?.type === "all" &&
    (!domain.domains || (domain.domains as unknown[]).length === 0)
  );
}

/** 判断是否为 G3 __io_result__ 检查 branch(由 actionToSteps 产生) */
function isIoResultCheckBranch(step: KernelTransformStep): boolean {
  if (step.type !== "branch") return false;
  const domain = step.params.domain as Record<string, unknown> | undefined;
  return (
    domain?.type === "exists" &&
    domain?.path === "__exec__.payload.__io_result__"
  );
}

function stepToAction(step: KernelTransformStep): BusinessAction {
  // G3 包装 branch:提取内层 io_request 作为 action
  if (isIoResultCheckBranch(step)) {
    const onFalse = step.params.on_false as KernelTransformStep[] | undefined;
    if (onFalse && onFalse.length > 0) {
      const ioStep = onFalse[0];
      const params = { ...(ioStep.params as Record<string, unknown>) };
      // prompt 作为业务动作 type
      const actionType = params.prompt;
      delete params.prompt;
      delete params.io_type;
      return {
        meta: "io_request",
        type: typeof actionType === "string" ? actionType : undefined,
        params,
      };
    }
  }
  return {
    meta: step.type,
    params: step.params,
  };
}

/**
 * 便捷:把业务视图 + 元数据打包成内核 Rule.content 字符串(直接喂给 addRule)。
 */
export function buildKernelRuleContent(
  business: BusinessRuleShape,
  meta?: { id?: string; version?: number; description?: string },
): string {
  const kernel = wrapAsKernelTransform(business);
  const full: KernelRuleJson & {
    id?: string;
    description?: string;
  } = { ...kernel };
  if (meta?.id) full.id = meta.id;
  if (meta?.description) full.description = meta.description;
  // 不透传 version — 由内核管理(rule 创建时自动 +1)
  return JSON.stringify(full, null, 2);
}
