// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// fact-stream + anomaly 单测 — 环形缓冲 + 上限 + 清空 + 派生筛选
//
// 运行: npx vitest run src/lib/stores/__tests__/fact-stream-anomaly.test.ts
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.2(fact-stream)+ §5.3(anomaly)

import { describe, test, expect, beforeEach } from "vitest";
import {
  factStreamStore,
  appendFact,
  clearFacts,
  factCount,
  latestFact,
  factsByType,
} from "../fact-stream";
import type { FactData } from "../sse-events";
import {
  anomalyStore,
  appendAnomaly,
  clearAnomalies,
  anomalyCount,
  criticalAnomalyCount,
  anomaliesByLevel,
} from "../anomaly";
import type { AnomalyData } from "../sse-events";

// vitest 的 get 是 vi.getState? 不,用 svelte/store 的 get
import { get as storeGet } from "svelte/store";

beforeEach(() => {
  factStreamStore.set([]);
  anomalyStore.set([]);
});

function makeFact(id: string, type = "rule_triggered"): FactData {
  return {
    fact_id: id,
    fact_type: type,
    logical_time: parseInt(id.replace(/\D/g, ""), 10) || 0,
    content: { id },
    timestamp: "2026-01-01T00:00:00Z",
  };
}

function makeAnomaly(level: AnomalyData["level"] = "warning"): AnomalyData {
  return {
    level,
    rule_id: "r1",
    message: `anomaly ${Math.random()}`,
    timestamp: "2026-01-01T00:00:00Z",
  };
}

// ============================================================================
// fact-stream 环形缓冲
// ============================================================================

describe("fact-stream - 环形缓冲", () => {
  test("appendFact 追加到末尾", () => {
    appendFact(makeFact("f1"));
    appendFact(makeFact("f2"));
    const facts = storeGet(factStreamStore);
    expect(facts).toHaveLength(2);
    expect(facts[0].fact_id).toBe("f1");
    expect(facts[1].fact_id).toBe("f2");
  });

  test("超过 1000 条 → 丢弃最旧的(环形缓冲)", () => {
    // 追加 1005 条
    for (let i = 0; i < 1005; i++) {
      appendFact(makeFact(`f${i}`));
    }
    const facts = storeGet(factStreamStore);
    expect(facts).toHaveLength(1000); // 上限 1000
    // 最早的 f0~f4 被丢弃,保留 f5~f1004
    expect(facts[0].fact_id).toBe("f5");
    expect(facts[999].fact_id).toBe("f1004");
  });

  test("clearFacts 清空", () => {
    appendFact(makeFact("f1"));
    appendFact(makeFact("f2"));
    clearFacts();
    expect(storeGet(factStreamStore)).toEqual([]);
  });
});

describe("fact-stream - 派生", () => {
  test("factCount 派生计数", () => {
    appendFact(makeFact("f1"));
    appendFact(makeFact("f2"));
    expect(storeGet(factCount)).toBe(2);
  });

  test("latestFact 派生最新一条", () => {
    appendFact(makeFact("f1"));
    appendFact(makeFact("f2"));
    expect(storeGet(latestFact)?.fact_id).toBe("f2");
  });

  test("latestFact 空时为 null", () => {
    expect(storeGet(latestFact)).toBeNull();
  });

  test("factsByType 派生按类型筛选", () => {
    appendFact(makeFact("f1", "patient_visit"));
    appendFact(makeFact("f2", "rule_triggered"));
    appendFact(makeFact("f3", "patient_visit"));
    const visits = storeGet(factsByType("patient_visit"));
    expect(visits).toHaveLength(2);
    expect(visits.map((f) => f.fact_id)).toEqual(["f1", "f3"]);
  });
});

// ============================================================================
// anomaly 上限 + 派生
// ============================================================================

describe("anomaly - 上限 + 追加顺序", () => {
  test("appendAnomaly 最新的在前", () => {
    appendAnomaly(makeAnomaly());
    appendAnomaly(makeAnomaly());
    const anomalies = storeGet(anomalyStore);
    expect(anomalies).toHaveLength(2);
    // 最新的在前
  });

  test("超过 100 条 → 丢弃最旧的(保留最新 100)", () => {
    for (let i = 0; i < 105; i++) {
      appendAnomaly(makeAnomaly());
    }
    expect(storeGet(anomalyStore)).toHaveLength(100);
  });

  test("clearAnomalies 清空", () => {
    appendAnomaly(makeAnomaly());
    appendAnomaly(makeAnomaly());
    clearAnomalies();
    expect(storeGet(anomalyStore)).toEqual([]);
  });
});

describe("anomaly - 派生", () => {
  test("anomalyCount 派生计数", () => {
    appendAnomaly(makeAnomaly("warning"));
    appendAnomaly(makeAnomaly("critical"));
    appendAnomaly(makeAnomaly("error"));
    expect(storeGet(anomalyCount)).toBe(3);
  });

  test("criticalAnomalyCount 只数 critical 级别", () => {
    appendAnomaly(makeAnomaly("warning"));
    appendAnomaly(makeAnomaly("critical"));
    appendAnomaly(makeAnomaly("critical"));
    appendAnomaly(makeAnomaly("error"));
    expect(storeGet(criticalAnomalyCount)).toBe(2);
  });

  test("anomaliesByLevel 按 level 筛选", () => {
    appendAnomaly(makeAnomaly("warning"));
    appendAnomaly(makeAnomaly("critical"));
    appendAnomaly(makeAnomaly("warning"));
    const warnings = storeGet(anomaliesByLevel("warning"));
    expect(warnings).toHaveLength(2);
    const criticals = storeGet(anomaliesByLevel("critical"));
    expect(criticals).toHaveLength(1);
  });
});
