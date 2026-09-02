// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务模板加载器(建库向导 Step 2 确认时调用)。
//
// 流程:
//   1. initDb(库名 + 业务对象 + 行业)
//   2. 遍历 builtinRules,addRule(backend, workspaceId, req) 逐条写入 workspace
//   3. 遍历 ruleMetaTemplate,setMeta() 关联业务元数据
//
// 注意:内核 v0.2.0 workspace 化后 addRule 为异步写入(经 WorkspaceBackend),
//       模板加载整体 async;builtin 性质由 ruleBusinessMeta.industry 标识。
//
// 关联设计:P01_BUILD_SCHEMA_DESIGN.md §9.3

import {
  addRule,
  currentWorkspace,
  type WorkspaceBackend
} from "$lib/kernel";
import { getActiveWorkspaceBackend } from "$lib/backend/cloud-workspace-backend";
import { get } from "svelte/store";
import { initDb } from "$lib/stores/db";
import { setMeta } from "$lib/stores/rule-business-meta";
import {
  FINANCE_TEMPLATE,
  type BusinessTemplate,
} from "$lib/data/template-finance";
import { COMPLIANCE_TEMPLATE } from "$lib/data/template-compliance";

const TEMPLATES: Record<string, BusinessTemplate> = {
  finance: FINANCE_TEMPLATE,
  compliance: COMPLIANCE_TEMPLATE,
};

export { FINANCE_TEMPLATE, COMPLIANCE_TEMPLATE };
export type { BusinessTemplate };

/** 解析当前 workspace 写入上下文(组件调用方无需重复取用)
 *
 * 为什么用 getActiveWorkspaceBackend 而非 useWorkspaceBackend:
 *   本函数会被 loadTemplate 的默认参数在事件处理器内求值,
 *   Svelte 5 的 getContext 仅限组件初始化期,事件处理器内调用抛
 *   lifecycle_outside_component → 表现为"模板加载失败"。
 */
export function resolveTemplateWriteContext(): {
  backend: WorkspaceBackend;
  workspaceId: string;
} {
  const backend = getActiveWorkspaceBackend();
  const ws = get(currentWorkspace);
  if (!ws) {
    throw new Error("当前没有 workspace,无法加载模板(请先完成初始化)");
  }
  return { backend, workspaceId: ws.id };
}

/**
 * 加载业务模板(Step 2 确认时调用)。
 *
 * @param templateId 模板 id(finance / compliance)
 * @param dbName 用户填写的库名
 * @param ctx workspace 写入上下文(backend + workspaceId)
 * @returns 加载的规则 id 列表(供向导跳转/试运行用)
 */
export async function loadTemplate(
  templateId: "finance" | "compliance",
  dbName: string,
  ctx: { backend: WorkspaceBackend; workspaceId: string } = resolveTemplateWriteContext(),
): Promise<string[]> {
  const tpl = TEMPLATES[templateId];
  if (!tpl) {
    throw new Error(`未知模板: ${templateId}`);
  }

  // 1. 初始化库元数据
  initDb(dbName, tpl.defaultBusinessObjects, tpl.industry);

  // 2. 加载 builtin 规则到 workspace + 关联业务元数据
  const loadedRuleIds: string[] = [];
  for (const rule of tpl.builtinRules) {
    const newId = await addRule(ctx.backend, ctx.workspaceId, {
      name: rule.name,
      content: rule.content,
      description: rule.description ?? undefined,
    });
    loadedRuleIds.push(newId);

    // 3. 关联业务元数据(用模板第一份 meta,所有规则共享同一业务上下文)
    const metaTpl = tpl.ruleMetaTemplate[0];
    if (metaTpl) {
      setMeta({
        ruleId: newId,
        industry: metaTpl.industry,
        businessObject: metaTpl.businessObject,
        businessTermIds: [...metaTpl.businessTermIds],
        scenarioContext: metaTpl.scenarioContext,
        schemaId: metaTpl.schemaId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return loadedRuleIds;
}

/** 获取模板定义(只读,用于向导展示) */
export function getTemplate(
  id: "blank" | "finance" | "compliance",
): BusinessTemplate | null {
  if (id === "blank") return null;
  return TEMPLATES[id] ?? null;
}
