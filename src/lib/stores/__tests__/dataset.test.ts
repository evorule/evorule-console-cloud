// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// dataset store 单测 — CRUD + 4 状态机 + 级联清理
//
// 运行: npx vitest run src/lib/stores/__tests__/dataset.test.ts
//
// 关联设计:P03_DATASET_DESIGN.md §9.1 + §9.2(状态机测试)
//
// 说明:node 环境 browser=false,store 初始化为空且不持久化,纯内存测试。
//   每个 test 前 reset datasetStore 到空状态。

import { describe, test, expect, beforeEach } from "vitest";
import {
  datasetStore,
  createDataset,
  updateDataset,
  deleteDataset,
  duplicateDataset,
  getDataset,
  startTesting,
  markReady,
  publishDataset,
  revertToDraft,
  removeRuleFromAllDatasets,
  removeTagFromAllDatasets,
  clearCategoryFromAllDatasets,
} from "../dataset";

beforeEach(() => {
  // reset store 到空状态(每个 test 隔离)
  datasetStore.set([]);
});

// ============================================================================
// CRUD
// ============================================================================

describe("CRUD", () => {
  test("createDataset 创建草稿数据集,返回 ID", () => {
    const id = createDataset("心内科规则集", "描述", ["r1", "r2"]);
    expect(id).toBeTruthy();
    expect(id.startsWith("dataset_")).toBe(true);

    const ds = getDataset(id);
    expect(ds).toBeDefined();
    expect(ds!.name).toBe("心内科规则集");
    expect(ds!.description).toBe("描述");
    expect(ds!.ruleIds).toEqual(["r1", "r2"]);
    expect(ds!.status).toBe("draft");
    expect(ds!.paramOverrides).toEqual([]);
    expect(ds!.tagIds).toEqual([]);
    expect(ds!.categoryId).toBeNull();
    expect(ds!.workspaceId).toBe("default");
    expect(ds!.lastTestedAt).toBeNull();
    expect(ds!.publishedVersion).toBeNull();
    expect(ds!.createdAt).toBeTruthy();
    expect(ds!.updatedAt).toBeTruthy();
  });

  test("createDataset 默认参数:tagIds 空 categoryId null", () => {
    const id = createDataset("n", "", ["r1"]);
    const ds = getDataset(id);
    expect(ds!.tagIds).toEqual([]);
    expect(ds!.categoryId).toBeNull();
  });

  test("createDataset 带标签和分类", () => {
    const id = createDataset("n", "", ["r1"], ["tag1", "tag2"], "cat1");
    const ds = getDataset(id);
    expect(ds!.tagIds).toEqual(["tag1", "tag2"]);
    expect(ds!.categoryId).toBe("cat1");
  });

  test("updateDataset 更新名称/描述/规则列表", () => {
    const id = createDataset("原名", "原描述", ["r1"]);
    updateDataset(id, {
      name: "新名",
      description: "新描述",
      ruleIds: ["r1", "r2", "r3"],
    });
    const ds = getDataset(id);
    expect(ds!.name).toBe("新名");
    expect(ds!.description).toBe("新描述");
    expect(ds!.ruleIds).toEqual(["r1", "r2", "r3"]);
  });

  test("updateDataset 更新参数覆盖 + 标签 + 分类", () => {
    const id = createDataset("n", "", ["r1"]);
    const overrides = [{ ruleId: "r1", patch: [{ op: "replace" as const, path: "/a", value: 1 }] }];
    updateDataset(id, {
      paramOverrides: overrides,
      tagIds: ["t1"],
      categoryId: "c1",
    });
    const ds = getDataset(id);
    expect(ds!.paramOverrides).toEqual(overrides);
    expect(ds!.tagIds).toEqual(["t1"]);
    expect(ds!.categoryId).toBe("c1");
  });

  test("deleteDataset 删除数据集", () => {
    const id = createDataset("n", "", ["r1"]);
    expect(getDataset(id)).toBeDefined();
    deleteDataset(id);
    expect(getDataset(id)).toBeUndefined();
  });

  test("duplicateDataset 深拷贝,新 ID,状态回 draft,清空测试/发布信息", () => {
    const id = createDataset("原集", "", ["r1"]);
    startTesting(id);
    markReady(id);
    publishDataset(id, 5);

    const copyId = duplicateDataset(id);
    expect(copyId).not.toBe(id);

    const copy = getDataset(copyId);
    expect(copy).toBeDefined();
    expect(copy!.name).toBe("原集 (副本)");
    expect(copy!.ruleIds).toEqual(["r1"]);
    expect(copy!.status).toBe("draft"); // 状态回退
    expect(copy!.lastTestedAt).toBeNull(); // 清空
    expect(copy!.publishedVersion).toBeNull(); // 清空
    // createdAt 不校验不等(毫秒精度可能相同,非行为关键)
  });

  test("duplicateDataset 不存在的 ID → 抛错", () => {
    expect(() => duplicateDataset("nonexistent")).toThrow();
  });
});

// ============================================================================
// 状态机: draft → testing → ready → published
// ============================================================================

describe("状态机 - 合法转换", () => {
  test("draft → testing → ready → published 完整流转", () => {
    const id = createDataset("测试集", "", ["r1"]);
    expect(getDataset(id)!.status).toBe("draft");

    startTesting(id);
    expect(getDataset(id)!.status).toBe("testing");

    markReady(id);
    expect(getDataset(id)!.status).toBe("ready");
    expect(getDataset(id)!.lastTestedAt).not.toBeNull();

    publishDataset(id, 1);
    expect(getDataset(id)!.status).toBe("published");
    expect(getDataset(id)!.publishedVersion).toBe(1);
  });

  test("markReady 可传入自定义 lastTestedAt", () => {
    const id = createDataset("n", "", ["r1"]);
    startTesting(id);
    const customTs = "2026-01-01T00:00:00Z";
    markReady(id, customTs);
    expect(getDataset(id)!.lastTestedAt).toBe(customTs);
  });
});

describe("状态机 - 非法转换被拒绝", () => {
  test("draft 不能直接 publish(需先 testing → ready)", () => {
    const id = createDataset("n", "", ["r1"]);
    publishDataset(id, 1);
    expect(getDataset(id)!.status).toBe("draft"); // 状态不变
    expect(getDataset(id)!.publishedVersion).toBeNull();
  });

  test("draft 不能直接 markReady(需先 testing)", () => {
    const id = createDataset("n", "", ["r1"]);
    markReady(id);
    expect(getDataset(id)!.status).toBe("draft");
    expect(getDataset(id)!.lastTestedAt).toBeNull();
  });

  test("testing 不能直接 publish(需先 ready)", () => {
    const id = createDataset("n", "", ["r1"]);
    startTesting(id);
    publishDataset(id, 1);
    expect(getDataset(id)!.status).toBe("testing");
    expect(getDataset(id)!.publishedVersion).toBeNull();
  });

  test("ready 不能 startTesting(只能 draft → testing)", () => {
    const id = createDataset("n", "", ["r1"]);
    startTesting(id);
    markReady(id);
    startTesting(id); // ready → testing 非法
    expect(getDataset(id)!.status).toBe("ready");
  });

  test("published 不能 publishDataset(已发布)", () => {
    const id = createDataset("n", "", ["r1"]);
    startTesting(id);
    markReady(id);
    publishDataset(id, 1);
    publishDataset(id, 2); // 重复发布非法
    expect(getDataset(id)!.status).toBe("published");
    expect(getDataset(id)!.publishedVersion).toBe(1); // 版本不变
  });
});

describe("状态机 - revertToDraft", () => {
  test("published → draft(revertToDraft)", () => {
    const id = createDataset("n", "", ["r1"]);
    startTesting(id);
    markReady(id);
    publishDataset(id, 1);
    expect(getDataset(id)!.status).toBe("published");

    revertToDraft(id);
    expect(getDataset(id)!.status).toBe("draft");
  });

  test("任意状态都能 revertToDraft(testing/ready/published)", () => {
    const id1 = createDataset("a", "", ["r1"]);
    startTesting(id1);
    revertToDraft(id1);
    expect(getDataset(id1)!.status).toBe("draft");

    const id2 = createDataset("b", "", ["r1"]);
    startTesting(id2);
    markReady(id2);
    revertToDraft(id2);
    expect(getDataset(id2)!.status).toBe("draft");
  });
});

// ============================================================================
// 级联清理
// ============================================================================

describe("removeRuleFromAllDatasets - 规则删除级联", () => {
  test("从所有引用数据集移除规则 ID + 参数覆盖", () => {
    const id1 = createDataset("集1", "", ["r1", "r2", "r3"]);
    const id2 = createDataset("集2", "", ["r2"]);
    const id3 = createDataset("集3", "", ["r4"]); // 不含 r2

    updateDataset(id1, {
      paramOverrides: [
        { ruleId: "r2", patch: [{ op: "replace", path: "/a", value: 1 }] },
      ],
    });

    const affected = removeRuleFromAllDatasets("r2");

    expect(affected).toContain(id1);
    expect(affected).toContain(id2);
    expect(affected).not.toContain(id3);
    expect(affected).toHaveLength(2);

    // id1 移除 r2 + 其参数覆盖
    expect(getDataset(id1)!.ruleIds).toEqual(["r1", "r3"]);
    expect(getDataset(id1)!.paramOverrides).toEqual([]);

    // id2 移除 r2(空了)
    expect(getDataset(id2)!.ruleIds).toEqual([]);

    // id3 不受影响
    expect(getDataset(id3)!.ruleIds).toEqual(["r4"]);
  });

  test("published 数据集规则被删 → 自动回退 draft", () => {
    const id = createDataset("已发布集", "", ["r1"]);
    startTesting(id);
    markReady(id);
    publishDataset(id, 1);
    expect(getDataset(id)!.status).toBe("published");

    const affected = removeRuleFromAllDatasets("r1");
    expect(affected).toContain(id);
    expect(getDataset(id)!.status).toBe("draft"); // 自动回退
    expect(getDataset(id)!.ruleIds).toEqual([]);
  });

  test("draft 数据集规则被删 → 状态不变(仍 draft)", () => {
    const id = createDataset("草稿集", "", ["r1", "r2"]);
    removeRuleFromAllDatasets("r1");
    expect(getDataset(id)!.status).toBe("draft");
    expect(getDataset(id)!.ruleIds).toEqual(["r2"]);
  });

  test("规则不被任何数据集引用 → 返回空数组", () => {
    createDataset("集1", "", ["r1"]);
    const affected = removeRuleFromAllDatasets("r_orphan");
    expect(affected).toEqual([]);
  });
});

describe("removeTagFromAllDatasets - 标签删除级联", () => {
  test("从所有数据集 tagIds 移除该标签", () => {
    const id1 = createDataset("集1", "", ["r1"], ["t1", "t2"]);
    const id2 = createDataset("集2", "", ["r2"], ["t2", "t3"]);

    removeTagFromAllDatasets("t2");

    expect(getDataset(id1)!.tagIds).toEqual(["t1"]);
    expect(getDataset(id2)!.tagIds).toEqual(["t3"]);
  });

  test("不改变数据集状态", () => {
    const id = createDataset("集", "", ["r1"], ["t1"]);
    startTesting(id);
    removeTagFromAllDatasets("t1");
    expect(getDataset(id)!.status).toBe("testing"); // 状态不变
  });
});

describe("clearCategoryFromAllDatasets - 分类删除级联", () => {
  test("引用该分类的数据集 categoryId 置 null", () => {
    const id1 = createDataset("集1", "", ["r1"], [], "catA");
    const id2 = createDataset("集2", "", ["r2"], [], "catB");

    clearCategoryFromAllDatasets("catA");

    expect(getDataset(id1)!.categoryId).toBeNull();
    expect(getDataset(id2)!.categoryId).toBe("catB"); // 不受影响
  });

  test("不改变数据集状态", () => {
    const id = createDataset("集", "", ["r1"], [], "catA");
    startTesting(id);
    markReady(id);
    clearCategoryFromAllDatasets("catA");
    expect(getDataset(id)!.status).toBe("ready"); // 状态不变
  });
});
