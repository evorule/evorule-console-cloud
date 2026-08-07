// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单 schema 内置数据(v0)。
// P0-1 起步:2 条(财务报销上限 + 合规控制点检查)
// v0 扩展:4 条(每行业 2 场景)+ 字段联动(visibleWhen)+ 复合条件
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §7.2

import type { BusinessFormSchema } from "$lib/stores/business-form-schema";

export const BUILTIN_FORM_SCHEMAS: BusinessFormSchema[] = [
  // === 财务:报销上限规则(P0-1 §7.2 增强) ===
  {
    id: "finance.expense_limit",
    industry: "finance",
    scenario: "报销上限规则",
    businessObjects: ["报销单", "支出"],
    version: 1,
    fields: [
      {
        id: "finance.amount_threshold",
        label: "金额阈值(元)",
        type: "number",
        evorulePath: "condition.value",
        defaultValue: 10000,
        description: "超过此金额的报销需要 CFO 批准",
        group: "condition",
        termId: "finance.threshold",
        validators: [
          { type: "required", message: "金额阈值必填" },
          { type: "min", param: 0, message: "金额阈值不能为负" },
        ],
      },
      {
        id: "finance.expense_type",
        label: "费用类型",
        type: "enum",
        evorulePath: "condition.params.expenseType",
        options: ["差旅", "办公", "招待", "福利"],
        defaultValue: "差旅",
        description: "费用的业务分类",
        group: "condition",
        termId: "finance.expense_type",
      },
      {
        id: "finance.approver_role",
        label: "审批人角色",
        type: "enum",
        evorulePath: "action.params.role",
        options: ["CFO", "财务主管", "部门经理"],
        defaultValue: "CFO",
        description: "触发审批时通知的角色",
        group: "action",
        termId: "finance.approver",
        // v0 联动:非福利类型才显示审批人
        visibleWhen: [
          { fieldId: "finance.expense_type", operator: "ne", value: "福利" },
        ],
      },
      {
        id: "finance.notify_channel",
        label: "通知渠道",
        type: "enum",
        evorulePath: "action.params.channel",
        options: ["邮件", "短信", "IM"],
        defaultValue: "邮件",
        description: "审批通知的发送渠道",
        group: "action",
        termId: "finance.notify_channel",
        // v0 联动:CFO 审批强制必填通知渠道(避免漏看)
        requiredWhen: [
          { fieldId: "finance.approver_role", operator: "eq", value: "CFO" },
        ],
      },
    ],
  },
  // === 财务:部门预算规则(v0 新增) ===
  {
    id: "finance.department_budget",
    industry: "finance",
    scenario: "部门预算规则",
    businessObjects: ["部门", "预算"],
    version: 1,
    fields: [
      {
        id: "finance.department_name",
        label: "部门名称",
        type: "enum",
        evorulePath: "condition.value",
        options: ["研发", "销售", "市场", "运营"],
        defaultValue: "研发",
        description: "受预算控制的部门",
        group: "condition",
        termId: "finance.department",
        validators: [{ type: "required", message: "部门必选" }],
      },
      {
        id: "finance.budget_limit",
        label: "预算上限(元)",
        type: "number",
        evorulePath: "condition.params.limit",
        defaultValue: 100000,
        description: "部门月度预算上限",
        group: "condition",
        termId: "finance.threshold",
        validators: [
          { type: "required", message: "预算上限必填" },
          { type: "min", param: 0, message: "预算不能为负" },
        ],
      },
      {
        id: "finance.alert_threshold",
        label: "预警阈值(%)",
        type: "number",
        evorulePath: "action.params.alertThreshold",
        defaultValue: 80,
        description: "达到预算的多少百分比时预警",
        group: "action",
        validators: [
          { type: "min", param: 0, message: "阈值不能 < 0%" },
          { type: "max", param: 100, message: "阈值不能 > 100%" },
        ],
      },
    ],
  },
  // === 合规:控制点检查规则(P0-1 §7.2 增强) ===
  {
    id: "compliance.control_check",
    industry: "compliance",
    scenario: "控制点检查规则",
    businessObjects: ["案件", "控制点"],
    version: 1,
    fields: [
      {
        id: "compliance.control_point_id",
        label: "控制点编号",
        type: "string",
        evorulePath: "condition.value",
        defaultValue: "SOX-404",
        description: "合规控制点的标准编号",
        group: "condition",
        termId: "compliance.control_point",
        validators: [{ type: "required", message: "控制点编号必填" }],
      },
      {
        id: "compliance.required_evidence",
        label: "必需证据类型",
        type: "enum",
        evorulePath: "action.params.evidenceType",
        options: ["文档", "日志", "截图", "签字"],
        defaultValue: "文档",
        description: "合规审计要求的证据类型",
        group: "action",
        termId: "compliance.evidence",
      },
      {
        id: "compliance.regulatory_body",
        label: "监管机构",
        type: "enum",
        evorulePath: "action.params.regulator",
        options: ["SOX", "SEC", "银保监", "等保 2.0"],
        defaultValue: "SOX",
        description: "需要报送的监管机构",
        group: "action",
        termId: "compliance.regulator",
        // v0 联动:SOX 控制点强制 SEC 报送
        requiredWhen: [
          {
            fieldId: "compliance.control_point_id",
            operator: "in",
            value: ["SOX-404", "SOX-302"],
          },
        ],
      },
    ],
  },
  // === 合规:风险等级预警规则(v0 新增) ===
  {
    id: "compliance.risk_alert",
    industry: "compliance",
    scenario: "风险等级预警规则",
    businessObjects: ["案件", "风险"],
    version: 1,
    fields: [
      {
        id: "compliance.risk_level",
        label: "风险等级",
        type: "enum",
        evorulePath: "condition.value",
        options: ["高", "中", "低"],
        defaultValue: "中",
        description: "合规风险等级",
        group: "condition",
        termId: "compliance.risk_level",
        validators: [{ type: "required", message: "风险等级必选" }],
      },
      {
        id: "compliance.deadline_date",
        label: "合规期限",
        type: "date",
        evorulePath: "condition.params.deadline",
        description: "合规报送的截止日期",
        group: "condition",
        termId: "compliance.deadline",
      },
      {
        id: "compliance.report_format",
        label: "报送格式",
        type: "enum",
        evorulePath: "action.params.format",
        options: ["XML", "JSON", "PDF"],
        defaultValue: "XML",
        description: "向监管机构报送的文件格式",
        group: "action",
        termId: "compliance.report_format",
        // v0 联动:高风险才显示报送格式
        visibleWhen: [
          { fieldId: "compliance.risk_level", operator: "eq", value: "高" },
        ],
      },
    ],
  },
];
