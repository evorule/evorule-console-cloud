// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 合规审计业务模板。
// 完整度:P0 浅模板
// 业务场景:SOX 控制点检查 + 证据收集 + 监管报送
//
// 规则 JSON 采用内核合法 transform 数组格式(通过 G1-G7 门禁)。
//
// 关联设计:P01_BUILD_SCHEMA_DESIGN.md §9.2

import type { BusinessTemplate } from "./template-finance";
import { BUILTIN_BUSINESS_TERMS } from "./business-terms-builtin";
import { BUILTIN_FORM_SCHEMAS } from "./business-form-schemas-builtin";

/** 合规规则 1:SOX-404 控制点必须填证据 */
const COMPLIANCE_RULE_SOX = {
  name: "compliance.sox_control_required",
  description: "SOX-404 控制点必须填证据",
  content: JSON.stringify(
    {
      id: "compliance.sox_control_required",
      version: 1,
      description: "SOX-404 控制点必须填证据",
      transform: [
        {
          type: "branch",
          params: {
            domain: {
              type: "eq",
              path: "__exec__.payload.controlPoint",
              value: "SOX-404",
            },
            on_true: [
              {
                type: "io_request",
                params: {
                  io_type: "call_external",
                  prompt: "要求提交 SOX-404 控制点证据",
                  evidenceType: "文档",
                },
              },
            ],
            on_false: [],
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

/** 合规规则 2:高风险事件需报送监管机构 */
const COMPLIANCE_RULE_REGULATOR = {
  name: "compliance.regulator_report",
  description: "高风险事件需报送监管机构",
  content: JSON.stringify(
    {
      id: "compliance.regulator_report",
      version: 1,
      description: "高风险事件需报送监管机构",
      transform: [
        {
          type: "branch",
          params: {
            domain: {
              type: "eq",
              path: "__exec__.payload.riskLevel",
              value: "高",
            },
            on_true: [
              {
                type: "io_request",
                params: {
                  io_type: "call_external",
                  prompt: "报送 SEC 监管机构",
                  regulator: "SEC",
                  format: "XML",
                },
              },
            ],
            on_false: [],
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

export const COMPLIANCE_TEMPLATE: BusinessTemplate = {
  id: "compliance",
  industry: "compliance",
  displayName: "合规审计",
  description: "SOX 控制点检查 + 证据收集 + 监管报送",
  defaultBusinessObjects: ["控制点", "审计证据", "监管报告"],
  builtinRules: [COMPLIANCE_RULE_SOX, COMPLIANCE_RULE_REGULATOR],
  businessTerms: BUILTIN_BUSINESS_TERMS.filter(
    (t) => t.industry === "compliance",
  ),
  formSchemas: BUILTIN_FORM_SCHEMAS.filter((s) => s.industry === "compliance"),
  ruleMetaTemplate: [
    {
      industry: "compliance",
      businessObject: "控制点",
      businessTermIds: [
        "compliance.control_point",
        "compliance.evidence",
        "compliance.regulator",
      ],
      scenarioContext: "SOX 合规审计:控制点检查 + 证据收集 + 监管报送",
      schemaId: "compliance.control_check",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};
