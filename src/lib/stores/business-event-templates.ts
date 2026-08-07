// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务事件模板(预设,代码内置)。
// 模板 = P02 表单字段定义 + 示例数据 + LLM 翻译提示词。
//
// 关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §4.2 + §5.3 + §3.4(决策 4)
//
// P0 起步:医疗 × 2(病人就诊 / 药品开具)+ 财务 × 1(发票审批)。

import type { Industry } from "$lib/stores/db";

/** 业务事件表单字段类型 */
export type FormFieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "textarea"
  | "checkbox";

/** 业务事件表单字段定义 */
export interface FormField {
  /** 字段名(对应 formData 的 key) */
  name: string;
  /** 显示标签(中文) */
  label: string;
  /** 字段类型 */
  type: FormFieldType;
  /** 是否必填 */
  required: boolean;
  /** 默认值 */
  defaultValue?: unknown;
  /** select 类型的选项 */
  options?: { value: string; label: string }[];
  /** 校验规则 */
  validate?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  /** 业务术语提示(复用 P02 businessTermsStore) */
  termHint?: string;
}

/** 业务事件模板 */
export interface BusinessEventTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名(如"病人就诊") */
  name: string;
  /** 描述 */
  description: string;
  /** 行业 */
  industry: Industry;
  /** 表单字段定义 */
  formSchema: FormField[];
  /** 示例数据(加载模板时预填) */
  sampleData: Record<string, unknown>;
  /** LLM 翻译提示词模板({formData} 占位符被实际表单数据替换) */
  translatePrompt: string;
  /** 图标(emoji) */
  icon: string;
}

/** 内置业务事件模板(P0 起步:医疗 + 财务) */
export const BUILTIN_TEMPLATES: BusinessEventTemplate[] = [
  {
    id: "patient_visit",
    name: "病人就诊",
    description: "记录病人就诊信息,触发诊疗规则",
    industry: "medical",
    icon: "🏥",
    formSchema: [
      {
        name: "patientId",
        label: "病人 ID",
        type: "text",
        required: true,
        termHint: "病人唯一标识",
      },
      {
        name: "temperature",
        label: "体温(°C)",
        type: "number",
        required: true,
        validate: { min: 30, max: 45 },
      },
      {
        name: "symptom",
        label: "症状",
        type: "select",
        required: true,
        options: [
          { value: "fever", label: "发热" },
          { value: "cough", label: "咳嗽" },
          { value: "chest_pain", label: "胸痛" },
        ],
      },
      {
        name: "age",
        label: "年龄",
        type: "number",
        required: true,
        validate: { min: 0, max: 150 },
      },
    ],
    sampleData: { patientId: "P-1283", temperature: 39.2, symptom: "fever", age: 65 },
    translatePrompt: `将以下病人就诊信息翻译为 evorule 指令 JSON(4 元素:domain/action/payload/meta):
{formData}
domain 应为 "medical",action 应为 "patient_visit"`,
  },
  {
    id: "drug_prescribe",
    name: "药品开具",
    description: "记录药品开具信息,触发用药规则",
    industry: "medical",
    icon: "💊",
    formSchema: [
      { name: "patientId", label: "病人 ID", type: "text", required: true },
      { name: "drugName", label: "药品名称", type: "text", required: true },
      {
        name: "dosage",
        label: "剂量(mg)",
        type: "number",
        required: true,
        validate: { min: 0 },
      },
      {
        name: "isHighRisk",
        label: "高风险药品",
        type: "checkbox",
        required: false,
        defaultValue: false,
      },
    ],
    sampleData: {
      patientId: "P-1283",
      drugName: "阿莫西林",
      dosage: 500,
      isHighRisk: false,
    },
    translatePrompt: `将以下药品开具信息翻译为 evorule 指令 JSON(4 元素):
{formData}
domain 应为 "medical", action 应为 "drug_prescribe"`,
  },
  {
    id: "invoice_approve",
    name: "发票审批",
    description: "提交发票审批请求,触发财务规则",
    industry: "finance",
    icon: "💰",
    formSchema: [
      { name: "invoiceId", label: "发票编号", type: "text", required: true },
      {
        name: "amount",
        label: "金额(元)",
        type: "number",
        required: true,
        validate: { min: 0 },
      },
      { name: "department", label: "申请部门", type: "text", required: true },
      {
        name: "urgency",
        label: "紧急程度",
        type: "select",
        required: true,
        options: [
          { value: "normal", label: "普通" },
          { value: "urgent", label: "紧急" },
          { value: "critical", label: "特急" },
        ],
      },
    ],
    sampleData: {
      invoiceId: "INV-2026-001",
      amount: 50000,
      department: "急诊科",
      urgency: "urgent",
    },
    translatePrompt: `将以下发票审批信息翻译为 evorule 指令 JSON(4 元素):
{formData}
domain 应为 "finance", action 应为 "invoice_approve"`,
  },
];

/** 按 ID 获取模板 */
export function getTemplate(id: string): BusinessEventTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

/** 按行业筛选模板 */
export function templatesByIndustry(industry: Industry): BusinessEventTemplate[] {
  return BUILTIN_TEMPLATES.filter((t) => t.industry === industry);
}
