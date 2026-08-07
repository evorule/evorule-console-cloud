// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// json-patch 单测 — applyJsonPatch 的 replace/add/remove + 嵌套路径 + 数组 + 容错
//
// 运行: npx vitest run src/lib/utils/__tests__/json-patch.test.ts
//
// 关联设计:P03_DATASET_DESIGN.md §8(json-patch.test.ts)+ §4.7

import { describe, test, expect } from "vitest";
import { applyJsonPatch } from "../json-patch";
import type { JsonPatch } from "$lib/types/json-patch";

describe("applyJsonPatch - replace", () => {
  test("替换嵌套路径值 /params/threshold", () => {
    const json = JSON.stringify({ params: { threshold: 100, name: "x" } });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/params/threshold", value: 200 },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.threshold).toBe(200);
    expect(result.params.name).toBe("x"); // 其他字段不变
  });

  test("替换数组元素 /params/arr/0", () => {
    const json = JSON.stringify({ params: { arr: [1, 2, 3] } });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/params/arr/0", value: 99 },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.arr).toEqual([99, 2, 3]);
  });

  test("替换整个根对象 path='/'", () => {
    const json = JSON.stringify({ a: 1 });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/", value: { b: 2 } },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result).toEqual({ b: 2 });
  });

  test("替换不存在的路径(父对象存在)→ 新增该 key", () => {
    const json = JSON.stringify({ params: {} });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/params/newKey", value: "val" },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    // replace 对象 key 时行为等同 set(存在则覆盖,不存在则新增)
    expect(result.params.newKey).toBe("val");
  });
});

describe("applyJsonPatch - add", () => {
  test("add 到对象新 key", () => {
    const json = JSON.stringify({ params: { threshold: 100 } });
    const patches: JsonPatch[] = [
      { op: "add", path: "/params/newField", value: "hello" },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.newField).toBe("hello");
    expect(result.params.threshold).toBe(100);
  });

  test("add 到数组末尾 path='/params/arr/-'", () => {
    const json = JSON.stringify({ params: { arr: [1, 2] } });
    const patches: JsonPatch[] = [
      { op: "add", path: "/params/arr/-", value: 3 },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.arr).toEqual([1, 2, 3]);
  });

  test("add 到数组指定索引(插入)", () => {
    const json = JSON.stringify({ params: { arr: [1, 3] } });
    const patches: JsonPatch[] = [
      { op: "add", path: "/params/arr/1", value: 2 },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.arr).toEqual([1, 2, 3]);
  });

  test("add 覆盖对象已存在 key", () => {
    const json = JSON.stringify({ params: { threshold: 100 } });
    const patches: JsonPatch[] = [
      { op: "add", path: "/params/threshold", value: 200 },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.threshold).toBe(200);
  });
});

describe("applyJsonPatch - remove", () => {
  test("remove 对象 key", () => {
    const json = JSON.stringify({ params: { threshold: 100, name: "x" } });
    const patches: JsonPatch[] = [
      { op: "remove", path: "/params/name" },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.name).toBeUndefined();
    expect(result.params.threshold).toBe(100);
  });

  test("remove 数组元素(索引)", () => {
    const json = JSON.stringify({ params: { arr: [1, 2, 3] } });
    const patches: JsonPatch[] = [
      { op: "remove", path: "/params/arr/1" },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.arr).toEqual([1, 3]);
  });

  test("remove 不存在的 key → 无变化(不抛错)", () => {
    const json = JSON.stringify({ params: { threshold: 100 } });
    const patches: JsonPatch[] = [
      { op: "remove", path: "/params/nonexistent" },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.threshold).toBe(100);
  });
});

describe("applyJsonPatch - 多 patch 组合", () => {
  test("依次应用 replace + add + remove", () => {
    const json = JSON.stringify({
      params: { threshold: 100, name: "old", tags: ["a"] },
    });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/params/threshold", value: 200 },
      { op: "add", path: "/params/newField", value: "new" },
      { op: "remove", path: "/params/name" },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result.params.threshold).toBe(200);
    expect(result.params.newField).toBe("new");
    expect(result.params.name).toBeUndefined();
    expect(result.params.tags).toEqual(["a"]); // 未触碰
  });

  test("数据集参数覆盖真实场景:体温阈值 37.5 → 38", () => {
    // 模拟规则 JSON:急诊用 38°C,普通用 37.5°C
    const ruleJson = JSON.stringify({
      id: "fever_check",
      branch: [{ condition: { field: "temperature", op: ">", value: 37.5 } }],
    });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/branch/0/condition/value", value: 38 },
    ];
    const result = JSON.parse(applyJsonPatch(ruleJson, patches));
    expect(result.branch[0].condition.value).toBe(38);
  });
});

describe("applyJsonPatch - 容错", () => {
  test("空 patches 数组 → 返回原字符串", () => {
    const json = '{"a":1}';
    expect(applyJsonPatch(json, [])).toBe(json);
  });

  test("null/undefined patches → 返回原字符串", () => {
    const json = '{"a":1}';
    expect(applyJsonPatch(json, null as unknown as JsonPatch[])).toBe(json);
    expect(applyJsonPatch(json, undefined as unknown as JsonPatch[])).toBe(json);
  });

  test("非法 JSON 字符串 → 返回原字符串(不抛错)", () => {
    const bad = "{not valid json}";
    const patches: JsonPatch[] = [
      { op: "replace", path: "/a", value: 2 },
    ];
    expect(applyJsonPatch(bad, patches)).toBe(bad);
  });

  test("不修改原 JSON 字符串(返回新字符串)", () => {
    const original = '{"a":{"b":1}}';
    const patches: JsonPatch[] = [
      { op: "replace", path: "/a/b", value: 2 },
    ];
    applyJsonPatch(original, patches);
    expect(original).toBe('{"a":{"b":1}}'); // 原字符串不变
  });

  test("RFC 6902 转义:~1 → /, ~0 → ~", () => {
    const json = JSON.stringify({ "a/b": 1, "c~d": 2 });
    const patches: JsonPatch[] = [
      { op: "replace", path: "/a~1b", value: 99 },
      { op: "replace", path: "/c~0d", value: 88 },
    ];
    const result = JSON.parse(applyJsonPatch(json, patches));
    expect(result["a/b"]).toBe(99);
    expect(result["c~d"]).toBe(88);
  });
});
