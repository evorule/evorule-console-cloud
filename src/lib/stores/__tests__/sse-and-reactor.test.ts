// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// sse-connection + reactor-runtime 单测
//
// 运行: npx vitest run src/lib/stores/__tests__/sse-and-reactor.test.ts
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §4.2 + §4.3 + §5.4 + §5.5

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { get as storeGet } from "svelte/store";

export class MockEventSource {
  url: string;
  readyState = 0;
  listeners: Record<string, ((e: MessageEvent | Event) => void)[]> = {};
  onerror: ((e: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 2;
  });

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (e: MessageEvent | Event) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: MessageEvent | Event) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(type: string, event: MessageEvent | Event) {
    if (this.listeners[type]) {
      this.listeners[type].forEach((l) => l(event));
    }
    const propHandler = (this as unknown as Record<string, unknown>)[`on${type}`] as
      | ((e: Event) => void)
      | undefined;
    if (typeof propHandler === "function") {
      propHandler(event);
    }
  }

  triggerOpen() {
    this.readyState = 1;
    this.dispatchEvent("open", new Event("open"));
  }

  triggerMessage(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    this.dispatchEvent(type, event);
  }

  triggerError() {
    this.readyState = 2;
    const errEvent = new Event("error");
    this.dispatchEvent("error", errEvent);
  }
}

const { mockBrowser, mockEventSourceCtor, mockEventSourceRef, mockFetchFn } = vi.hoisted(() => {
  const ref: { last: MockEventSource | null; ctor: ReturnType<typeof vi.fn> } = {
    last: null,
    ctor: vi.fn((url: string) => {
      const es = new MockEventSource(url);
      ref.last = es;
      return es;
    }),
  };
  Object.defineProperty(globalThis, "EventSource", {
    value: ref.ctor,
    writable: true,
    configurable: true,
  });
  const fetchFn = vi.fn();
  Object.defineProperty(globalThis, "fetch", {
    value: fetchFn,
    writable: true,
    configurable: true,
  });
  return {
    mockBrowser: { browser: true },
    mockEventSourceCtor: ref.ctor,
    mockEventSourceRef: ref,
    mockFetchFn: fetchFn,
  };
});

vi.mock("$app/environment", () => ({
  get browser() {
    return mockBrowser.browser;
  },
}));

vi.mock("$lib/stores/fact-stream", () => ({
  appendFact: vi.fn(),
  clearFacts: vi.fn(),
}));

vi.mock("$lib/stores/anomaly", () => ({
  appendAnomaly: vi.fn(),
  clearAnomalies: vi.fn(),
}));

vi.mock("$lib/kernel", () => ({
  resetAuditStore: vi.fn(),
}));

import {
  sseConnectionStore,
  startSSE,
  stopSSE,
  type ConnectionStatus,
} from "$lib/stores/sse-connection";
import {
  reactorRuntimeStore,
  startReactorPolling,
  stopReactorPolling,
  type ReactorPhase,
  type ReactorRuntimeState,
} from "$lib/stores/reactor-runtime";

beforeEach(() => {
  vi.useFakeTimers();
  mockEventSourceCtor.mockClear();
  mockEventSourceRef.last = null;

  sseConnectionStore.set({
    status: "disconnected",
    retryCount: 0,
    lastConnectedAt: null,
    lastError: null,
  });
  reactorRuntimeStore.set(null);

  mockFetchFn.mockReset();
});

afterEach(() => {
  stopSSE();
  stopReactorPolling();
  vi.useRealTimers();
  vi.clearAllTimers();
});

// ============================================================================
// sse-connection - 初始状态 + ConnectionStatus
// ============================================================================

describe("ConnectionStatus - 类型枚举覆盖", () => {
  test("ConnectionStatus 取值覆盖 disconnected/connecting/connected/error/reconnecting(含 degraded)", () => {
    const setStatus = (s: ConnectionStatus) => {
      sseConnectionStore.update((state) => ({ ...state, status: s }));
    };

    setStatus("disconnected");
    expect(storeGet(sseConnectionStore).status).toBe("disconnected");

    setStatus("connecting");
    expect(storeGet(sseConnectionStore).status).toBe("connecting");

    setStatus("connected");
    expect(storeGet(sseConnectionStore).status).toBe("connected");

    setStatus("reconnecting");
    expect(storeGet(sseConnectionStore).status).toBe("reconnecting");

    setStatus("degraded");
    expect(storeGet(sseConnectionStore).status).toBe("degraded");
  });
});

describe("sseConnectionStore - 初始状态", () => {
  test("初始 sseConnectionStore 是 disconnected + retryCount=0", () => {
    const state = storeGet(sseConnectionStore);
    expect(state.status).toBe("disconnected");
    expect(state.retryCount).toBe(0);
    expect(state.lastConnectedAt).toBeNull();
    expect(state.lastError).toBeNull();
  });
});

// ============================================================================
// sse-connection - startSSE 状态流转
// ============================================================================

describe("startSSE - 状态流转(connecting → connected)", () => {
  test("startSSE 立即进入 connecting 并创建 EventSource", () => {
    startSSE(1, "http://localhost:18080");

    expect(storeGet(sseConnectionStore).status).toBe("connecting");
    expect(mockEventSourceCtor).toHaveBeenCalledTimes(1);
    expect(mockEventSourceCtor).toHaveBeenCalledWith(
      "http://localhost:18080/api/sessions/1/events",
    );
  });

  test("EventSource onopen → connected + retryCount=0 + lastConnectedAt 非空", () => {
    startSSE(42, "http://localhost:18080");
    expect(storeGet(sseConnectionStore).status).toBe("connecting");

    mockEventSourceRef.last?.triggerOpen();

    const state = storeGet(sseConnectionStore);
    expect(state.status).toBe("connected");
    expect(state.retryCount).toBe(0);
    expect(state.lastConnectedAt).toBeTruthy();
    expect(state.lastError).toBeNull();
  });

  test("EventSource onerror → 触发重连流程(reconnecting + retryCount+1)", () => {
    startSSE(1, "http://localhost:18080");
    mockEventSourceRef.last?.triggerOpen();
    expect(storeGet(sseConnectionStore).status).toBe("connected");

    mockEventSourceRef.last?.triggerError();

    const state = storeGet(sseConnectionStore);
    expect(state.status).toBe("reconnecting");
    expect(state.retryCount).toBe(1);
    expect(state.lastError).toContain("第 1 次重连");
  });

  test("onerror 连续 4 次(3 次重连上限后) → 降级 degraded 模式", () => {
    startSSE(1, "http://localhost:18080");
    mockEventSourceRef.last?.triggerOpen();

    mockEventSourceRef.last?.triggerError();
    expect(storeGet(sseConnectionStore).retryCount).toBe(1);
    vi.advanceTimersByTime(10000);

    mockEventSourceRef.last?.triggerError();
    expect(storeGet(sseConnectionStore).retryCount).toBe(2);
    vi.advanceTimersByTime(10000);

    mockEventSourceRef.last?.triggerError();
    expect(storeGet(sseConnectionStore).retryCount).toBe(3);
    vi.advanceTimersByTime(10000);

    mockEventSourceRef.last?.triggerError();

    const state = storeGet(sseConnectionStore);
    expect(state.status).toBe("degraded");
    expect(state.lastError).toContain("降级为轮询模式");
  });
});

// ============================================================================
// sse-connection - stopSSE 清理
// ============================================================================

describe("stopSSE - 清理 EventSource + 定时器", () => {
  test("stopSSE 调用 EventSource.close 并置为 disconnected", () => {
    startSSE(1, "http://localhost:18080");
    const es = mockEventSourceRef.last!;
    expect(es).toBeDefined();

    stopSSE();

    expect(es.close).toHaveBeenCalled();
    const state = storeGet(sseConnectionStore);
    expect(state.status).toBe("disconnected");
    expect(state.retryCount).toBe(0);
    expect(state.lastError).toBeNull();
  });
});

// ============================================================================
// reactor-runtime - ReactorPhase + state shape
// ============================================================================

describe("ReactorPhase - 类型枚举覆盖", () => {
  test("ReactorPhase 取值覆盖 idle/draining/executing/awaiting_io/stable/error", () => {
    const phases: ReactorPhase[] = [
      "idle",
      "draining",
      "executing",
      "awaiting_io",
      "stable",
      "error",
    ];

    phases.forEach((phase) => {
      reactorRuntimeStore.set({
        phase,
        causalDepth: 0,
        currentStep: 0,
        pendingIoCount: 0,
        reactorVersion: 0,
        invariantViolations: 0,
        finished: false,
      });
      expect(storeGet(reactorRuntimeStore)?.phase).toBe(phase);
    });
  });
});

describe("ReactorRuntimeState - shape 字段完整", () => {
  test("ReactorRuntimeState 含 phase/causalDepth/currentStep/pendingIoCount/invariantViolations 等字段", () => {
    const sample: ReactorRuntimeState = {
      phase: "running" as never,
      causalDepth: 7,
      currentStep: 12,
      pendingIoCount: 3,
      reactorVersion: 5,
      invariantViolations: 1,
      finished: false,
    };
    reactorRuntimeStore.set(sample);

    const state = storeGet(reactorRuntimeStore);
    expect(state).toBeDefined();
    expect(state?.phase).toBeTruthy();
    expect(typeof state?.causalDepth).toBe("number");
    expect(typeof state?.currentStep).toBe("number");
    expect(typeof state?.pendingIoCount).toBe("number");
    expect(typeof state?.invariantViolations).toBe("number");
    expect(typeof state?.finished).toBe("boolean");
  });
});

describe("reactorRuntimeStore - 默认值 null", () => {
  test("reactorRuntimeStore 初始为 null", () => {
    expect(storeGet(reactorRuntimeStore)).toBeNull();
  });
});

// ============================================================================
// reactor-runtime - startReactorPolling 轮询
// ============================================================================

describe("startReactorPolling - 轮询 fetch + setInterval", () => {
  test("startReactorPolling 立即执行一次,调用 fetch × 3(+setInterval)", () => {
    const mockState = {
      reactor: {
        phase: "executing",
        causal_depth: 5,
        current_step: 10,
        pending_io_count: 2,
        version: 3,
      },
    };
    const mockInv = { violations: 0 };
    const mockFin = { finished: false };

    mockFetchFn
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockState), ok: true } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockInv), ok: true } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockFin), ok: true } as Response);

    startReactorPolling(1, "http://localhost:18080");

    expect(mockFetchFn).toHaveBeenCalledTimes(3);
    expect(mockFetchFn).toHaveBeenNthCalledWith(
      1,
      "http://localhost:18080/api/sessions/1/state",
    );
    expect(mockFetchFn).toHaveBeenNthCalledWith(
      2,
      "http://localhost:18080/api/sessions/1/invariants",
    );
    expect(mockFetchFn).toHaveBeenNthCalledWith(
      3,
      "http://localhost:18080/api/sessions/1/finished",
    );
  });

  test("轮询成功后 reactorRuntimeStore.set 被正确写入", async () => {
    const mockState = {
      reactor: {
        phase: "awaiting_io",
        causal_depth: 3,
        current_step: 7,
        pending_io_count: 1,
        version: 2,
      },
    };
    const mockInv = { violations: 2 };
    const mockFin = { finished: false };

    mockFetchFn
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockState), ok: true } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockInv), ok: true } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockFin), ok: true } as Response);

    startReactorPolling(1, "http://localhost:18080");

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    }

    const state = storeGet(reactorRuntimeStore);
    expect(state).not.toBeNull();
    expect(state?.phase).toBe("awaiting_io");
    expect(state?.causalDepth).toBe(3);
    expect(state?.currentStep).toBe(7);
    expect(state?.pendingIoCount).toBe(1);
    expect(state?.reactorVersion).toBe(2);
    expect(state?.invariantViolations).toBe(2);
    expect(state?.finished).toBe(false);
  });

  test("2 秒后再次触发轮询(setInterval 2000ms)", async () => {
    const responses = [
      { reactor: { phase: "idle", causal_depth: 0, current_step: 0, pending_io_count: 0, version: 0 } },
      { violations: 0 },
      { finished: false },
    ];

    let callCount = 0;
    mockFetchFn.mockImplementation(async () => {
      const idx = callCount % 3;
      callCount++;
      return { json: () => Promise.resolve(responses[idx]), ok: true } as Response;
    });

    startReactorPolling(1, "http://localhost:18080");
    expect(mockFetchFn).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(mockFetchFn).toHaveBeenCalledTimes(6);

    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(mockFetchFn).toHaveBeenCalledTimes(9);
  });
});

// ============================================================================
// reactor-runtime - stopReactorPolling 清理
// ============================================================================

describe("stopReactorPolling - 清理定时器", () => {
  test("stopReactorPolling 后不再触发新的 fetch", async () => {
    mockFetchFn.mockResolvedValue({
      json: () => Promise.resolve({}),
      ok: true,
    } as Response);

    startReactorPolling(1, "http://localhost:18080");
    expect(mockFetchFn).toHaveBeenCalledTimes(3);

    stopReactorPolling();

    vi.advanceTimersByTime(10000);
    await Promise.resolve();
    expect(mockFetchFn).toHaveBeenCalledTimes(3);
  });
});
