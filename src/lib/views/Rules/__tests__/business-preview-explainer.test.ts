// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 业务预览结构化解释器单测
//
// 运行: npx vitest run src/lib/views/Rules/__tests__/business-preview-explainer.test.ts
//
// 测试范围:
//   - 单条件 + 单动作:"如果 X 则 Y"
//   - 多分支(branch + 兜底):含 elsePart
//   - 内核 transform 数组输入(unwrap 后解释)
//   - 6 种 domain 类型(gt/lt/eq/exists/instruction/all/not)
//   - 多种 action meta(set/push/branch/io_request)+ 业务动作语义
//   - 术语高亮(label/synonyms 命中)
//   - 边界:空对象 / 仅条件 / 仅动作
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.4 + §3.5

import { describe, test, expect } from "vitest";
import { explainStructured } from "../business-preview-explainer";
import type { BusinessTerm } from "$lib/stores/business-terms";

const TEST_TERMS: BusinessTerm[] = [
  {
    id: "finance.amount",
    industry: "finance",
    label: "金额",
    key: "amount",
    synonyms: ["报销金额", "支出金额"],
    description: "金额",
    status: "active",
    version: 1,
  },
  {
    id: "finance.approver",
    industry: "finance",
    label: "审批人",
    key: "approver",
    synonyms: ["批准人"],
    description: "审批人",
    status: "active",
    version: 1,
  },
  {
    id: "finance.threshold",
    industry: "finance",
    label: "审批阈值",
    key: "threshold",
    synonyms: ["上限"],
    description: "审批阈值",
    status: "active",
    version: 1,
  },
];

describe("business-preview-explainer — 单条件 + 单动作", () => {
  test("lt 域 + role 动作 → 'amount 小于 10000' + '通知 CFO'", () => {
    const result = explainStructured(
      {
        condition: {
          domain: "lt",
          path: "__exec__.payload.amount",
          value: 10000,
        },
        action: { type: "require_approval", params: { role: "CFO" } },
      },
      TEST_TERMS,
    );

    expect(result.ifPart).toContain("amount");
    expect(result.ifPart).toContain("小于");
    expect(result.ifPart).toContain("10000");
    // action 有 role 参数 → explainAction 优先返回 "通知 CFO"(业务语义优先于 io_request prompt)
    expect(result.thenPart).toContain("CFO");
    expect(result.templateId).toBe("single-condition-action");
    expect(result.elsePart).toBeUndefined();
  });

  test("path 去掉 __exec__.payload. 前缀", () => {
    const result = explainStructured(
      {
        condition: { domain: "lt", path: "__exec__.payload.amount", value: 5000 },
        action: { meta: "set", params: { key: "flag", value: true } },
      },
      TEST_TERMS,
    );
    // 前缀应被剥离
    expect(result.ifPart).not.toContain("__exec__.payload.");
    expect(result.ifPart).toContain("amount");
    expect(result.ifPart).toContain("小于");
    expect(result.ifPart).toContain("5000");
  });
});

describe("business-preview-explainer — 6 种 domain 类型", () => {
  test("eq 域", () => {
    const r = explainStructured(
      {
        condition: { domain: "eq", path: "x", value: "high" },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      [],
    );
    expect(r.ifPart).toContain("等于");
    expect(r.ifPart).toContain("high");
  });

  test("lt 域", () => {
    const r = explainStructured(
      {
        condition: { domain: "lt", path: "x", value: 100 },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      [],
    );
    expect(r.ifPart).toContain("小于");
    expect(r.ifPart).toContain("100");
  });

  test("gt 域", () => {
    const r = explainStructured(
      {
        condition: { domain: "gt", path: "x", value: 50 },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      [],
    );
    expect(r.ifPart).toContain("大于");
  });

  test("exists 域(有 path → 'X 存在')", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "signature" },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      [],
    );
    expect(r.ifPart).toContain("signature");
    expect(r.ifPart).toContain("存在");
  });

  test("all 域", () => {
    const r = explainStructured(
      {
        condition: { domain: "all", path: "x" },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      [],
    );
    expect(r.ifPart).toContain("所有条件");
  });

  test("未知 domain → 兜底提示", () => {
    const r = explainStructured(
      {
        condition: { domain: "weird_op", path: "x" },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      [],
    );
    expect(r.ifPart).toContain("未知条件类型");
  });
});

describe("business-preview-explainer — action 类型", () => {
  test("meta=set → '设置 key = value'", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: { meta: "set", params: { key: "flag", value: true } },
      },
      [],
    );
    expect(r.thenPart).toContain("设置");
    expect(r.thenPart).toContain("flag");
  });

  test("meta=push → '追加到 key'", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: { meta: "push", params: { key: "list", value: 1 } },
      },
      [],
    );
    expect(r.thenPart).toContain("追加");
  });

  test("meta=io_request + prompt → '调用外部接口:prompt'", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: {
          meta: "io_request",
          params: { prompt: "通知 CFO 审批" },
        },
      },
      [],
    );
    expect(r.thenPart).toContain("调用外部接口");
    expect(r.thenPart).toContain("通知 CFO 审批");
  });

  test("业务动作 type(无 meta)+ role → '通知 role'", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: { type: "require_approval", params: { role: "CFO" } },
      },
      [],
    );
    expect(r.thenPart).toContain("CFO");
  });

  test("业务动作 + evidenceType → '要求证据类型'", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: { type: "audit", params: { evidenceType: "文档" } },
      },
      [],
    );
    expect(r.thenPart).toContain("证据类型");
    expect(r.thenPart).toContain("文档");
  });

  test("业务动作 + regulator → '报送监管机构'", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: { type: "report", params: { regulator: "SOX" } },
      },
      [],
    );
    expect(r.thenPart).toContain("监管机构");
    expect(r.thenPart).toContain("SOX");
  });
});

describe("business-preview-explainer — 多分支(branch + 兜底)", () => {
  test("多分支 → 取首分支 ifPart,末分支兜底为 elsePart", () => {
    const r = explainStructured(
      {
        branch: [
          {
            condition: { domain: "lt", path: "amount", value: 5000 },
            action: { meta: "set", params: { key: "auto", value: true } },
          },
          {
            condition: { domain: "all" },
            action: { meta: "set", params: { key: "manual", value: true } },
          },
        ],
      },
      [],
    );
    expect(r.templateId).toBe("branch-with-fallback");
    expect(r.ifPart).toContain("小于");
    expect(r.thenPart).toContain("auto");
    // 兜底分支(condition=all)应被识别为 elsePart
    expect(r.elsePart).toBeDefined();
    expect(r.elsePart).toContain("manual");
  });
});

describe("business-preview-explainer — 内核 transform 输入(unwrap)", () => {
  test("内核 transform 数组也能正确解释", () => {
    const kernelJson = {
      transform: [
        {
          type: "branch",
          params: {
            domain: {
              type: "gt",
              path: "__exec__.payload.amount",
              value: 10000,
            },
            on_true: [
              {
                type: "io_request",
                params: { prompt: "通知 CFO" },
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
    };
    const r = explainStructured(kernelJson, TEST_TERMS);
    expect(r.ifPart).toContain("amount");
    expect(r.ifPart).toContain("大于");
    expect(r.thenPart).toContain("通知 CFO");
  });
});

describe("business-preview-explainer — 术语高亮", () => {
  test("ifPart/thenPart 命中术语 label → terms 列表含该术语", () => {
    // 路径 amount + 值 10000 → ifPart 含 "amount"
    // 但术语是中文 label "金额",synonyms 是 "报销金额"
    // 故 ifPart 不含中文 label,这里改用 thenPart 测试
    const r = explainStructured(
      {
        condition: { domain: "gt", path: "amount", value: 10000 },
        action: {
          type: "require_approval",
          params: { role: "审批人" }, // "审批人" 是 finance.approver 的 label
        },
      },
      TEST_TERMS,
    );
    const approverTerm = r.terms.find((t) => t.termId === "finance.approver");
    expect(approverTerm).toBeDefined();
    expect(approverTerm?.matchedText).toBe("审批人");
  });

  test("synonyms 命中也能匹配", () => {
    const r = explainStructured(
      {
        condition: { domain: "gt", path: "amount", value: 10000 },
        action: {
          meta: "io_request",
          params: { prompt: "通知 批准人 处理" }, // "批准人" 是 approver 的 synonym
        },
      },
      TEST_TERMS,
    );
    const approverTerm = r.terms.find((t) => t.termId === "finance.approver");
    expect(approverTerm).toBeDefined();
  });

  test("无术语命中 → terms 为空数组", () => {
    const r = explainStructured(
      {
        condition: { domain: "exists", path: "x" },
        action: { meta: "set", params: { key: "k", value: 1 } },
      },
      TEST_TERMS,
    );
    expect(r.terms).toEqual([]);
  });
});

describe("business-preview-explainer — 边界情况", () => {
  test("空对象 → '(无条件)' + '(无动作)'", () => {
    const r = explainStructured({}, []);
    expect(r.ifPart).toContain("无条件");
    expect(r.thenPart).toContain("无动作");
  });

  test("仅条件无动作 → thenPart 为 '(无动作)'", () => {
    const r = explainStructured(
      { condition: { domain: "exists", path: "x" } },
      [],
    );
    expect(r.thenPart).toContain("无动作");
  });

  test("仅动作无条件 → ifPart 为 '(无条件)'", () => {
    const r = explainStructured(
      { action: { meta: "set", params: { key: "k", value: 1 } } },
      [],
    );
    expect(r.ifPart).toContain("无条件");
  });
});
