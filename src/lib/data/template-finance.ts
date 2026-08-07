// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 财务审批业务模板。
// 完整度:P0 浅模板(规则 + 业务术语 + 业务表单 schema + 业务元数据)
// 业务场景:报销上限规则 + CFO 审批 + 多级审批
//
// 规则 JSON 采用内核合法 transform 数组格式(通过 G1-G7 门禁):
//   - 元指令:set / push / branch / io_request(G2)
//   - 域类型:eq / lt / gt / exists / all(G4)
//   - 末条 branch + all([]) 兜底(G6)
//
// 关联设计:P01_BUILD_SCHEMA_DESIGN.md §9.1

import type { BusinessTerm } from "$lib/stores/business-terms";
import type { BusinessFormSchema } from "$lib/stores/business-form-schema";
import type { RuleBusinessMeta } from "$lib/stores/rule-business-meta";
import type { Rule } from "@evorule/console";
import type { Industry } from "$lib/stores/db";
import { BUILTIN_BUSINESS_TERMS } from "./business-terms-builtin";
import { BUILTIN_FORM_SCHEMAS } from "./business-form-schemas-builtin";

export interface BusinessTemplate {
  id: "blank" | "finance" | "compliance";
  /** 行业(对齐 db.Industry,initDb 第三参数类型安全) */
  industry: Industry;
  displayName: string;
  description: string;
  /** builtin 规则集(代码内置,通过 addRule 加为 user 规则) */
  builtinRules: Array<Omit<Rule, "source" | "createdAt" | "updatedAt">>;
  /** 业务术语(builtin,代码内置) */
  businessTerms: BusinessTerm[];
  /** 业务表单 schema(builtin) */
  formSchemas: BusinessFormSchema[];
  /** 默认业务对象 */
  defaultBusinessObjects: string[];
  /** 规则业务元数据模板(关联 builtin 规则 id) */
  ruleMetaTemplate: Array<Omit<RuleBusinessMeta, "ruleId">>;
}

/** 财务审批规则 1:报销金额 ≥ 10000 元需 CFO 批准 */
const FINANCE_RULE_CFO = {
  id: "finance.expense_limit_cfo",
  version: 1,
  description: "报销金额 ≥ 10000 元需 CFO 批准",
  content: JSON.stringify(
    {
      id: "finance.expense_limit_cfo",
      version: 1,
      description: "报销金额 ≥ 10000 元需 CFO 批准",
      transform: [
        {
          type: "branch",
          params: {
            domain: {
              type: "lt",
              path: "__exec__.payload.amount",
              value: 10000,
            },
            on_true: [],
            on_false: [
              {
                type: "io_request",
                params: {
                  io_type: "call_external",
                  prompt: "通知 CFO 审批报销单",
                  role: "CFO",
                  channel: "IM",
                },
              },
            ],
          },
        },
        {
          type: "branch",
          params: { domain: { type: "all", domains: [] }, on_true: [] },
        },
      ],
    },
    null,
    2,
  ),
};

/** 财务审批规则 2:多级审批 5000-10000 财务主管,10000+ CFO */
const FINANCE_RULE_MULTI_LEVEL = {
  id: "finance.multi_level_approval",
  version: 1,
  description: "多级审批:5000-10000 财务主管,10000+ CFO",
  content: JSON.stringify(
    {
      id: "finance.multi_level_approval",
      version: 1,
      description: "多级审批:5000-10000 财务主管,10000+ CFO",
      transform: [
        {
          type: "branch",
          params: {
            domain: {
              type: "lt",
              path: "__exec__.payload.amount",
              value: 5000,
            },
            on_true: [],
            on_false: [
              {
                type: "branch",
                params: {
                  domain: {
                    type: "lt",
                    path: "__exec__.payload.amount",
                    value: 10000,
                  },
                  on_true: [
                    {
                      type: "io_request",
                      params: {
                        io_type: "call_external",
                        prompt: "通知财务主管审批",
                        role: "财务主管",
                      },
                    },
                  ],
                  on_false: [
                    {
                      type: "io_request",
                      params: {
                        io_type: "call_external",
                        prompt: "通知 CFO 审批",
                        role: "CFO",
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          type: "branch",
          params: { domain: { type: "all", domains: [] }, on_true: [] },
        },
      ],
    },
    null,
    2,
  ),
};

export const FINANCE_TEMPLATE: BusinessTemplate = {
  id: "finance",
  industry: "finance",
  displayName: "财务审批",
  description: "报销上限规则 + CFO 审批 + 多级审批",
  defaultBusinessObjects: ["报销单", "审批流", "财务凭证"],
  builtinRules: [FINANCE_RULE_CFO, FINANCE_RULE_MULTI_LEVEL],
  businessTerms: BUILTIN_BUSINESS_TERMS.filter((t) => t.industry === "finance"),
  formSchemas: BUILTIN_FORM_SCHEMAS.filter((s) => s.industry === "finance"),
  ruleMetaTemplate: [
    {
      industry: "finance",
      businessObject: "报销单",
      businessTermIds: [
        "finance.amount",
        "finance.threshold",
        "finance.approver",
      ],
      scenarioContext: "财务审批流程:报销金额超阈值需上级批准",
      schemaId: "finance.expense_limit",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};
