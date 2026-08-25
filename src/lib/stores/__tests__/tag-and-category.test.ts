import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  tagStore,
  createTag,
  getTag,
  updateTag,
  deleteTag,
  tagsByName,
  type Tag,
} from "$lib/stores/tag";
import {
  categoryStore,
  createCategory,
  getCategory,
  updateCategory,
  deleteCategory,
  buildTree,
  categoryTree,
  childrenOf,
  ancestorsOf,
  getCategoryAndDescendants,
  moveCategory,
  type Category,
  type CategoryNode,
} from "$lib/stores/category";

// node 默认无 Storage 全局类,stub 一个让 vi.spyOn(Storage.prototype, ...) 能工作
// (测试默认走 browser=true 走 localStorage 分支,但不挂真实 window)
class StorageStub {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
}
vi.stubGlobal("Storage", StorageStub);

let localStorageMock: Map<string, string>;
let getItemSpy: any;
let setItemSpy: any;

beforeEach(() => {
  localStorageMock = new Map();
  getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
    const val = localStorageMock.get(key);
    return val === undefined ? null : val;
  });
  setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
    localStorageMock.set(key, value);
  });

  tagStore.set([]);
  categoryStore.set([]);
  localStorageMock.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tag CRUD
// ============================================================================

describe("Tag - createTag + getTag", () => {
  test("createTag 返回 id,getTag(id) 返回正确", () => {
    const id = createTag("紧急", "#ff0000");
    expect(id).toBeTruthy();
    expect(id.startsWith("tag_")).toBe(true);

    const tag = getTag(id);
    expect(tag).toBeDefined();
    expect(tag!.name).toBe("紧急");
    expect(tag!.color).toBe("#ff0000");
    expect(tag!.id).toBe(id);
    expect(tag!.createdAt).toBeTruthy();
    expect(new Date(tag!.createdAt).toString()).not.toBe("Invalid Date");
  });

  test("createTag 默认颜色 #6b7280", () => {
    const id = createTag("默认颜色标签");
    const tag = getTag(id);
    expect(tag!.color).toBe("#6b7280");
  });

  test("createTag 多个标签 id 不重复", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(createTag(`标签${i}`));
    }
    expect(ids.size).toBe(10);
  });

  test("getTag 不存在的 id 返回 undefined", () => {
    expect(getTag("不存在的id_xyz")).toBeUndefined();
  });

  test("getTag 空字符串返回 undefined", () => {
    createTag("t1");
    expect(getTag("")).toBeUndefined();
  });
});

describe("Tag - updateTag", () => {
  test("updateTag 修改 name", () => {
    const id = createTag("原名", "#000000");
    updateTag(id, { name: "新名" });
    const tag = getTag(id);
    expect(tag!.name).toBe("新名");
    expect(tag!.color).toBe("#000000");
  });

  test("updateTag 修改 color", () => {
    const id = createTag("t1", "#000000");
    updateTag(id, { color: "#ffffff" });
    const tag = getTag(id);
    expect(tag!.color).toBe("#ffffff");
    expect(tag!.name).toBe("t1");
  });

  test("updateTag 同时修改 name + color", () => {
    const id = createTag("旧", "#111111");
    updateTag(id, { name: "新", color: "#222222" });
    const tag = getTag(id);
    expect(tag!.name).toBe("新");
    expect(tag!.color).toBe("#222222");
  });

  test("updateTag 空 patch 不改变", () => {
    const id = createTag("不变", "#abcdef");
    updateTag(id, {});
    const tag = getTag(id);
    expect(tag!.name).toBe("不变");
    expect(tag!.color).toBe("#abcdef");
  });

  test("updateTag 不存在的 id 不报错也不影响现有", () => {
    const id = createTag("存在", "#123456");
    updateTag("不存在的", { name: "xxx" });
    expect(getTag(id)!.name).toBe("存在");
  });
});

describe("Tag - deleteTag", () => {
  test("deleteTag 删除后 getTag 返回 undefined", () => {
    const id = createTag("待删", "#ffffff");
    expect(getTag(id)).toBeDefined();
    deleteTag(id);
    expect(getTag(id)).toBeUndefined();
  });

  test("deleteTag 只删指定的,保留其他", () => {
    const id1 = createTag("t1");
    const id2 = createTag("t2");
    const id3 = createTag("t3");
    deleteTag(id2);
    expect(getTag(id1)).toBeDefined();
    expect(getTag(id2)).toBeUndefined();
    expect(getTag(id3)).toBeDefined();
  });

  test("deleteTag 不存在的 id 不报错", () => {
    createTag("t1");
    expect(() => deleteTag("不存在")).not.toThrow();
    expect(get(tagStore)).toHaveLength(1);
  });

  test("deleteTag 后 tagStore 数量减少", () => {
    const id1 = createTag("a");
    const id2 = createTag("b");
    expect(get(tagStore)).toHaveLength(2);
    deleteTag(id1);
    expect(get(tagStore)).toHaveLength(1);
    expect(get(tagStore)[0].id).toBe(id2);
  });
});

describe("Tag - tagsByName 模糊匹配", () => {
  beforeEach(() => {
    createTag("紧急任务", "#ff0000");
    createTag("高风险预警", "#ff9900");
    createTag("需要审批", "#00ff00");
    createTag("审批流程", "#0000ff");
    createTag("普通标签", "#888888");
  });

  test("空查询返回全部", () => {
    const derived = tagsByName("");
    expect(get(derived)).toHaveLength(5);
  });

  test("模糊匹配: '紧急' 命中 1 条", () => {
    const derived = tagsByName("紧急");
    const result = get(derived);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("紧急任务");
  });

  test("模糊匹配: '审批' 命中 2 条", () => {
    const derived = tagsByName("审批");
    const result = get(derived);
    expect(result).toHaveLength(2);
    expect(result.some((t: Tag) => t.name === "需要审批")).toBe(true);
    expect(result.some((t: Tag) => t.name === "审批流程")).toBe(true);
  });

  test("大小写不敏感匹配", () => {
    createTag("ABC标签", "#123");
    const derived = tagsByName("abc");
    const result = get(derived);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((t: Tag) => t.name === "ABC标签")).toBe(true);
  });

  test("未命中返回空数组", () => {
    const derived = tagsByName("完全不存在的关键词xyz");
    expect(get(derived)).toEqual([]);
  });

  test("部分匹配: '险' 命中 '高风险预警'", () => {
    const derived = tagsByName("险");
    const result = get(derived);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("高风险预警");
  });
});

// ============================================================================
// Category - 基础 CRUD
// ============================================================================

describe("Category - createCategory + getCategory", () => {
  test("createCategory 根分类返回 id, getCategory 正确", () => {
    const id = createCategory("诊疗规则", null, "🏥");
    expect(id).toBeTruthy();
    expect(id.startsWith("cat_")).toBe(true);

    const cat = getCategory(id);
    expect(cat).toBeDefined();
    expect(cat!.name).toBe("诊疗规则");
    expect(cat!.parentId).toBeNull();
    expect(cat!.icon).toBe("🏥");
    expect(cat!.order).toBe(0);
    expect(cat!.createdAt).toBeTruthy();
  });

  test("createCategory 默认 parentId=null, icon=undefined", () => {
    const id = createCategory("纯根分类");
    const cat = getCategory(id);
    expect(cat!.parentId).toBeNull();
    expect(cat!.icon).toBeUndefined();
    expect(cat!.order).toBe(0);
  });

  test("createCategory 多个同级 order 递增", () => {
    const id0 = createCategory("根0");
    const id1 = createCategory("根1");
    const id2 = createCategory("根2");
    expect(getCategory(id0)!.order).toBe(0);
    expect(getCategory(id1)!.order).toBe(1);
    expect(getCategory(id2)!.order).toBe(2);
  });

  test("createCategory 子分类 parentId 正确", () => {
    const rootId = createCategory("根");
    const childId = createCategory("子", rootId);
    const grandChildId = createCategory("孙", childId);

    expect(getCategory(rootId)!.parentId).toBeNull();
    expect(getCategory(childId)!.parentId).toBe(rootId);
    expect(getCategory(grandChildId)!.parentId).toBe(childId);
  });

  test("createCategory 子分类 order 独立计算", () => {
    const rootId = createCategory("根");
    createCategory("根2");

    const c1 = createCategory("子1", rootId);
    const c2 = createCategory("子2", rootId);
    expect(getCategory(c1)!.order).toBe(0);
    expect(getCategory(c2)!.order).toBe(1);
  });

  test("getCategory 不存在返回 undefined", () => {
    expect(getCategory("不存在")).toBeUndefined();
  });
});

describe("Category - 2 层树 (root → child) + buildTree", () => {
  test("buildTree 构造 2 层树正确", () => {
    const rootId = createCategory("诊疗", null, "🏥");
    const c1 = createCategory("急诊", rootId);
    const c2 = createCategory("门诊", rootId);

    const flat = get(categoryStore);
    const tree = buildTree(flat);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(rootId);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].id).toBe(c1);
    expect(tree[0].children[1].id).toBe(c2);
  });

  test("buildTree 按 order 排序", () => {
    const rootId = createCategory("根");
    const childIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      childIds.push(createCategory(`子${i}`, rootId));
    }

    const tree = buildTree(get(categoryStore));
    expect(tree[0].children).toHaveLength(5);
    tree[0].children.forEach((node, idx) => {
      expect(node.name).toBe(`子${idx}`);
      expect(node.order).toBe(idx);
    });
  });

  test("buildTree 多个根 + 各自子分类", () => {
    const r1 = createCategory("根1");
    const r2 = createCategory("根2");
    createCategory("根1子", r1);
    createCategory("根2子A", r2);
    createCategory("根2子B", r2);

    const tree = buildTree(get(categoryStore));
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[1].children).toHaveLength(2);
  });

  test("buildTree 空数组返回空树", () => {
    expect(buildTree([])).toEqual([]);
  });

  test("buildTree 孤儿节点(父不存在)作为根", () => {
    const orphan = createCategory("孤儿");
    updateCategory(orphan, { parentId: "不存在的父id" });

    const tree = buildTree(get(categoryStore));
    const orphanInTree = tree.find((n: CategoryNode) => n.id === orphan);
    expect(orphanInTree).toBeDefined();
  });

  test("categoryTree 派生 store 响应式", () => {
    createCategory("诊疗");
    expect(get(categoryTree)).toHaveLength(1);
    createCategory("合规");
    expect(get(categoryTree)).toHaveLength(2);
  });
});

describe("Category - childrenOf", () => {
  test("childrenOf(null) 返回所有根分类,按 order 排序", () => {
    createCategory("根2");
    createCategory("根0");
    createCategory("根1");
    createCategory("根0", "不存在");

    const roots = childrenOf(null);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    const rootOnly = roots.filter((c: Category) => c.parentId === null);
    expect(rootOnly).toHaveLength(roots.length);
    for (let i = 1; i < roots.length; i++) {
      expect(roots[i].order).toBeGreaterThanOrEqual(roots[i - 1].order);
    }
  });

  test("childrenOf(parentId) 返回直接子节点", () => {
    const rootId = createCategory("根");
    const c1 = createCategory("子1", rootId);
    const c2 = createCategory("子2", rootId);
    createCategory("孙", c1);

    const direct = childrenOf(rootId);
    expect(direct).toHaveLength(2);
    expect(direct.map((c: Category) => c.id)).toEqual([c1, c2]);
  });

  test("childrenOf(叶子节点id) 返回空数组", () => {
    const rootId = createCategory("根");
    const leaf = createCategory("叶子", rootId);
    expect(childrenOf(leaf)).toEqual([]);
  });
});

describe("Category - ancestorsOf", () => {
  test("ancestorsOf(child) 返回 [root, child] 顺序", () => {
    const rootId = createCategory("根");
    const childId = createCategory("子", rootId);

    const chain = ancestorsOf(childId);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(rootId);
    expect(chain[1].id).toBe(childId);
  });

  test("ancestorsOf(grandchild) 返回 [root, child, grandchild]", () => {
    const rootId = createCategory("诊疗", null, "🏥");
    const deptId = createCategory("急诊部", rootId);
    const subId = createCategory("发热门诊", deptId);

    const chain = ancestorsOf(subId);
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe(rootId);
    expect(chain[0].name).toBe("诊疗");
    expect(chain[1].id).toBe(deptId);
    expect(chain[1].name).toBe("急诊部");
    expect(chain[2].id).toBe(subId);
    expect(chain[2].name).toBe("发热门诊");
  });

  test("ancestorsOf(根节点) 返回 [根]", () => {
    const rootId = createCategory("根");
    const chain = ancestorsOf(rootId);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(rootId);
  });

  test("ancestorsOf(不存在) 返回空数组", () => {
    expect(ancestorsOf("不存在")).toEqual([]);
  });
});

describe("Category - getCategoryAndDescendants", () => {
  test("getCategoryAndDescendants(root) 返回 root + 所有子孙", () => {
    const rootId = createCategory("根");
    const c1 = createCategory("子1", rootId);
    const c2 = createCategory("子2", rootId);
    const gc1 = createCategory("孙1", c1);
    createCategory("其他根");

    const result = getCategoryAndDescendants(rootId);
    expect(result).toHaveLength(4);
    expect(result).toContain(rootId);
    expect(result).toContain(c1);
    expect(result).toContain(c2);
    expect(result).toContain(gc1);
  });

  test("getCategoryAndDescendants(叶子) 只返回自身", () => {
    const rootId = createCategory("根");
    const leaf = createCategory("叶", rootId);
    const result = getCategoryAndDescendants(leaf);
    expect(result).toEqual([leaf]);
  });

  test("getCategoryAndDescendants 第一个元素是自身", () => {
    const rootId = createCategory("根");
    createCategory("子", rootId);
    const result = getCategoryAndDescendants(rootId);
    expect(result[0]).toBe(rootId);
  });
});

describe("Category - moveCategory", () => {
  test("moveCategory 切换 parent 后 childrenOf 变化", () => {
    const r1 = createCategory("根1");
    const r2 = createCategory("根2");
    const moved = createCategory("被移动", r1);

    expect(childrenOf(r1).map((c: Category) => c.id)).toContain(moved);
    expect(childrenOf(r2).map((c: Category) => c.id)).not.toContain(moved);

    moveCategory(moved, r2);

    expect(childrenOf(r1).map((c: Category) => c.id)).not.toContain(moved);
    expect(childrenOf(r2).map((c: Category) => c.id)).toContain(moved);
    expect(getCategory(moved)!.parentId).toBe(r2);
  });

  test("moveCategory 移到根 (newParentId=null)", () => {
    const root = createCategory("原根");
    const moved = createCategory("要移到根", root);

    expect(getCategory(moved)!.parentId).toBe(root);
    moveCategory(moved, null);
    expect(getCategory(moved)!.parentId).toBeNull();
    expect(childrenOf(null).map((c: Category) => c.id)).toContain(moved);
  });

  test("moveCategory 到新父下 order = 新父下现有子数", () => {
    const r1 = createCategory("r1");
    const r2 = createCategory("r2");
    createCategory("r2子A", r2);
    createCategory("r2子B", r2);
    const moved = createCategory("移动", r1);

    moveCategory(moved, r2);
    expect(getCategory(moved)!.order).toBe(2);
  });

  test("moveCategory 防环:不能移到自身子孙下", () => {
    const root = createCategory("根");
    const child = createCategory("子", root);
    const grand = createCategory("孙", child);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    moveCategory(root, grand);
    expect(warnSpy).toHaveBeenCalled();
    expect(getCategory(root)!.parentId).toBeNull();
    warnSpy.mockRestore();
  });

  test("moveCategory 到自身同级再回来,数据正确", () => {
    const r1 = createCategory("r1");
    const r2 = createCategory("r2");
    const moved = createCategory("moved", r1);

    moveCategory(moved, r2);
    expect(getCategory(moved)!.parentId).toBe(r2);
    moveCategory(moved, r1);
    expect(getCategory(moved)!.parentId).toBe(r1);
  });
});

describe("Category - deleteCategory", () => {
  test("deleteCategory 根删除后 undefined", () => {
    const id = createCategory("待删");
    expect(getCategory(id)).toBeDefined();
    deleteCategory(id);
    expect(getCategory(id)).toBeUndefined();
  });

  test("deleteCategory 级联删除子孙", () => {
    const rootId = createCategory("诊疗");
    const childId = createCategory("急诊", rootId);
    const grandId = createCategory("发热", childId);
    const otherId = createCategory("合规");

    deleteCategory(rootId);

    expect(getCategory(rootId)).toBeUndefined();
    expect(getCategory(childId)).toBeUndefined();
    expect(getCategory(grandId)).toBeUndefined();
    expect(getCategory(otherId)).toBeDefined();
  });

  test("deleteCategory 后 categoryStore 数量正确", () => {
    const r1 = createCategory("r1");
    createCategory("r1c1", r1);
    createCategory("r1c2", r1);
    const r2 = createCategory("r2");

    expect(get(categoryStore)).toHaveLength(4);
    deleteCategory(r1);
    expect(get(categoryStore)).toHaveLength(1);
    expect(getCategory(r2)).toBeDefined();
  });

  test("deleteCategory 叶子不影响其他", () => {
    const root = createCategory("根");
    const leaf1 = createCategory("叶1", root);
    const leaf2 = createCategory("叶2", root);

    deleteCategory(leaf1);
    expect(getCategory(leaf1)).toBeUndefined();
    expect(getCategory(leaf2)).toBeDefined();
    expect(getCategory(root)).toBeDefined();
    expect(childrenOf(root)).toHaveLength(1);
  });
});

describe("Category - updateCategory", () => {
  test("updateCategory 修改 name + icon", () => {
    const id = createCategory("原名", null, "🔴");
    updateCategory(id, { name: "新名", icon: "🟢" });
    const cat = getCategory(id);
    expect(cat!.name).toBe("新名");
    expect(cat!.icon).toBe("🟢");
  });

  test("updateCategory 修改 order", () => {
    const id = createCategory("c");
    expect(getCategory(id)!.order).toBe(0);
    updateCategory(id, { order: 99 });
    expect(getCategory(id)!.order).toBe(99);
  });
});

// ============================================================================
// localStorage mock 验证 (每个测试独立)
// ============================================================================

describe("localStorage mock - 每个测试独立不污染", () => {
  test("第一个测试:setItemSpy 正常工作,手动同步 tagStore 内容", () => {
    createTag("test独立1");
    const tags = get(tagStore);
    Storage.prototype.setItem("evorule-console-cloud:tags", JSON.stringify(tags));
    expect(setItemSpy).toHaveBeenCalled();
    const calls = setItemSpy.mock.calls.filter(
      (c: any[]) => c[0] === "evorule-console-cloud:tags"
    );
    expect(calls.length).toBeGreaterThan(0);
    const stored = JSON.parse(calls[calls.length - 1][1]);
    expect(stored.some((t: Tag) => t.name === "test独立1")).toBe(true);
  });

  test("第二个测试:localStorageMock 已重置,看不到第一个测试的数据", () => {
    const all = get(tagStore);
    expect(all).toEqual([]);
    const raw = localStorageMock.get("evorule-console-cloud:tags");
    expect(raw).toBeUndefined();
    expect(getItemSpy).toBeDefined();
    expect(setItemSpy).toBeDefined();
  });

  test("分类手动写入 mock localStorage 内容正确", () => {
    createCategory("分类持久化测试");
    const cats = get(categoryStore);
    Storage.prototype.setItem("evorule-console-cloud:categories", JSON.stringify(cats));
    const catCalls = setItemSpy.mock.calls.filter(
      (c: any[]) => c[0] === "evorule-console-cloud:categories"
    );
    expect(catCalls.length).toBeGreaterThan(0);
    const storedCats = JSON.parse(catCalls[catCalls.length - 1][1]);
    expect(storedCats.length).toBe(1);
    expect(storedCats[0].name).toBe("分类持久化测试");
  });

  test("getItemSpy 可从 mock 读取正确", () => {
    localStorageMock.set("evorule-console-cloud:tags", JSON.stringify([{id: "t1"}]));
    const result = Storage.prototype.getItem("evorule-console-cloud:tags");
    expect(getItemSpy).toHaveBeenCalledWith("evorule-console-cloud:tags");
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).some((t: any) => t.id === "t1")).toBe(true);
  });
});
