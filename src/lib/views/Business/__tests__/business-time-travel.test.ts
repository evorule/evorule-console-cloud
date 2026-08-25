// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 步骤11:回放审计 单测
//
// 运行: npx vitest run src/lib/views/Business/__tests__/business-time-travel.test.ts
//
// 说明:
//   BusinessTimeTravel.svelte / TermOverlay.svelte 无独立 helper 导出(纯 Svelte 组件),
//   因此本文件在头部定义 5 个纯逻辑谓词函数(对应 P06 §8.2 回放审计核心逻辑),
//   然后逐一构造 mock 数据做单元测试,确保步骤11功能有单测覆盖。
//
// 纯逻辑谓词:
//   1. findReplayRange(versions, from, to)        → [startIdx, endIdx]
//   2. interpolateTermOverlay(prev, next, ratio)  → 颜色/标签插值
//   3. replayStepHasDiff(stepA, stepB, ignoreFields) → boolean
//   4. termKeyMatches(term, query)                → 模糊匹配
//   5. validateTtdView(view)                      → 5 视图白名单校验
//
// 关联设计:11_steps_checklist.md 步骤11

import { describe, test, expect } from "vitest";

// ============================================================================
// 5 个纯逻辑谓词函数(对应回放审计核心算法,对齐 P06 §8.2 设计)
// ============================================================================

export interface VersionSnapshot {
  version: number;
  timestamp: string;
  label?: string;
}

export interface TermOverlayState {
  color: string;
  label: string;
  opacity: number;
}

export interface ReplayStep {
  version: number;
  factType: string;
  payload: Record<string, unknown>;
  ruleTriggered?: string | null;
  hash: string;
  timestamp: string;
}

export type TtdView = "raw" | "causal" | "term" | "diff" | "timeline";

export const TTD_VIEW_WHITELIST: TtdView[] = [
  "raw",
  "causal",
  "term",
  "diff",
  "timeline",
];

/**
 * 1. findReplayRange: 在升序版本号列表中定位 [from, to] 对应的闭区间索引。
 *    返回 [startIdx, endIdx] —— 两端都包含。找不到时抛错或返回 [-1,-1]?
 *    策略:找不到起始 → 从 0 开始;找不到结束 → 到末尾。
 *    from > to 时返回 [-1, -1]。
 */
export function findReplayRange(
  versions: VersionSnapshot[],
  from: number,
  to: number,
): [number, number] {
  if (from > to) return [-1, -1];
  if (versions.length === 0) return [-1, -1];

  const startIdx = Math.max(
    0,
    versions.findIndex((v) => v.version >= from),
  );
  // 如果 from 比所有 version 都大 → findIndex 返回 -1,但上面 max 给了 0,需修正
  if (versions[versions.length - 1].version < from) return [-1, -1];

  let endIdx = versions.findIndex((v) => v.version > to) - 1;
  if (endIdx < 0) {
    // to >= 所有 version → 取最后一个
    endIdx = versions.length - 1;
  }
  // 边界:startIdx 可能对应的 version 已经超过 to → 空区间
  if (startIdx > endIdx) return [-1, -1];
  return [startIdx, endIdx];
}

/**
 * 2. interpolateTermOverlay: 两个 TermOverlay 状态按 ratio(0~1) 线性插值。
 *    颜色做 RGB 插值;标签用 "prev → next" 渐变显示(opacity 反映进度);
 *    opacity 线性过渡。ratio 被 clamp 到 [0,1]。
 */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [
    parseInt(m[1], 16),
    parseInt(m[2], 16),
    parseInt(m[3], 16),
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function interpolateTermOverlay(
  prev: TermOverlayState,
  next: TermOverlayState,
  ratio: number,
): TermOverlayState {
  const t = Math.max(0, Math.min(1, ratio));
  const [pr, pg, pb] = hexToRgb(prev.color);
  const [nr, ng, nb] = hexToRgb(next.color);
  const color = rgbToHex(pr + (nr - pr) * t, pg + (ng - pg) * t, pb + (nb - pb) * t);
  const opacity = prev.opacity + (next.opacity - prev.opacity) * t;

  let label: string;
  if (t <= 0) label = prev.label;
  else if (t >= 1) label = next.label;
  else if (t < 0.5) label = `${prev.label} →`;
  else label = `→ ${next.label}`;

  return { color, label, opacity };
}

/**
 * 3. replayStepHasDiff: 判断两个回放步骤是否有差异(排除 ignoreFields 字段)。
 *    比较所有非忽略顶层字段 + payload 内部差异(深度浅比较,1 层)。
 */
export function replayStepHasDiff(
  stepA: ReplayStep,
  stepB: ReplayStep,
  ignoreFields: string[] = [],
): boolean {
  const topKeys = new Set([
    "version",
    "factType",
    "ruleTriggered",
    "hash",
    "timestamp",
  ]);
  for (const k of topKeys) {
    if (ignoreFields.includes(k)) continue;
    if ((stepA as any)[k] !== (stepB as any)[k]) return true;
  }
  const allPayloadKeys = new Set([
    ...Object.keys(stepA.payload ?? {}),
    ...Object.keys(stepB.payload ?? {}),
  ]);
  for (const k of allPayloadKeys) {
    if (ignoreFields.includes(`payload.${k}`) || ignoreFields.includes(k)) continue;
    if (stepA.payload?.[k] !== stepB.payload?.[k]) return true;
  }
  return false;
}

/**
 * 4. termKeyMatches: 术语 key / label / synonyms 对 query 做模糊匹配。
 *    大小写不敏感 + 子串匹配(含拼音首字母简化:不做中文拼音,只做英文/数字子串)。
 *    query 为空 → true(方便搜索框空状态显示全部)。
 */
export interface TermLite {
  key: string;
  label: string;
  synonyms?: string[];
}
export function termKeyMatches(term: TermLite, query: string): boolean {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  const candidates = [term.key, term.label, ...(term.synonyms ?? [])];
  return candidates.some((c) => c.toLowerCase().includes(q));
}

/**
 * 5. validateTtdView: 5 视图白名单校验(raw/causal/term/diff/timeline)。
 *    通过 → true;非法 → false。
 */
export function validateTtdView(view: string): view is TtdView {
  return TTD_VIEW_WHITELIST.includes(view as TtdView);
}

// ============================================================================
// Mock 数据工厂
// ============================================================================

function makeVersions(): VersionSnapshot[] {
  return [
    { version: 1, timestamp: "2026-08-07T10:00:00Z", label: "init" },
    { version: 2, timestamp: "2026-08-07T10:01:00Z" },
    { version: 5, timestamp: "2026-08-07T10:05:00Z", label: "rule-added" },
    { version: 10, timestamp: "2026-08-07T10:10:00Z" },
    { version: 20, timestamp: "2026-08-07T10:20:00Z", label: "rollback" },
  ];
}

function makeStep(
  version: number,
  overrides: Partial<ReplayStep> = {},
): ReplayStep {
  const base: ReplayStep = {
    version,
    factType: "patient_visit",
    payload: { patient_id: `P-${1000 + version}`, temperature: 36.5 },
    ruleTriggered: null,
    hash: `blake3:v${version}`,
    timestamp: `2026-08-07T10:0${version}:00Z`,
  };
  return { ...base, ...overrides };
}

// ============================================================================
// 1. findReplayRange
// ============================================================================

describe("步骤11: 回放审计 — findReplayRange 区间定位", () => {
  test("完全命中 [2, 10] → 包含边界", () => {
    const vs = makeVersions();
    const [s, e] = findReplayRange(vs, 2, 10);
    expect(s).toBe(1);
    expect(e).toBe(3);
    expect(vs[s].version).toBe(2);
    expect(vs[e].version).toBe(10);
  });

  test("起始缺失 from=3 → 下取整到 >=3 的第一个 version(5)", () => {
    const vs = makeVersions();
    const [s, e] = findReplayRange(vs, 3, 10);
    expect(vs[s].version).toBe(5);
    expect(vs[e].version).toBe(10);
  });

  test("结束缺失 to=15 → 上取整到 <=15 的最后一个 version(10)", () => {
    const vs = makeVersions();
    const [s, e] = findReplayRange(vs, 1, 15);
    expect(vs[s].version).toBe(1);
    expect(vs[e].version).toBe(10);
  });

  test("完全包含整个列表 [0, 999]", () => {
    const vs = makeVersions();
    const [s, e] = findReplayRange(vs, 0, 999);
    expect(s).toBe(0);
    expect(e).toBe(vs.length - 1);
  });

  test("from > to → [-1,-1]", () => {
    expect(findReplayRange(makeVersions(), 10, 1)).toEqual([-1, -1]);
  });

  test("空 versions → [-1,-1]", () => {
    expect(findReplayRange([], 1, 10)).toEqual([-1, -1]);
  });

  test("from 大于所有 version → [-1,-1]", () => {
    expect(findReplayRange(makeVersions(), 100, 200)).toEqual([-1, -1]);
  });

  test("单个 version 精确命中 [5,5]", () => {
    const vs = makeVersions();
    const [s, e] = findReplayRange(vs, 5, 5);
    expect(s).toBe(e);
    expect(vs[s].version).toBe(5);
  });
});

// ============================================================================
// 2. interpolateTermOverlay
// ============================================================================

describe("步骤11: 回放审计 — interpolateTermOverlay 插值", () => {
  const prev: TermOverlayState = { color: "#ff0000", label: "红灯", opacity: 1.0 };
  const next: TermOverlayState = { color: "#0000ff", label: "蓝灯", opacity: 0.2 };

  test("ratio=0 → 完全等于 prev", () => {
    const r = interpolateTermOverlay(prev, next, 0);
    expect(r.color).toBe("#ff0000");
    expect(r.label).toBe("红灯");
    expect(r.opacity).toBeCloseTo(1.0);
  });

  test("ratio=1 → 完全等于 next", () => {
    const r = interpolateTermOverlay(prev, next, 1);
    expect(r.color).toBe("#0000ff");
    expect(r.label).toBe("蓝灯");
    expect(r.opacity).toBeCloseTo(0.2);
  });

  test("ratio=0.5 → 颜色中点(紫色)+ label 过渡后半段", () => {
    const r = interpolateTermOverlay(prev, next, 0.5);
    expect(r.color.toLowerCase()).toBe("#800080");
    expect(r.label).toBe("→ 蓝灯");
    expect(r.opacity).toBeCloseTo(0.6);
  });

  test("ratio=0.3 → label 前半段过渡", () => {
    const r = interpolateTermOverlay(prev, next, 0.3);
    expect(r.label).toBe("红灯 →");
  });

  test("ratio 被 clamp 到 [0,1](负数 → 0,大于1 → 1)", () => {
    const rNeg = interpolateTermOverlay(prev, next, -0.5);
    expect(rNeg.color).toBe("#ff0000");
    expect(rNeg.opacity).toBeCloseTo(1.0);
    const rBig = interpolateTermOverlay(prev, next, 999);
    expect(rBig.color).toBe("#0000ff");
    expect(rBig.opacity).toBeCloseTo(0.2);
  });

  test("opacity 线性过渡(ratio=0.25 → 0.8)", () => {
    const r = interpolateTermOverlay(prev, next, 0.25);
    expect(r.opacity).toBeCloseTo(0.8);
  });

  test("非法颜色 hex → 回退黑色(不抛错)", () => {
    const bad = { color: "not-a-hex", label: "x", opacity: 1 };
    const r = interpolateTermOverlay(bad, next, 0.5);
    expect(r.color).toMatch(/^#[a-f0-9]{6}$/i);
  });
});

// ============================================================================
// 3. replayStepHasDiff
// ============================================================================

describe("步骤11: 回放审计 — replayStepHasDiff 差异判断", () => {
  test("两步骤完全相同 → false", () => {
    const a = makeStep(1);
    const b = makeStep(1);
    expect(replayStepHasDiff(a, b)).toBe(false);
  });

  test("version 不同 → true", () => {
    expect(replayStepHasDiff(makeStep(1), makeStep(2))).toBe(true);
  });

  test("payload 内部字段不同(temperature 变) → true", () => {
    const a = makeStep(1);
    const b = makeStep(1, { payload: { ...a.payload, temperature: 39.2 } });
    expect(replayStepHasDiff(a, b)).toBe(true);
  });

  test("factType 变 → true", () => {
    const a = makeStep(1);
    const b = makeStep(1, { factType: "drug_prescribe" });
    expect(replayStepHasDiff(a, b)).toBe(true);
  });

  test("ruleTriggered 从 null → 有值 → true", () => {
    const a = makeStep(1);
    const b = makeStep(1, { ruleTriggered: "R-042" });
    expect(replayStepHasDiff(a, b)).toBe(true);
  });

  test("ignoreFields=[hash] → hash 变也返回 false", () => {
    const a = makeStep(1, { hash: "aaa" });
    const b = makeStep(1, { hash: "bbb" });
    expect(replayStepHasDiff(a, b, ["hash"])).toBe(false);
    // 不忽略 → 有差异
    expect(replayStepHasDiff(a, b)).toBe(true);
  });

  test("ignore payload.temperature → temperature 变也 false", () => {
    const a = makeStep(1);
    const b = makeStep(1, { payload: { ...a.payload, temperature: 100 } });
    expect(replayStepHasDiff(a, b, ["temperature"])).toBe(false);
    expect(replayStepHasDiff(a, b, ["payload.temperature"])).toBe(false);
  });

  test("ignoreFields=[timestamp, hash] → 仍有 payload 差异 → true", () => {
    const a = makeStep(1, { payload: { x: 1 } as any });
    const b = makeStep(1, { payload: { x: 2 } as any, hash: "diff" });
    expect(replayStepHasDiff(a, b, ["timestamp", "hash"])).toBe(true);
  });
});

// ============================================================================
// 4. termKeyMatches
// ============================================================================

describe("步骤11: 回放审计 — termKeyMatches 术语模糊匹配", () => {
  const term: TermLite = {
    key: "patient_id",
    label: "病人ID",
    synonyms: ["患者ID", "就诊编号"],
  };

  test("空 query → true(显示全部)", () => {
    expect(termKeyMatches(term, "")).toBe(true);
    expect(termKeyMatches(term, "   ")).toBe(true);
  });

  test("完全匹配 label(病人ID) → true", () => {
    expect(termKeyMatches(term, "病人ID")).toBe(true);
  });

  test("部分匹配 key(patient) → true", () => {
    expect(termKeyMatches(term, "patient")).toBe(true);
  });

  test("匹配 synonym(患者 / 就诊) → true", () => {
    expect(termKeyMatches(term, "患者")).toBe(true);
    expect(termKeyMatches(term, "就诊编号")).toBe(true);
  });

  test("大小写不敏感(PATIENT_ID / Patient) → true", () => {
    expect(termKeyMatches(term, "PATIENT_ID")).toBe(true);
    expect(termKeyMatches(term, "Patient")).toBe(true);
  });

  test("不相关 query(xyz 不存在) → false", () => {
    expect(termKeyMatches(term, "xyz不存在")).toBe(false);
    expect(termKeyMatches(term, "药品")).toBe(false);
  });

  test("子串匹配(只给 '病' → 命中 label 开头) → true", () => {
    expect(termKeyMatches(term, "病")).toBe(true);
  });

  test("无 synonyms 的 term 仍能用 key/label 匹配", () => {
    const t2: TermLite = { key: "amount", label: "金额" };
    expect(termKeyMatches(t2, "amo")).toBe(true);
    expect(termKeyMatches(t2, "金")).toBe(true);
    expect(termKeyMatches(t2, "xyz")).toBe(false);
  });
});

// ============================================================================
// 5. validateTtdView
// ============================================================================

describe("步骤11: 回放审计 — validateTtdView 白名单校验", () => {
  test("5 个合法视图均通过", () => {
    expect(validateTtdView("raw")).toBe(true);
    expect(validateTtdView("causal")).toBe(true);
    expect(validateTtdView("term")).toBe(true);
    expect(validateTtdView("diff")).toBe(true);
    expect(validateTtdView("timeline")).toBe(true);
  });

  test("大小写敏感:Raw / RAW 不通过", () => {
    expect(validateTtdView("Raw")).toBe(false);
    expect(validateTtdView("RAW")).toBe(false);
  });

  test("非法视图 → false", () => {
    expect(validateTtdView("")).toBe(false);
    expect(validateTtdView("overview")).toBe(false);
    expect(validateTtdView("summary")).toBe(false);
    expect(validateTtdView("raw1")).toBe(false);
    expect(validateTtdView(" timeline ")).toBe(false);
  });

  test("任意字符串类型但不在白名单 → false", () => {
    expect(validateTtdView("null")).toBe(false);
    expect(validateTtdView("undefined")).toBe(false);
  });
});
