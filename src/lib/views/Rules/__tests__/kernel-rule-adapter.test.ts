// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 内核规则适配层单测
//
// 运行: npx vitest run src/lib/views/Rules/__tests__/kernel-rule-adapter.test.ts
//
// 测试范围:
//   - wrapAsKernelTransform:业务视图 → 内核 transform 数组
//     * 单条件 + 单动作 → 一个 branch + 兜底
//     * 多分支 → 多个 branch + 兜底
//     * 无条件有动作 → 直接 action step + 兜底
//     * 空业务视图 → 仅兜底(最简合法规则)
//     * G6 兜底:末条必须是 branch + all([])
//   - unwrapKernelTransform:内核 transform → 业务视图(反向)
//   - 双向对称性(关键场景)
//   - 与内核 RuleValidator 的兼容性(产出 JSON 通过 G1-G7)
//   - buildKernelRuleContent:打包为 addRule 用的 content 字符串
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.3 + 内核 ruleValidator.d.ts

import { describe, test, expect } from "vitest";
import { RuleValidator } from "$lib/kernel";
import {
  wrapAsKernelTransform,
  unwrapKernelTransform,
  buildKernelRuleContent,
  type BusinessRuleShape,
  type KernelRuleJson,
  type KernelTransformStep,
} from "../kernel-rule-adapter";

// === 辅助:断言"末条 step 是 G6 兜底 branch + all(inner:[])"(UV-074:inner 口径) ===
function expectG6Fallback(kernel: KernelRuleJson): void {
  const last = kernel.transform[kernel.transform.length - 1];
  expect(last).toBeDefined();
  expect(last.type).toBe("branch");
  const domain = last.params.domain as Record<string, unknown>;
  expect(domain.type).toBe("all");
  expect(domain.inner).toEqual([]);
}

// === 辅助:用内核 RuleValidator 校验,断言全部门禁通过 ===
function expectPassesKernelGates(kernel: KernelRuleJson): void {
  const result = RuleValidator.validate(JSON.stringify(kernel));
  if (!result.valid) {
    // 输出详细错误,便于调试
    console.error("内核门禁失败:", result.errors);
  }
  expect(result.valid).toBe(true);
}

describe("kernel-rule-adapter — wrapAsKernelTransform 单条件 + 单动作", () => {
  test("单条件 + 单动作 → 一个 branch + G6 兜底", () => {
    const business: BusinessRuleShape = {
      condition: {
        domain: "lt",
        path: "__exec__.payload.amount",
        value: 10000,
      },
      action: {
        type: "require_approval",
        params: { role: "CFO", channel: "IM" },
      },
    };
    const kernel = wrapAsKernelTransform(business);

    // 应有 2 条 step:1 业务 branch + 1 兜底
    expect(kernel.transform).toHaveLength(2);
    expect(kernel.transform[0].type).toBe("branch");
    expect(kernel.transform[0].params.on_true).toHaveLength(1);
    expect(kernel.transform[0].params.on_false).toEqual([]);
    expectG6Fallback(kernel);
  });

  test("条件 domain 缺失 → 映射为 exists(业务语义兜底)", () => {
    const business: BusinessRuleShape = {
      condition: { path: "__exec__.payload.amount", value: 100 },
      action: { type: "log", params: {} },
    };
    const kernel = wrapAsKernelTransform(business);
    const domain = kernel.transform[0].params.domain as Record<
      string,
      unknown
    >;
    expect(domain.type).toBe("exists");
  });

  test("条件 domain 不在白名单(含 gt)→ 映射为 exists", () => {
    // gt 不在内核 G4 允许列表(只有 eq/lt/exists/instruction/all/not)
    // 业务层用 lt + on_false 表达"大于"语义(见 template-finance.ts)
    const business: BusinessRuleShape = {
      condition: { domain: "gt", value: 100 },
      action: { type: "log" },
    };
    const kernel = wrapAsKernelTransform(business);
    const domain = kernel.transform[0].params.domain as Record<
      string,
      unknown
    >;
    expect(domain.type).toBe("exists");
  });

  test("条件 domain=between(不在白名单)→ 映射为 exists", () => {
    const business: BusinessRuleShape = {
      condition: { domain: "between", value: 100 },
      action: { type: "log" },
    };
    const kernel = wrapAsKernelTransform(business);
    const domain = kernel.transform[0].params.domain as Record<
      string,
      unknown
    >;
    expect(domain.type).toBe("exists");
  });

  test("业务动作 type 不是元指令 → 包成 exists(__io_results__.<io_type>) 内层 branch(G3 合规)", () => {
    const business: BusinessRuleShape = {
      condition: { domain: "exists", path: "x" },
      action: { type: "require_approval", params: { role: "CFO" } },
    };
    const kernel = wrapAsKernelTransform(business);
    const onTrue = kernel.transform[0].params.on_true as KernelTransformStep[];
    // on_true[0] 应是包装 branch(exists __io_results__ 复数),不是裸 io_request
    expect(onTrue[0].type).toBe("branch");
    const wrapDomain = onTrue[0].params.domain as Record<string, unknown>;
    expect(wrapDomain.type).toBe("exists");
    expect(wrapDomain.path).toBe("__exec__.payload.__io_results__.call_external");
    // 内层 io_request 在 on_false
    const innerOnFalse = onTrue[0].params.on_false as KernelTransformStep[];
    expect(innerOnFalse[0].type).toBe("io_request");
    expect(innerOnFalse[0].params.prompt).toBe("require_approval");
    expect(innerOnFalse[0].params.role).toBe("CFO");
  });

  test("业务动作 meta=set(非 io_request)→ 归一化为内核三件套 attr/operation/value,不包 branch", () => {
    const business: BusinessRuleShape = {
      condition: { domain: "exists", path: "x" },
      action: { meta: "set", params: { key: "flag", value: true } },
    };
    const kernel = wrapAsKernelTransform(business);
    const onTrue = kernel.transform[0].params.on_true as KernelTransformStep[];
    expect(onTrue[0].type).toBe("set");
    // 业务口径 key → 内核 attr;operation 缺省补 set(W2.1 params 完备性对齐)
    expect(onTrue[0].params).toEqual({ attr: "flag", operation: "set", value: true });
  });

  test("业务动作 meta=io_request → 也包成 exists(__io_results__.<io_type>) branch", () => {
    const business: BusinessRuleShape = {
      condition: { domain: "exists", path: "x" },
      action: { meta: "io_request", params: { prompt: "notify" } },
    };
    const kernel = wrapAsKernelTransform(business);
    const onTrue = kernel.transform[0].params.on_true as KernelTransformStep[];
    expect(onTrue[0].type).toBe("branch");
    const wrapDomain = onTrue[0].params.domain as Record<string, unknown>;
    expect(wrapDomain.path).toBe("__exec__.payload.__io_results__.call_external");
  });
});

describe("kernel-rule-adapter — wrapAsKernelTransform 多分支", () => {
  test("branch 数组 → 逐分支 branch step + G6 兜底", () => {
    const business: BusinessRuleShape = {
      branch: [
        {
          condition: { domain: "lt", path: "amount", value: 5000 },
          action: { type: "auto_approve" },
        },
        {
          condition: { domain: "lt", path: "amount", value: 10000 },
          action: { type: "manager_approve" },
        },
      ],
    };
    const kernel = wrapAsKernelTransform(business);

    // 2 业务 branch + 1 兜底
    expect(kernel.transform).toHaveLength(3);
    expect(kernel.transform[0].type).toBe("branch");
    expect(kernel.transform[1].type).toBe("branch");
    expectG6Fallback(kernel);
  });

  test("分支无 condition → 用 all([]) 兜底 domain", () => {
    const business: BusinessRuleShape = {
      branch: [
        {
          action: { type: "default_action" },
        },
      ],
    };
    const kernel = wrapAsKernelTransform(business);
    const domain = kernel.transform[0].params.domain as Record<
      string,
      unknown
    >;
    expect(domain.type).toBe("all");
  });
});

describe("kernel-rule-adapter — wrapAsKernelTransform 边界情况", () => {
  test("无条件有动作(业务 type)→ 包成 exists(__io_results__.<io_type>) branch + 兜底", () => {
    const business: BusinessRuleShape = {
      action: { type: "log", params: { msg: "hello" } },
    };
    const kernel = wrapAsKernelTransform(business);
    // 1 包装 branch + 1 兜底
    expect(kernel.transform).toHaveLength(2);
    expect(kernel.transform[0].type).toBe("branch");
    const wrapDomain = kernel.transform[0].params.domain as Record<
      string,
      unknown
    >;
    expect(wrapDomain.path).toBe("__exec__.payload.__io_results__.call_external");
    expectG6Fallback(kernel);
  });

  test("无条件有动作(meta=set)→ 归一化 set step + 兜底", () => {
    const business: BusinessRuleShape = {
      action: { meta: "set", params: { key: "k", value: 1 } },
    };
    const kernel = wrapAsKernelTransform(business);
    expect(kernel.transform).toHaveLength(2);
    expect(kernel.transform[0].type).toBe("set");
    expectG6Fallback(kernel);
  });

  test("只有条件无动作 → branch 空动作 + 兜底", () => {
    const business: BusinessRuleShape = {
      condition: { domain: "exists", path: "x" },
    };
    const kernel = wrapAsKernelTransform(business);
    expect(kernel.transform).toHaveLength(2);
    expect(kernel.transform[0].type).toBe("branch");
    expect(kernel.transform[0].params.on_true).toEqual([]);
    expectG6Fallback(kernel);
  });

  test("空业务视图 → 仅 G6 兜底(最简合法规则)", () => {
    const business: BusinessRuleShape = {};
    const kernel = wrapAsKernelTransform(business);
    expect(kernel.transform).toHaveLength(1);
    expectG6Fallback(kernel);
  });
});

describe("kernel-rule-adapter — 与内核 RuleValidator 兼容性", () => {
  test("单条件 + 单动作 → 通过 G1-G7", () => {
    const kernel = wrapAsKernelTransform({
      condition: {
        domain: "lt",
        path: "__exec__.payload.amount",
        value: 10000,
      },
      action: {
        type: "require_approval",
        params: { role: "CFO" },
      },
    });
    expectPassesKernelGates(kernel);
  });

  test("多分支 → 通过 G1-G7", () => {
    const kernel = wrapAsKernelTransform({
      branch: [
        {
          condition: { domain: "lt", path: "amount", value: 5000 },
          action: { meta: "set", params: { key: "auto", value: true } },
        },
        {
          condition: { domain: "lt", path: "amount", value: 10000 },
          action: { meta: "set", params: { key: "mgr", value: true } },
        },
      ],
    });
    expectPassesKernelGates(kernel);
  });

  test("空业务视图 → 通过 G1-G7(最简合法规则)", () => {
    const kernel = wrapAsKernelTransform({});
    expectPassesKernelGates(kernel);
  });

  test("无条件有动作(业务 type → io_request)→ 通过 G1-G7", () => {
    const kernel = wrapAsKernelTransform({
      action: { type: "log", params: { msg: "hello" } },
    });
    expectPassesKernelGates(kernel);
  });

  test("单条件 + meta=set 动作 → 通过 G1-G7", () => {
    const kernel = wrapAsKernelTransform({
      condition: { domain: "exists", path: "__exec__.payload.x" },
      action: { meta: "set", params: { key: "flag", value: true } },
    });
    expectPassesKernelGates(kernel);
  });
});

describe("kernel-rule-adapter — unwrapKernelTransform 反向解析", () => {
  test("单 branch + 兜底(含 G3 io_results 包装)→ 提取 condition + action", () => {
    // 这是 wrapAsKernelTransform 产出的典型结构
    const kernel: KernelRuleJson = {
      transform: [
        {
          type: "branch",
          params: {
            domain: {
              type: "lt",
              path: "__exec__.payload.amount",
              value: 10000,
            },
            on_true: [
              // G3 包装 branch(复数 __io_results__ 口径)
              {
                type: "branch",
                params: {
                  domain: {
                    type: "exists",
                    path: "__exec__.payload.__io_results__.call_external",
                  },
                  on_true: [],
                  on_false: [
                    {
                      type: "io_request",
                      params: {
                        io_type: "call_external",
                        prompt: "require_approval",
                        role: "CFO",
                      },
                    },
                  ],
                },
              },
            ],
            on_false: [],
          },
        },
        {
          type: "branch",
          params: { domain: { type: "all", inner: [] }, on_true: [] },
        },
      ],
    };
    const business = unwrapKernelTransform(kernel);
    expect(business.condition).toBeDefined();
    expect(business.condition?.domain).toBe("lt");
    expect(business.condition?.value).toBe(10000);
    expect(business.action).toBeDefined();
    // 从 G3 包装 branch 中提取 io_request
    expect(business.action?.meta).toBe("io_request");
    expect(business.action?.type).toBe("require_approval");
    expect(business.action?.params?.role).toBe("CFO");
  });

  test("只有兜底 → 业务视图为空", () => {
    const kernel: KernelRuleJson = {
      transform: [
        {
          type: "branch",
          params: { domain: { type: "all", inner: [] }, on_true: [] },
        },
      ],
    };
    const business = unwrapKernelTransform(kernel);
    expect(business.condition).toBeUndefined();
    expect(business.action).toBeUndefined();
  });

  test("空 transform → 空业务视图", () => {
    const business = unwrapKernelTransform({ transform: [] });
    expect(business.condition).toBeUndefined();
    expect(business.action).toBeUndefined();
  });

  test("rawTransform 保留(供开发者模式查看)", () => {
    const kernel: KernelRuleJson = {
      transform: [
        {
          type: "branch",
          params: { domain: { type: "all", inner: [] }, on_true: [] },
        },
      ],
    };
    const business = unwrapKernelTransform(kernel);
    expect(business.rawTransform).toBeDefined();
    expect(business.rawTransform).toHaveLength(1);
  });

  test("裸 set step(无 branch 包装)→ 提取为 action", () => {
    const kernel: KernelRuleJson = {
      transform: [
        { type: "set", params: { attr: "flag", operation: "set", value: true } },
        {
          type: "branch",
          params: { domain: { type: "all", inner: [] }, on_true: [] },
        },
      ],
    };
    const business = unwrapKernelTransform(kernel);
    expect(business.action).toBeDefined();
    expect(business.action?.meta).toBe("set");
  });
});

describe("kernel-rule-adapter — buildKernelRuleContent", () => {
  test("产出含 meta(id/description)的合法 JSON 字符串（version 不透传，由内核管理）", () => {
    const content = buildKernelRuleContent(
      {
        condition: { domain: "lt", path: "amount", value: 100 },
        action: { type: "log" },
      },
      { id: "test.rule", version: 1, description: "测试规则" },
    );

    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("test.rule");
    // 设计决策(B4, commit 39e2932):version 由内核在 addRule 时管理,不透传至 Rule.content JSON
    expect(parsed.version).toBeUndefined();
    expect(parsed.description).toBe("测试规则");
    expect(Array.isArray(parsed.transform)).toBe(true);

    // 产出的 content 必须通过内核门禁
    const v = RuleValidator.validate(content);
    expect(v.valid).toBe(true);
  });

  test("meta 可选 → 不带 meta 时只有 transform", () => {
    const content = buildKernelRuleContent({});
    const parsed = JSON.parse(content);
    expect(parsed.id).toBeUndefined();
    expect(parsed.version).toBeUndefined();
    expect(parsed.transform).toBeDefined();
  });
});
