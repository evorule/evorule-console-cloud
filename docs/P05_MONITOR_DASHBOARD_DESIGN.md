# P0-5 详细设计(L1 监控大屏 + 业务仪表板)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-5` 的可实施落地。
>
> **定位**:P0-5 实现 L1 Production Runtime 监控大屏 — Reactor 运行态栏 + 实时 Fact 流 + 异常告警 + 性能指标 + 13 按钮干预操作 + SSE 订阅(含 U7 session_switched)。本文档整合三层架构 §3.1-§3.9 + HOME_DESIGN §5.4 的监控大屏设计,形成完整实施依据。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-5`(步骤 6-7 看运行时 + 指标)
> - 三层架构:`evorule-three-layer-architecture.md §3.1-§3.9`(L1 Production Runtime 全部能力)
> - 首页设计:`HOME_DESIGN.md §5.4`(MonitorDashboard 组件树 + InterventionBar + SSE)
> - 内核导出:`@evorule/console`(session store + audit store + ttd v1.0)
> - 后端 API:`evorule-server`(55 个端点,见三层架构 §13)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-5)

> P0-5 业务仪表板 + 业务状态(实时 + 指标)— 步骤 6-7 看运行时 + 指标 — 首屏入口 + 状态卡片 + 业务对象 + 信心评分

**核心**:L1 监控大屏是"走神 4 的瞄点"——24/7 实时展示生产运行时状态,所有人按权限可见。

### 1.2 三层架构定位

L1 Production Runtime 是全局唯一的生产环境(三层架构 §3.1):

| 职责 | 实现 |
| --- | --- |
| 24/7 跑已发布 Final 规则 | evorule-server SessionManager |
| 监控大屏 | **本文档(P0-5)设计** |
| BLAKE3 审计链 | evorule-tcb(已就绪) |
| 热重载 | 滚动 session 模式(三层架构 §3.3) |
| 干预操作 | InterventionBar 13 按钮(三层架构 §3.7) |
| 时间旅行 | ttd v1.0 5 视图(三层架构 §3.5) |

### 1.3 已实现能力(evorule-server + 内核)

| 能力 | 来源 | P0-5 直接用 |
| --- | --- | --- |
| SSE 实时 Fact 流 | `GET /api/sessions/{id}/events` | ✅ FactStreamView |
| Reactor 运行态 | `GET /api/sessions/{id}/state` | ✅ ReactorStateBar |
| 结构不变量 | `GET /api/sessions/{id}/invariants` | ✅ ReactorStateBar + AnomalyPanel |
| 中断会话 | `POST /api/sessions/{id}/interrupt` | ✅ InterventionBar |
| 单步执行 | `GET /api/sessions/{id}/step` | ✅ InterventionBar |
| 快照 | `GET /api/sessions/{id}/snapshot` | ✅ InterventionBar |
| 审计导出/导入 | `audit/export` `audit/import` | ✅ InterventionBar |
| Prometheus 指标 | `GET /metrics` | ✅ PerformanceMetrics |
| 时间旅行 5 视图 | 内核 ttd v1.0 | ✅ InterventionBar [⏪ 时间旅行] |

### 1.4 与其他 P0 的关系

| 前置设计 | P0-5 关系 |
| --- | --- |
| HOME_DESIGN §5.4 | MonitorDashboard 组件树(本文档展开实施级) |
| P03 数据集 | 数据集发布后,L1 监控运行的数据集 |
| P04 业务执行台 | 提交业务事件后,L1 实时显示 Fact 流 |
| P06 业务审计 | L1 监控大屏的 [📜 审计] 按钮跳转 |

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现 `MonitorDashboard.svelte`(L1 监控大屏主视图)
- ✅ 实现 `ReactorStateBar.svelte`(Reactor 运行态:6 phase + invariants + causal_depth + pending_io)
- ✅ 实现 `FactStreamView.svelte`(实时 Fact 流虚拟列表,消费 SSE)
- ✅ 实现 `AnomalyPanel.svelte`(异常告警面板,含 invariants 违规)
- ✅ 实现 `PerformanceMetrics.svelte`(性能指标,消费 /metrics)
- ✅ 实现 `InterventionBar.svelte`(13 按钮干预操作,需二次确认)
- ✅ 实现 `SessionSwitchToast.svelte`(U7 session_switched SSE 通知)
- ✅ 实现 SSE 订阅管理(fact/anomaly/session_switched 事件 + 重连策略)
- ✅ 实现 `BusinessObjectCard.svelte`(业务对象卡片 + 信心评分)
- ✅ 与内核 session store / audit store 集成
- ✅ 与 evorule-server SSE API 集成
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖 SSE 解析 + 状态管理(Vitest)
- ✅ E2E 测试覆盖监控大屏关键交互(Playwright)

### 2.2 非目标

- ❌ 不实现后端 SSE 推送逻辑(evorule-server 已就绪)
- ❌ 不实现告警多通道(邮件/短信,P1)
- ❌ 不实现告警去抖/聚合(P2)
- ❌ 不实现自定义仪表板布局(P2)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)

---

## 3. 关键架构决策

### 3.1 决策 1:SSE 为主 + 轮询为辅

**决策**:
- Fact 流 + 异常告警 + session_switched → SSE 推送(`GET /api/sessions/{id}/events`)
- Reactor 运行态(phase/causal_depth/pending_io/invariants)→ 2s 轮询(`GET /api/sessions/{id}/state` + `GET /api/sessions/{id}/invariants`)
- 性能指标 → 5s 轮询(`GET /metrics` 解析 Prometheus 格式)

**理由**:
1. evorule-server SSE 只推送 Fact/anomaly/session_switched,不推送 ReactorState 变化
2. ReactorState 轻量(6 phase + 几个数字),2s 轮询无压力
3. /metrics 是 Prometheus 格式,需解析,5s 足够

### 3.2 决策 2:Fact 流用虚拟列表

**决策**:Fact 流用虚拟列表渲染(`svelte-virtual-list` 或自实现)。

**理由**:
1. 生产环境 1000+ Fact/秒,不虚拟化会卡崩
2. 只渲染可视区域 Fact(约 20-50 条),DOM 节点恒定
3. 新 Fact 自动滚动到底部(可暂停滚动)

### 3.3 决策 3:干预操作需二次确认

**决策**:所有干预操作(中断/单步/快照/回滚/热重载/审计导出导入)需二次确认弹窗。

**理由**:
1. 干预操作影响生产环境(中断=停止执行,回滚=切换 ruleset)
2. 二次确认防误操作(尤其 [⛔ 中断] 紧急止血)
3. 回滚/热重载需选版本号,二次确认弹窗包含版本选择

### 3.4 决策 4:SSE 断连自动重连 + 降级轮询

**决策**:SSE 断连时:
1. 自动重连(最多 3 次,间隔 2s/4s/8s 指数退避)
2. 3 次失败后降级为 5s 轮询 `GET /api/sessions/{id}/state`
3. 顶部显示"连接断开,正在重连..." 红色横幅

**理由**:
1. 网络抖动不应让监控大屏完全失明
2. 降级轮询保证基本可见性(虽然无 Fact 流)
3. 指数退避避免重连风暴

### 3.5 决策 5:业务对象卡片用 Fact 流派生

**决策**:业务对象卡片(如"当前病人 P-1283 状态")从 Fact 流派生计算,不独立请求。

**理由**:
1. Fact 流已有所有业务数据(SSE 推送)
2. 派生计算无额外网络请求
3. 业务对象 = Fact 流的最新状态聚合

---

## 4. 数据模型

### 4.1 SSE 事件类型

```typescript
// src/lib/stores/sse-events.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

/** SSE 推送的事件类型 */
export type SSEEventType = "fact" | "anomaly" | "session_switched" | "heartbeat";

/** Fact 事件(SSE event: fact) */
export interface FactEvent {
  type: "fact";
  data: {
    fact_id: string;
    fact_type: string;
    logical_time: number;
    content: unknown;
    timestamp: string;
  };
}

/** 异常告警事件(SSE event: anomaly) */
export interface AnomalyEvent {
  type: "anomaly";
  data: {
    level: "warning" | "error" | "critical";
    rule_id: string;
    message: string;
    fact_id?: string;
    timestamp: string;
  };
}

/** Session 切换事件(SSE event: session_switched,U7) */
export interface SessionSwitchedEvent {
  type: "session_switched";
  data: {
    new_session_id: number;
    new_ruleset_version: number;
    old_session_id: number;
    reason: string;
    timestamp: string;
  };
}

/** 心跳事件(SSE event: heartbeat,15s 间隔) */
export interface HeartbeatEvent {
  type: "heartbeat";
  data: { timestamp: string };
}

export type SSEEvent = FactEvent | AnomalyEvent | SessionSwitchedEvent | HeartbeatEvent;
```

### 4.2 ReactorRuntimeState(轮询获取)

```typescript
// src/lib/stores/reactor-runtime.ts

/** 从 GET /api/sessions/{id}/state 获取的 Reactor 运行态 */
export interface ReactorRuntimeState {
  phase: "idle" | "draining" | "executing" | "awaiting_io" | "stable" | "error";
  causalDepth: number;
  currentStep: number;
  pendingIoCount: number;
  reactorVersion: number;
  /** 从 GET /api/sessions/{id}/invariants 获取 */
  invariantViolations: number;
  /** 从 GET /api/sessions/{id}/finished 获取 */
  finished: boolean;
}
```

### 4.3 ConnectionStatus

```typescript
// src/lib/stores/sse-connection.ts

export type ConnectionStatus =
  | "connecting"    // 正在连接
  | "connected"     // 已连接(SSE 正常)
  | "reconnecting"  // 重连中(指数退避)
  | "degraded"      // 降级轮询(3 次重连失败)
  | "disconnected"; // 断开(手动关闭或 server 不可达)

export interface ConnectionState {
  status: ConnectionStatus;
  retryCount: number;
  lastConnectedAt: string | null;
  lastError: string | null;
}
```

### 4.4 PerformanceMetricsData

```typescript
// src/lib/stores/performance-metrics.ts

export interface PerformanceMetricsData {
  latencyP50: number;   // ms
  latencyP99: number;   // ms
  throughput: number;   // req/s
  errorRate: number;    // %
  activeSessions: number;
  updatedAt: string;
}
```

---

## 5. Store 设计

### 5.1 Store 一览

| Store | 文件 | 职责 | 持久化 |
| --- | --- | --- | --- |
| `factStreamStore` | `src/lib/stores/fact-stream.ts` | Fact 流(环形缓冲,最多 1000 条) | ❌ |
| `anomalyStore` | `src/lib/stores/anomaly.ts` | 异常告警列表(最多 100 条) | ❌ |
| `reactorRuntimeStore` | `src/lib/stores/reactor-runtime.ts` | Reactor 运行态(2s 轮询) | ❌ |
| `sseConnectionStore` | `src/lib/stores/sse-connection.ts` | SSE 连接状态 + 重连 | ❌ |
| `performanceMetricsStore` | `src/lib/stores/performance-metrics.ts` | 性能指标(5s 轮询) | ❌ |

### 5.2 factStreamStore

```typescript
// src/lib/stores/fact-stream.ts

import { writable } from "svelte/store";
import type { FactEvent } from "./sse-events";

const MAX_FACTS = 1000; // 环形缓冲上限

export const factStreamStore = writable<FactEvent["data"][]>([]);

/** 追加新 Fact(环形缓冲,超出 1000 条丢弃最旧的) */
export function appendFact(fact: FactEvent["data"]): void {
  factStreamStore.update((facts) => {
    const updated = [...facts, fact];
    if (updated.length > MAX_FACTS) {
      return updated.slice(-MAX_FACTS);
    }
    return updated;
  });
}

/** 清空 Fact 流(session 切换时) */
export function clearFacts(): void {
  factStreamStore.set([]);
}
```

### 5.3 anomalyStore

```typescript
// src/lib/stores/anomaly.ts

import { writable } from "svelte/store";
import type { AnomalyEvent } from "./sse-events";

const MAX_ANOMALIES = 100;

export const anomalyStore = writable<AnomalyEvent["data"][]>([]);

/** 追加异常告警 */
export function appendAnomaly(anomaly: AnomalyEvent["data"]): void {
  anomalyStore.update((anomalies) => {
    const updated = [anomaly, ...anomalies]; // 最新的在前
    if (updated.length > MAX_ANOMALIES) {
      return updated.slice(0, MAX_ANOMALIES);
    }
    return updated;
  });
}

/** 按 level 筛选 */
export function anomaliesByLevel(level: AnomalyEvent["data"]["level"]) {
  return derived(anomalyStore, ($a) => $a.filter((a) => a.level === level));
}

/** 清空(session 切换时) */
export function clearAnomalies(): void {
  anomalyStore.set([]);
}
```

### 5.4 sseConnectionStore + SSE 订阅管理

```typescript
// src/lib/stores/sse-connection.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import type { SSEEvent } from "./sse-events";
import { appendFact, clearFacts } from "./fact-stream";
import { appendAnomaly, clearAnomalies } from "./anomaly";
import { resetAuditStore } from "@evorule/console";

export const sseConnectionStore = writable<ConnectionState>({
  status: "disconnected",
  retryCount: 0,
  lastConnectedAt: null,
  lastError: null,
});

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let onSessionSwitched: ((e: SessionSwitchedEvent) => void) | null = null;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000]; // 指数退避

/** 开始 SSE 订阅 */
export function startSSE(
  sessionId: number,
  baseUrl: string,
  switchHandler?: (e: SessionSwitchedEvent) => void,
): void {
  if (!browser) return;
  onSessionSwitched = switchHandler ?? null;

  stopSSE();
  connectSSE(sessionId, baseUrl);
}

/** 连接 SSE */
function connectSSE(sessionId: number, baseUrl: string): void {
  sseConnectionStore.update((s) => ({ ...s, status: "connecting" }));

  const url = `${baseUrl}/api/sessions/${sessionId}/events`;
  eventSource = new EventSource(url);

  eventSource.addEventListener("open", () => {
    sseConnectionStore.update((s) => ({
      ...s,
      status: "connected",
      retryCount: 0,
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
    }));
  });

  eventSource.addEventListener("fact", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    appendFact(data);
  });

  eventSource.addEventListener("anomaly", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    appendAnomaly(data);
  });

  eventSource.addEventListener("session_switched", (e) => {
    const event: SessionSwitchedEvent = JSON.parse((e as MessageEvent).data);
    handleSessionSwitched(event);
  });

  eventSource.addEventListener("heartbeat", () => {
    // 心跳,无需处理(连接保活)
  });

  eventSource.onerror = () => {
    handleSSEError(sessionId, baseUrl);
  };
}

/** SSE 断连处理(重连 / 降级) */
function handleSSEError(sessionId: number, baseUrl: string): void {
  eventSource?.close();
  eventSource = null;

  const state = get(sseConnectionStore);
  const retryCount = state.retryCount + 1;

  if (retryCount <= MAX_RETRIES) {
    // 指数退避重连
    sseConnectionStore.update((s) => ({
      ...s,
      status: "reconnecting",
      retryCount,
      lastError: `SSE 断连,第 ${retryCount} 次重连...`,
    }));

    const delay = RETRY_DELAYS[retryCount - 1] ?? 8000;
    reconnectTimer = setTimeout(() => connectSSE(sessionId, baseUrl), delay);
  } else {
    // 降级轮询
    sseConnectionStore.update((s) => ({
      ...s,
      status: "degraded",
      lastError: "SSE 3 次重连失败,降级为轮询模式",
    }));
    startDegradedPolling(sessionId, baseUrl);
  }
}

/** 降级轮询(5s 间隔调 GET /state) */
function startDegradedPolling(sessionId: number, baseUrl: string): void {
  pollTimer = setInterval(async () => {
    try {
      const resp = await fetch(`${baseUrl}/api/sessions/${sessionId}/state`);
      if (resp.ok) {
        // 轮询恢复后尝试重连 SSE
        stopDegradedPolling();
        connectSSE(sessionId, baseUrl);
      }
    } catch {
      // 轮询也失败,保持降级
    }
  }, 5000);
}

function stopDegradedPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** U7:处理 session_switched 事件 */
function handleSessionSwitched(event: SessionSwitchedEvent): void {
  // 1. 清空旧 session 的 Fact 流和异常
  clearFacts();
  clearAnomalies();
  resetAuditStore(); // 内核 audit store 清空

  // 2. 关闭旧 SSE
  eventSource?.close();
  eventSource = null;

  // 3. 通知上层(更新 productionStateStore)
  onSessionSwitched?.(event);

  // 4. 订阅新 session 的 SSE
  const { new_session_id } = event.data;
  const baseUrl = getBaseUrl();
  connectSSE(new_session_id, baseUrl);
}

/** 停止 SSE */
export function stopSSE(): void {
  eventSource?.close();
  eventSource = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopDegradedPolling();
  sseConnectionStore.set({
    status: "disconnected",
    retryCount: 0,
    lastConnectedAt: null,
    lastError: null,
  });
}
```

### 5.5 reactorRuntimeStore(2s 轮询)

```typescript
// src/lib/stores/reactor-runtime.ts

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export const reactorRuntimeStore = writable<ReactorRuntimeState | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** 开始 2s 轮询 Reactor 运行态 */
export function startReactorPolling(
  sessionId: number,
  baseUrl: string,
): void {
  if (!browser) return;
  stopReactorPolling();

  const poll = async () => {
    try {
      const [stateResp, invResp, finResp] = await Promise.all([
        fetch(`${baseUrl}/api/sessions/${sessionId}/state`).then((r) => r.json()),
        fetch(`${baseUrl}/api/sessions/${sessionId}/invariants`).then((r) => r.json()),
        fetch(`${baseUrl}/api/sessions/${sessionId}/finished`).then((r) => r.json()),
      ]);

      reactorRuntimeStore.set({
        phase: stateResp.reactor?.phase ?? "idle",
        causalDepth: stateResp.reactor?.causal_depth ?? 0,
        currentStep: stateResp.reactor?.current_step ?? 0,
        pendingIoCount: stateResp.reactor?.pending_io_count ?? 0,
        reactorVersion: stateResp.reactor?.version ?? 0,
        invariantViolations: invResp.violations ?? 0,
        finished: finResp.finished ?? false,
      });
    } catch {
      // 轮询失败,保持上次状态(不报错,避免刷屏)
    }
  };

  poll(); // 立即执行一次
  pollTimer = setInterval(poll, 2000);
}

export function stopReactorPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
```

---

## 6. 组件树

### 6.1 MonitorDashboard 完整组件树

```
src/lib/views/Home/Monitor/
├── MonitorDashboard.svelte       (L1 监控大屏主视图)
│   ├── ConnectionBanner.svelte   (SSE 连接状态横幅,断连时红色)
│   ├── ReactorStateBar.svelte    (Reactor 运行态栏)
│   │   ├── PhaseIndicator.svelte (6 phase 指示灯)
│   │   ├── InvariantBadge.svelte (结构不变量违规数,>0 变红)
│   │   └── IOAwaitIndicator.svelte (awaiting_io 提示 + pending_io 数)
│   ├── FactStreamView.svelte     (Fact 流虚拟列表)
│   │   ├── VirtualList.svelte    (虚拟列表容器)
│   │   ├── FactCard.svelte       (单条 Fact 卡片,复用 P02 业务语言)
│   │   └── AutoScrollToggle.svelte(自动滚动开关)
│   ├── AnomalyPanel.svelte       (异常告警面板)
│   │   └── AnomalyCard.svelte    (单条告警,按 level 着色)
│   ├── PerformanceMetrics.svelte (性能指标区)
│   ├── BusinessObjectCards.svelte(业务对象卡片,从 Fact 流派生)
│   ├── InterventionBar.svelte    (13 按钮干预操作)
│   │   ├── ConfirmDialog.svelte  (二次确认弹窗)
│   │   └── RollbackVersionPicker.svelte (回滚版本选择器)
│   └── SessionSwitchToast.svelte (U7 session 切换 toast)
```

### 6.2 布局示意

```
┌─────────────────────────────────────────────────────────────────┐
│ [🟢 SSE 已连接]                          [ruleset v17] [v143]  │ ← ConnectionBanner
├─────────────────────────────────────────────────────────────────┤
│ phase:executing depth:3 step:142 pending_io:0 invariants:✅0   │ ← ReactorStateBar
├──────────────────────────────┬──────────────────────────────────┤
│ Fact 流(虚拟列表)            │ 异常告警                         │
│ 14:32:01 P-1283 触发 R-042   │ ⚠ R-067 未授权变更(2min)       │
│ 14:32:00 O-8821 通过 R-018   │ ⚠ P-1283 异常未处理             │
│ 14:31:58 P-1199 通过 R-005   │ 🔴 invariants 违规:1            │
│ ...(1000+/秒不卡)            │                                  │
│ [⏸ 暂停滚动]                  │                                  │
├──────────────────────────────┴──────────────────────────────────┤
│ P50:120ms P99:480ms 吞吐:1423/s 错误:0.02%  Session:3         │ ← PerformanceMetrics
├─────────────────────────────────────────────────────────────────┤
│ 业务对象:病人 P-1283  体温:39.2°C  状态:⚠ 高烧  信心:92%      │ ← BusinessObjectCards
├─────────────────────────────────────────────────────────────────┤
│ [⏸暂停][▶重启][⚙调参][📜审计][⏪时间旅行][↩回滚]              │ ← InterventionBar
│ [⛔中断][👣单步][📸快照][🔍不变量][📥导出审计][📤导入审计]    │
│ [🔄热重载]                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 ReactorStateBar phase 指示灯

| Phase | 颜色 | 含义 | 特殊提示 |
| --- | --- | --- | --- |
| `idle` | ⚪ 灰 | 空闲 | — |
| `draining` | 🟡 黄 | 排空队列中 | — |
| `executing` | 🟢 绿 | 执行中(正常) | — |
| `awaiting_io` | 🔵 蓝 | 等待 IO 回调 | 显示 pending_io 数 + "IO 等待中" |
| `stable` | 🟢 绿 | 稳定(无新 Fact) | — |
| `error` | 🔴 红 | 错误 | 异常告警面板同步显示 |

---

## 7. 数据流

### 7.1 初始化数据流

```
MonitorDashboard 挂载(mode = C, layer = L1)
  ↓
1. 获取 productionState(当前 production session_id + ruleset_version)
  ↓
2. startSSE(sessionId, baseUrl, onSessionSwitched)
  → sseConnectionStore: connecting → connected
  → EventSource 订阅 /api/sessions/{id}/events
  ↓
3. startReactorPolling(sessionId, baseUrl)
  → 2s 轮询 GET /state + /invariants + /finished
  → reactorRuntimeStore 更新
  ↓
4. startMetricsPolling(baseUrl)
  → 5s 轮询 GET /metrics
  → performanceMetricsStore 更新
  ↓
5. Fact 流开始接收(SSE fact 事件 → appendFact)
  ↓
6. 异常告警开始接收(SSE anomaly 事件 → appendAnomaly)
  ↓
7. 业务对象卡片从 Fact 流派生(businessObjects derived)
```

### 7.2 SSE Fact 流数据流

```
evorule-server SSE 推送 fact 事件
  ↓
EventSource.addEventListener("fact", ...)
  ↓
JSON.parse(event.data) → FactEvent.data
  ↓
appendFact(factData)
  → factStreamStore 更新(环形缓冲,最多 1000 条)
  ↓
FactStreamView 自动渲染新 Fact(虚拟列表)
  ↓
(若自动滚动开启)滚动到底部
  ↓
BusinessObjectCards 派生更新(从 Fact 流提取最新业务对象状态)
```

### 7.3 U7 session_switched 数据流

```
evorule-server 在旧 session SSE 流推送 session_switched 事件
  ↓
EventSource.addEventListener("session_switched", ...)
  ↓
handleSessionSwitched(event):
  1. clearFacts() — 清空旧 Fact 流
  2. clearAnomalies() — 清空旧异常
  3. resetAuditStore() — 内核 audit store 清空(三层架构 §3.9.3)
  4. onSessionSwitched(event) — 通知上层
     → productionStateStore 更新(status: switching → running)
     → SessionSwitchToast 显示"规则集已更新到 vN"
  5. connectSSE(new_session_id, baseUrl) — 订阅新 session SSE
  ↓
新 SSE 连接建立
  ↓
新 Fact 流开始接收
```

### 7.4 干预操作流(以中断为例)

```
用户点 [⛔ 中断]
  ↓
ConfirmDialog 弹出:"确认中断会话 #{sessionId}?当前执行将立即终止。"
  ↓ 用户确认
backend.interruptSession(sessionId)
  → POST /api/sessions/{sessionId}/interrupt
  ↓
reactorRuntimeStore 轮询感知 phase → error(或 idle)
  ↓
AnomalyPanel 追加:"会话已被手动中断"
  ↓
toast"会话 #{sessionId} 已中断"
```

### 7.5 回滚流(三层架构 §3.4)

```
用户点 [↩ 回滚]
  ↓
RollbackVersionPicker 弹出:列出历史 ruleset 版本(v16/v15/...)
  ↓ 用户选 v15
ConfirmDialog:"确认回滚到 ruleset v15?将用旧规则产生新版本。"
  ↓ 用户确认
backend.rollbackRuleset(15)
  → 触发滚动 session 热重载(三层架构 §3.3):
    1. POST /api/rules/reload(旧规则)
    2. POST /api/sessions/from/{old_id}(fork 新 session)
    3. 应用层切换 production_session_id
    4. SSE 推送 session_switched(U7)
  ↓
handleSessionSwitched → 自动切换到新 session
  ↓
SessionSwitchToast:"已回滚到 ruleset v15(新版本 v18)"
```

---

## 8. 关键代码示例

### 8.1 MonitorDashboard.svelte(主视图)

```svelte
<!-- src/lib/views/Home/Monitor/MonitorDashboard.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { useBackend } from '$lib/backend/backend-context';
  import { productionStateStore, onSessionSwitched } from '$lib/stores/production-state';
  import {
    startSSE,
    stopSSE,
    sseConnectionStore,
  } from '$lib/stores/sse-connection';
  import {
    startReactorPolling,
    stopReactorPolling,
    reactorRuntimeStore,
  } from '$lib/stores/reactor-runtime';
  import {
    startMetricsPolling,
    stopMetricsPolling,
    performanceMetricsStore,
  } from '$lib/stores/performance-metrics';
  import { factStreamStore } from '$lib/stores/fact-stream';
  import { anomalyStore } from '$lib/stores/anomaly';
  import { getNetConfig } from '$lib/config/net-config';
  import ConnectionBanner from './ConnectionBanner.svelte';
  import ReactorStateBar from './ReactorStateBar.svelte';
  import FactStreamView from './FactStreamView.svelte';
  import AnomalyPanel from './AnomalyPanel.svelte';
  import PerformanceMetrics from './PerformanceMetrics.svelte';
  import BusinessObjectCards from './BusinessObjectCards.svelte';
  import InterventionBar from './InterventionBar.svelte';
  import SessionSwitchToast from './SessionSwitchToast.svelte';

  const backend = useBackend();
  const productionState = $derived(get(productionStateStore));
  const connection = $derived(get(sseConnectionStore));
  const runtime = $derived(get(reactorRuntimeStore));
  const facts = $derived(get(factStreamStore));
  const anomalies = $derived(get(anomalyStore));
  const metrics = $derived(get(performanceMetricsStore));

  let switchToast = $state<string | null>(null);

  function handleSwitch(event: SessionSwitchedEvent): void {
    onSessionSwitched(event.data.new_session_id, event.data.new_ruleset_version);
    switchToast = `规则集已更新到 v${event.data.new_ruleset_version},已自动切换到新运行实例`;
    setTimeout(() => (switchToast = null), 5000);
  }

  onMount(() => {
    const sessionId = productionState?.currentSessionId;
    if (!sessionId) return;

    const { remoteBaseUrl, mode } = getNetConfig();
    const baseUrl = mode === 'offline' ? 'http://localhost:18080' : remoteBaseUrl;

    startSSE(sessionId, baseUrl, handleSwitch);
    startReactorPolling(sessionId, baseUrl);
    startMetricsPolling(baseUrl);
  });

  onDestroy(() => {
    stopSSE();
    stopReactorPolling();
    stopMetricsPolling();
  });
</script>

<div class="monitor-dashboard">
  <ConnectionBanner {connection} rulesetVersion={productionState?.rulesetVersion} />

  <ReactorStateBar {runtime} />

  <div class="main-grid">
    <FactStreamView {facts} />
    <AnomalyPanel {anomalies} />
  </div>

  <PerformanceMetrics {metrics} />

  <BusinessObjectCards {facts} />

  <InterventionBar
    sessionId={productionState?.currentSessionId}
    {backend}
  />

  {#if switchToast}
    <SessionSwitchToast message={switchToast} />
  {/if}
</div>
```

### 8.2 ReactorStateBar.svelte

```svelte
<!-- src/lib/views/Home/Monitor/ReactorStateBar.svelte -->
<script lang="ts">
  import type { ReactorRuntimeState } from '$lib/stores/reactor-runtime';

  let { runtime = null }: { runtime: ReactorRuntimeState | null } = $props();

  const phaseColor: Record<string, string> = {
    idle: 'gray',
    draining: 'yellow',
    executing: 'green',
    awaiting_io: 'blue',
    stable: 'green',
    error: 'red',
  };

  const phaseLabel: Record<string, string> = {
    idle: '空闲',
    draining: '排空中',
    executing: '执行中',
    awaiting_io: 'IO 等待',
    stable: '稳定',
    error: '错误',
  };

  const isError = $derived(runtime?.phase === 'error');
  const hasInvariantViolation = $derived((runtime?.invariantViolations ?? 0) > 0);
  const isAwaitingIO = $derived(runtime?.phase === 'awaiting_io');
</script>

<div class="reactor-state-bar" class:error={isError} class:invariant-violation={hasInvariantViolation}>
  <div class="phase-indicator" style="color: {runtime ? phaseColor[runtime.phase] : 'gray'}">
    ● {runtime ? phaseLabel[runtime.phase] : '未连接'}
  </div>

  {#if runtime}
    <span class="metric">depth: {runtime.causalDepth}</span>
    <span class="metric">step: {runtime.currentStep}</span>

    {#if isAwaitingIO}
      <span class="io-await">⏳ IO 等待中 (pending: {runtime.pendingIoCount})</span>
    {:else}
      <span class="metric">pending_io: {runtime.pendingIoCount}</span>
    {/if}

    <span class="invariant-badge" class:violation={hasInvariantViolation}>
      {hasInvariantViolation ? '🔴' : '✅'} invariants: {runtime.invariantViolations}
    </span>

    <span class="version">v{runtime.reactorVersion}</span>
  {/if}
</div>
```

### 8.3 FactStreamView.svelte(虚拟列表)

```svelte
<!-- src/lib/views/Home/Monitor/FactStreamView.svelte -->
<script lang="ts">
  import VirtualList from '$lib/components/VirtualList.svelte';
  import FactCard from './FactCard.svelte';
  import { findTermsByPrefix } from '$lib/stores/business-terms';
  import type { FactEvent } from '$lib/stores/sse-events';

  let {
    facts = [],
  }: { facts: FactEvent['data'][] } = $props();

  let autoScroll = $state(true);
  let listEl: HTMLElement | null = $state(null);

  // 新 Fact 到达时自动滚动
  $effect(() => {
    if (autoScroll && listEl && facts.length > 0) {
      requestAnimationFrame(() => {
        listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
      });
    }
  });
</script>

<div class="fact-stream">
  <div class="header">
    <h3>Fact 流</h3>
    <label>
      <input type="checkbox" bind:checked={autoScroll} />
      自动滚动
    </label>
  </div>

  <div class="list" bind:this={listEl}>
    {#each facts as fact (fact.fact_id)}
      <FactCard {fact} />
    {:else}
      <div class="empty">等待 Fact...</div>
    {/each}
  </div>

  <div class="footer">{facts.length} 条(最多 1000 条)</div>
</div>
```

### 8.4 InterventionBar.svelte(13 按钮)

```svelte
<!-- src/lib/views/Home/Monitor/InterventionBar.svelte -->
<script lang="ts">
  import { useBackend } from '$lib/backend/backend-context';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import RollbackVersionPicker from './RollbackVersionPicker.svelte';

  let { sessionId = null }: { sessionId: number | null } = $props() = $props();

  const backend = useBackend();

  let confirmAction = $state<{
    label: string;
    message: string;
    handler: () => Promise<void>;
  } | null>(null);

  let showRollbackPicker = $state(false);

  async function doInterrupt(): Promise<void> {
    if (!sessionId) return;
    await backend.interruptSession(sessionId);
  }

  async function doStep(): Promise<void> {
    if (!sessionId) return;
    await backend.stepSession(sessionId);
  }

  async function doSnapshot(): Promise<void> {
    if (!sessionId) return;
    await backend.snapshotSession(sessionId);
  }

  async function doExportAudit(): Promise<void> {
    if (!sessionId) return;
    const data = await backend.exportAudit(sessionId);
    // 触发文件下载
    downloadJson(data, `audit-session-${sessionId}.json`);
  }

  function requestConfirm(
    label: string,
    message: string,
    handler: () => Promise<void>,
  ): void {
    confirmAction = { label, message, handler };
  }

  async function executeConfirmed(): Promise<void> {
    if (!confirmAction) return;
    try {
      await confirmAction.handler();
    } catch (e) {
      alert(`操作失败: ${(e as Error).message}`);
    }
    confirmAction = null;
  }
</script>

<div class="intervention-bar">
  <!-- P1 操作(暂未实现) -->
  <button disabled title="P1 实现">⏸ 暂停</button>
  <button disabled title="P1 实现">▶ 重启</button>
  <button disabled title="P1 实现">⚙ 调参</button>

  <!-- 审计 + 时间旅行 -->
  <button onclick={() => goto('/view/audit')}>📜 审计</button>
  <button onclick={() => goto('/view/timetravel')}>⏪ 时间旅行</button>

  <!-- 回滚 -->
  <button onclick={() => (showRollbackPicker = true)}>↩ 回滚</button>

  <!-- 干预操作(需二次确认) -->
  <button
    class="danger"
    onclick={() => requestConfirm('中断会话', `确认中断会话 #${sessionId}?当前执行将立即终止。`, doInterrupt)}
  >
    ⛔ 中断
  </button>
  <button onclick={() => requestConfirm('单步执行', `确认单步执行会话 #${sessionId}?`, doStep)}>
    👣 单步
  </button>
  <button onclick={doSnapshot}>📸 快照</button>
  <button onclick={() => goto('/view/invariants')}>🔍 不变量</button>

  <!-- 审计导出/导入 -->
  <button onclick={doExportAudit}>📥 导出审计</button>
  <button onclick={() => goto('/settings/audit-import')}>📤 导入审计</button>

  <!-- 热重载 -->
  <button onclick={() => goto('/workspace')}>🔄 热重载</button>
</div>

{#if confirmAction}
  <ConfirmDialog
    title={confirmAction.label}
    message={confirmAction.message}
    onConfirm={executeConfirmed}
    onCancel={() => (confirmAction = null)}
  />
{/if}

{#if showRollbackPicker}
  <RollbackVersionPicker
    {sessionId}
    {backend}
    onClose={() => (showRollbackPicker = false)}
  />
{/if}
```

### 8.5 BusinessObjectCards.svelte(从 Fact 流派生)

```svelte
<!-- src/lib/views/Home/Monitor/BusinessObjectCards.svelte -->
<script lang="ts">
  import { derived } from 'svelte/store';
  import { factStreamStore } from '$lib/stores/fact-stream';
  import { generateStructuredPreview } from '$lib/stores/business-preview';
  import type { FactEvent } from '$lib/stores/sse-events';

  let { facts = [] }: { facts: FactEvent['data'][] } = $props();

  /**
   * 从 Fact 流派生业务对象状态
   * 按业务对象类型分组,取每个对象的最新状态
   */
  const businessObjects = $derived.by(() => {
    const objects = new Map<string, { type: string; id: string; state: unknown; updatedAt: string }>();

    // 从后往前遍历(最新的在前),每个对象只取第一条(最新)
    for (let i = facts.length - 1; i >= 0; i--) {
      const fact = facts[i];
      const objKey = `${fact.fact_type}:${(fact.content as any)?.id ?? fact.fact_id}`;

      if (!objects.has(objKey)) {
        objects.set(objKey, {
          type: fact.fact_type,
          id: (fact.content as any)?.id ?? fact.fact_id,
          state: fact.content,
          updatedAt: fact.timestamp,
        });
      }
    }

    return Array.from(objects.values()).slice(0, 10); // 最多显示 10 个
  });

  /**
   * 信心评分(P0 简化版):
   * - 有 invariants 违规 → 50%
   * - 有 error 级 anomaly → 60%
   * - 正常 → 90%
   * P1+ 替换为 server 提供的信心评分
   */
  function confidenceScore(type: string): number {
    return 90; // P0 简化,固定 90%
  }
</script>

<div class="business-objects">
  <h3>业务对象</h3>
  <div class="cards">
    {#each businessObjects as obj}
      <div class="object-card">
        <div class="header">
          <span class="type">{obj.type}</span>
          <span class="id">{obj.id}</span>
        </div>
        <div class="state">{JSON.stringify(obj.state).slice(0, 200)}</div>
        <div class="footer">
          <span class="updated">{obj.updatedAt}</span>
          <span class="confidence" title="信心评分">信心: {confidenceScore(obj.type)}%</span>
        </div>
      </div>
    {:else}
      <div class="empty">暂无业务对象</div>
    {/each}
  </div>
</div>
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

| 测试目标 | 测试文件 | 覆盖点 |
| --- | --- | --- |
| factStreamStore | `fact-stream.test.ts` | appendFact 环形缓冲(1000 条上限) + clearFacts |
| anomalyStore | `anomaly.test.ts` | appendAnomaly(最多 100 条) + 按 level 筛选 |
| sseConnectionStore | `sse-connection.test.ts` | 连接/重连(3 次指数退避)/降级轮询/session_switched |
| reactorRuntimeStore | `reactor-runtime.test.ts` | 2s 轮询 + state/invariants/finished 并发获取 |
| SSE 事件解析 | `sse-events.test.ts` | fact/anomaly/session_switched/heartbeat JSON 解析 |
| BusinessObjectCards 派生 | `business-objects.test.ts` | Fact 流 → 业务对象分组 + 最新状态 |

### 9.2 SSE 连接测试

```typescript
// sse-connection.test.ts
describe("SSE 连接管理", () => {
  it("连接成功 → status: connected", () => {
    // mock EventSource
    // 验证 sseConnectionStore.status === "connected"
  });

  it("断连 → 3 次指数退避重连", () => {
    // mock EventSource error
    // 验证 retryCount: 1→2→3, delay: 2s→4s→8s
  });

  it("3 次失败 → 降级轮询(5s)", () => {
    // mock 3 次失败
    // 验证 status: "degraded", pollTimer 存在
  });

  it("session_switched → 清空旧数据 + 订阅新 session", () => {
    // mock session_switched 事件
    // 验证 factStreamStore 清空 + 新 EventSource 连接 new_session_id
  });
});
```

### 9.3 E2E 测试(Playwright)

| 测试路径 | 步骤 |
| --- | --- |
| 大屏初始化 | 登录→有库→进 L1→验证 SSE 连接 + Fact 流渲染 + ReactorStateBar |
| 中断操作 | 点[中断]→二次确认→验证 phase 变 error + 异常告警 |
| 回滚操作 | 点[回滚]→选版本→确认→验证 session_switched toast |
| 导出审计 | 点[导出审计]→验证文件下载 |
| SSE 断连 | 模拟网络断开→验证红色横幅→重连→恢复 |
| session 切换 | 模热重载→验证 session_switched toast + Fact 流清空 + 新流 |

---

## 10. 与其他文档的关系

### 10.1 与三层架构的关系

| 三层架构章节 | P0-5 对应 |
| --- | --- |
| §3.1 Production Runtime 职责 | §1.2 三层架构定位 |
| §3.2 监控大屏设计 | §6 组件树 + §7 数据流 |
| §3.5 时间旅行 | InterventionBar [⏪ 时间旅行] 按钮 |
| §3.6 io_request/io_response | ReactorStateBar awaiting_io 指示 |
| §3.7 干预操作完整集 | InterventionBar 13 按钮 |
| §3.8 共享事实 | BusinessObjectCards 数据来源 |
| §3.9 内核 store | resetAuditStore / reactorVersion |
| §13 运维层 | PerformanceMetrics 消费 /metrics |

### 10.2 与 HOME_DESIGN 的关系

| HOME_DESIGN 章节 | P0-5 展开 |
| --- | --- |
| §5.4 MonitorDashboard 组件树 | §6 完整组件树(实施级) |
| §5.4.1 InterventionBar | §6.3 + §8.4 13 按钮完整实现 |
| §6.5 productionStateStore | §5.4 SSE session_switched 联动 |
| §7.6 SSE 切换通知数据流 | §7.3 U7 数据流 |

### 10.3 与战略文档的关系

| 战略文档章节 | 本设计文档章节 |
| --- | --- |
| §20.2 P0-5 业务仪表板 + 业务状态 | §1-§10(全文) |
| §15.5 步骤 6-7 看运行时 + 指标 | §6 MonitorDashboard + §7 数据流 |

---

## 11. 长期演进路径

### 11.1 P0 → P1

| P0 | P1+ |
| --- | --- |
| 前端轮询 ReactorState | SSE 推送 state 变化(server 增强) |
| 简单信心评分(固定 90%) | server 提供信心评分(基于规则匹配度) |
| 文本异常告警 | 告警多通道(邮件/短信/WebSocket) |
| 固定布局 | 自定义仪表板布局(拖拽) |

### 11.2 P2

- 告警去抖/聚合(防止告警风暴)
- 历史回放大屏(结合时间旅行,回放某时段的监控大屏)
- 多 session 并行监控(多 tab 大屏)

---

## 12. 代码变更列表

### 12.1 新增文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/stores/fact-stream.ts` | Store | Fact 流环形缓冲 |
| `src/lib/stores/anomaly.ts` | Store | 异常告警列表 |
| `src/lib/stores/reactor-runtime.ts` | Store | Reactor 运行态(2s 轮询) |
| `src/lib/stores/sse-connection.ts` | Store | SSE 连接管理 + 重连 + 降级 |
| `src/lib/stores/performance-metrics.ts` | Store | 性能指标(5s 轮询) |
| `src/lib/stores/sse-events.ts` | Types | SSE 事件类型定义 |
| `src/lib/views/Home/Monitor/MonitorDashboard.svelte` | Component | L1 主视图 |
| `src/lib/views/Home/Monitor/ConnectionBanner.svelte` | Component | 连接状态横幅 |
| `src/lib/views/Home/Monitor/ReactorStateBar.svelte` | Component | Reactor 运行态栏 |
| `src/lib/views/Home/Monitor/FactStreamView.svelte` | Component | Fact 流虚拟列表 |
| `src/lib/views/Home/Monitor/FactCard.svelte` | Component | Fact 卡片(业务化) |
| `src/lib/views/Home/Monitor/AnomalyPanel.svelte` | Component | 异常告警面板 |
| `src/lib/views/Home/Monitor/PerformanceMetrics.svelte` | Component | 性能指标区 |
| `src/lib/views/Home/Monitor/BusinessObjectCards.svelte` | Component | 业务对象卡片 |
| `src/lib/views/Home/Monitor/InterventionBar.svelte` | Component | 13 按钮干预操作 |
| `src/lib/views/Home/Monitor/ConfirmDialog.svelte` | Component | 二次确认弹窗 |
| `src/lib/views/Home/Monitor/RollbackVersionPicker.svelte` | Component | 回滚版本选择器 |
| `src/lib/views/Home/Monitor/SessionSwitchToast.svelte` | Component | U7 切换 toast |
| `src/lib/components/VirtualList.svelte` | Component | 虚拟列表通用组件 |

---

## 13. 待办

- [ ] server SSE 推送 ReactorState 变化(P1,替代轮询)
- [ ] server 信心评分 API(P1)
- [ ] 告警多通道(邮件/短信)(P1)
- [ ] 自定义仪表板布局(P2)
- [ ] 告警去抖/聚合(P2)
- [ ] 历史回放大屏(P2)

---

> 设计文档 — 2026-08-06 定稿
