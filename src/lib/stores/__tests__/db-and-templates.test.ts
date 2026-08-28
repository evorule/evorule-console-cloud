// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// db 元数据 + 模板加载测试(v0.2.0 workspace 化重写)。
// 内核 v0.2.0 起规则写入走 WorkspaceBackend(异步),模板加载需注入
// MockWorkspaceBackend(内存实现,实例间天然隔离)。

import { describe, test, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  dbStore,
  initDb,
  resetDb,
  isEmptyDb,
  ruleCount,
  checkEmptyDb,
  type Industry,
} from "$lib/stores/db";
import {
  loadTemplate,
  getTemplate,
  FINANCE_TEMPLATE,
  COMPLIANCE_TEMPLATE,
} from "$lib/views/Build/templates";
import { rules, resetRulesStore } from "$lib/kernel";
import { MockWorkspaceBackend } from "$lib/backend/mock-workspace-backend";
import { tagStore } from "$lib/stores/tag";
import { categoryStore } from "$lib/stores/category";
import { ruleBusinessMetaStore } from "$lib/stores/rule-business-meta";
import type { WorkspaceBackend } from "$lib/kernel";

let backend: MockWorkspaceBackend;
let ctx: { backend: WorkspaceBackend; workspaceId: string };

beforeEach(async () => {
  resetRulesStore();
  resetDb();
  tagStore.set([]);
  categoryStore.set([]);
  ruleBusinessMetaStore.set({});

  backend = new MockWorkspaceBackend();
  const ws = await backend.createWorkspace({
    name: "test-workspace",
    owner_id: "tester",
  });
  ctx = { backend, workspaceId: ws.id };
});

describe("dbStore - initDb 初始化库元数据", () => {
  test("initDb 设置 dbName + businessObjects + industry 正确", () => {
    initDb("测试库", ["订单", "客户"], "finance");
    const db = get(dbStore);
    expect(db.dbId).toBe("default");
    expect(db.dbName).toBe("测试库");
    expect(db.businessObjects).toEqual(["订单", "客户"]);
    expect(db.industry).toBe("finance");
    expect(db.createdAt).toBeTruthy();
    expect(new Date(db.createdAt!).toString()).not.toBe("Invalid Date");
  });

  test("initDb 覆盖之前的值", () => {
    initDb("旧库", ["旧对象"], "blank");
    initDb("新库", ["新对象1", "新对象2"], "compliance");
    const db = get(dbStore);
    expect(db.dbName).toBe("新库");
    expect(db.businessObjects).toEqual(["新对象1", "新对象2"]);
    expect(db.industry).toBe("compliance");
  });

  test("initDb 每个行业参数都能正确设置", () => {
    const industries: Industry[] = ["blank", "finance", "compliance", "medical"];
    for (const ind of industries) {
      initDb(`${ind}库`, [`${ind}对象`], ind);
      expect(get(dbStore).industry).toBe(ind);
      expect(get(dbStore).dbName).toBe(`${ind}库`);
    }
  });

  test("initDb businessObjects 空数组", () => {
    initDb("空业务库", [], "blank");
    expect(get(dbStore).businessObjects).toEqual([]);
  });

  test("resetDb 恢复默认值", () => {
    initDb("有值库", ["a", "b"], "finance");
    resetDb();
    const db = get(dbStore);
    expect(db.dbName).toBe("");
    expect(db.businessObjects).toEqual([]);
    expect(db.industry).toBe("blank");
    expect(db.createdAt).toBeNull();
  });
});

describe("isEmptyDb / ruleCount - 空库派生计算", () => {
  test("重置后 rules 为空,isEmptyDb=true", () => {
    // v0.2.0:内置规则经 seedBuiltinRules 写入 workspace,store 重置后为空
    expect(get(rules).length).toBe(0);
    expect(get(isEmptyDb)).toBe(true);
    expect(get(ruleCount)).toBe(0);
    expect(checkEmptyDb()).toBe(true);
  });

  test("loadTemplate 后 isEmptyDb=false, ruleCount=规则数", async () => {
    const ids = await loadTemplate("finance", "财务测试库", ctx);
    expect(get(isEmptyDb)).toBe(false);
    expect(get(ruleCount)).toBe(ids.length);
    expect(checkEmptyDb()).toBe(false);
  });
});

describe("templates - getTemplate 只读访问", () => {
  test("getTemplate('finance') 返回 FINANCE_TEMPLATE", () => {
    const tpl = getTemplate("finance");
    expect(tpl).not.toBeNull();
    expect(tpl!.id).toBe("finance");
    expect(tpl!.industry).toBe("finance");
    expect(tpl!.displayName).toBeTruthy();
  });

  test("getTemplate('compliance') 返回 COMPLIANCE_TEMPLATE", () => {
    const tpl = getTemplate("compliance");
    expect(tpl).not.toBeNull();
    expect(tpl!.id).toBe("compliance");
    expect(tpl!.industry).toBe("compliance");
  });

  test("getTemplate('blank') 返回 null", () => {
    expect(getTemplate("blank")).toBeNull();
  });
});

describe("templates - loadTemplate 加载 finance 模板", () => {
  test("loadTemplate('finance') 返回 ruleIds.length > 0", async () => {
    const ids = await loadTemplate("finance", "财务测试库", ctx);
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBe(FINANCE_TEMPLATE.builtinRules.length);
  });

  test("loadTemplate('finance') 后 dbStore 正确", async () => {
    await loadTemplate("finance", "我的财务库", ctx);
    const db = get(dbStore);
    expect(db.dbName).toBe("我的财务库");
    expect(db.industry).toBe("finance");
    expect(db.businessObjects).toEqual(FINANCE_TEMPLATE.defaultBusinessObjects);
    expect(db.businessObjects.length).toBeGreaterThan(0);
  });

  test("loadTemplate('finance') 后规则被添加到 rules store", async () => {
    const beforeCount = get(ruleCount);
    const ids = await loadTemplate("finance", "财务库", ctx);
    const afterCount = get(ruleCount);
    expect(afterCount - beforeCount).toBe(ids.length);
    expect(afterCount - beforeCount).toBe(FINANCE_TEMPLATE.builtinRules.length);
    for (const id of ids) {
      const rule = get(rules).find((r) => r.id === id);
      expect(rule).toBeDefined();
      // v0.2.0:通过 addRule 写入的规则为 draft 状态,非只读
      expect(rule!.state).toBe("draft");
    }
  });

  test("loadTemplate('finance') 后每条规则都有业务元数据", async () => {
    const ids = await loadTemplate("finance", "财务库", ctx);
    const metaMap = get(ruleBusinessMetaStore);
    for (const id of ids) {
      expect(metaMap[id]).toBeDefined();
      expect(metaMap[id].industry).toBe("finance");
      expect(metaMap[id].businessObject).toBeTruthy();
      expect(Array.isArray(metaMap[id].businessTermIds)).toBe(true);
    }
  });

  test("loadTemplate 后规则内容写入 backend(mock 内存可查)", async () => {
    const ids = await loadTemplate("finance", "财务库", ctx);
    const remoteRules = await backend.listRules(ctx.workspaceId);
    expect(remoteRules.length).toBe(ids.length);
  });
});

describe("templates - loadTemplate 加载 compliance 模板", () => {
  test("loadTemplate('compliance') 返回 ruleIds.length > 0", async () => {
    const ids = await loadTemplate("compliance", "合规测试库", ctx);
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBe(COMPLIANCE_TEMPLATE.builtinRules.length);
  });

  test("loadTemplate('compliance') 后 dbStore 正确", async () => {
    await loadTemplate("compliance", "我的合规库", ctx);
    const db = get(dbStore);
    expect(db.dbName).toBe("我的合规库");
    expect(db.industry).toBe("compliance");
    expect(db.businessObjects).toEqual(COMPLIANCE_TEMPLATE.defaultBusinessObjects);
  });

  test("loadTemplate('compliance') 后规则被添加", async () => {
    const beforeCount = get(ruleCount);
    const ids = await loadTemplate("compliance", "合规库", ctx);
    const afterCount = get(ruleCount);
    expect(afterCount - beforeCount).toBe(ids.length);
  });

  test("loadTemplate('compliance') 后业务元数据 industry=compliance", async () => {
    const ids = await loadTemplate("compliance", "合规库", ctx);
    const metaMap = get(ruleBusinessMetaStore);
    for (const id of ids) {
      expect(metaMap[id].industry).toBe("compliance");
    }
  });
});

describe("templates - blank 模板不应调用 loadTemplate", () => {
  test("getTemplate('blank') 为 null,暗示不能 loadTemplate", () => {
    expect(getTemplate("blank")).toBeNull();
  });

  test("loadTemplate 未知 id 会抛错(类型系统外的调用)", async () => {
    await expect(
      (loadTemplate as any)("blank", "空白库", ctx),
    ).rejects.toThrow(/未知模板/);
  });

  test("loadTemplate 完全不存在的 id 抛错", async () => {
    await expect(
      (loadTemplate as any)("nonexistent", "库名", ctx),
    ).rejects.toThrow(/未知模板/);
  });
});

describe("templates - builtinRules 每条符合内核 transform 数组格式", () => {
  test("FINANCE_TEMPLATE.builtinRules 每条 content 有 transform 数组", () => {
    expect(FINANCE_TEMPLATE.builtinRules.length).toBeGreaterThan(0);
    for (const rule of FINANCE_TEMPLATE.builtinRules) {
      const parsed = JSON.parse(rule.content);
      expect(Array.isArray(parsed.transform)).toBe(true);
      expect(parsed.transform.length).toBeGreaterThan(0);
      for (const t of parsed.transform) {
        expect(t.type).toBeTruthy();
        expect(["set", "push", "branch", "io_request"]).toContain(t.type);
      }
    }
  });

  test("FINANCE_TEMPLATE 第一条 rule:有 branch 结构", () => {
    const rule = FINANCE_TEMPLATE.builtinRules[0];
    const parsed = JSON.parse(rule.content);
    const hasBranch = parsed.transform.some((t: any) => t.type === "branch");
    expect(hasBranch).toBe(true);
  });

  test("FINANCE_TEMPLATE 每条 rule 有 name/description/content", () => {
    // v0.2.0:TemplateRule 以 name 标识(workspace 内唯一),不再有 id/version
    for (const rule of FINANCE_TEMPLATE.builtinRules) {
      expect(rule.name).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(rule.content).toBeTruthy();
      expect(rule.name.startsWith("finance.")).toBe(true);
    }
  });

  test("COMPLIANCE_TEMPLATE.builtinRules 每条 content 有 transform 数组", () => {
    expect(COMPLIANCE_TEMPLATE.builtinRules.length).toBeGreaterThan(0);
    for (const rule of COMPLIANCE_TEMPLATE.builtinRules) {
      const parsed = JSON.parse(rule.content);
      expect(Array.isArray(parsed.transform)).toBe(true);
      expect(parsed.transform.length).toBeGreaterThan(0);
      for (const t of parsed.transform) {
        expect(t.type).toBeTruthy();
      }
    }
  });

  test("COMPLIANCE_TEMPLATE 每条 rule 有正确 name 前缀", () => {
    for (const rule of COMPLIANCE_TEMPLATE.builtinRules) {
      expect(rule.name.startsWith("compliance.")).toBe(true);
    }
  });

  test("两个模板合计 4 条 builtin 规则", () => {
    const total = FINANCE_TEMPLATE.builtinRules.length + COMPLIANCE_TEMPLATE.builtinRules.length;
    expect(total).toBe(4);
  });

  test("每个模板的 defaultBusinessObjects 非空", () => {
    expect(FINANCE_TEMPLATE.defaultBusinessObjects.length).toBeGreaterThan(0);
    expect(COMPLIANCE_TEMPLATE.defaultBusinessObjects.length).toBeGreaterThan(0);
  });

  test("每个模板的 ruleMetaTemplate 非空", () => {
    expect(FINANCE_TEMPLATE.ruleMetaTemplate.length).toBeGreaterThan(0);
    expect(COMPLIANCE_TEMPLATE.ruleMetaTemplate.length).toBeGreaterThan(0);
  });
});

describe("templates - 多次加载互不干扰(clean up 验证)", () => {
  test("先加载 finance,重置后加载 compliance,计数正确", async () => {
    const financeIds = await loadTemplate("finance", "财务库", ctx);
    expect(financeIds.length).toBe(2);

    // 重置(store + 元数据;mock backend 换新实例,天然隔离)
    resetRulesStore();
    resetDb();
    ruleBusinessMetaStore.set({});
    backend = new MockWorkspaceBackend();
    const ws = await backend.createWorkspace({
      name: "test-workspace-2",
      owner_id: "tester",
    });
    ctx = { backend, workspaceId: ws.id };

    const complianceIds = await loadTemplate("compliance", "合规库", ctx);
    expect(complianceIds.length).toBe(2);
    const db = get(dbStore);
    expect(db.industry).toBe("compliance");
    expect(db.dbName).toBe("合规库");
  });
});
