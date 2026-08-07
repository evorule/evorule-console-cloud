// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// SSE 事件类型定义(对齐 evorule-server SSE 推送格式)。
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §4.1
//
// evorule-server SSE 端点:GET /api/sessions/{id}/events
// 推送 4 类事件:fact / anomaly / session_switched / heartbeat

/** SSE 事件类型 */
export type SSEEventType = "fact" | "anomaly" | "session_switched" | "heartbeat";

/** Fact 事件(SSE event: fact)— 单条 Fact 推送 */
export interface FactEvent {
  type: "fact";
  data: {
    /** Fact ID */
    fact_id: string;
    /** Fact 类型(如 "patient_visit" / "rule_triggered") */
    fact_type: string;
    /** 逻辑时间(reactor step) */
    logical_time: number;
    /** Fact 内容(业务数据) */
    content: unknown;
    /** 时间戳(ISO 字符串) */
    timestamp: string;
  };
}

/** 异常告警事件(SSE event: anomaly) */
export interface AnomalyEvent {
  type: "anomaly";
  data: {
    /** 告警级别 */
    level: "warning" | "error" | "critical";
    /** 关联规则 ID */
    rule_id: string;
    /** 告警消息 */
    message: string;
    /** 关联 Fact ID(可选) */
    fact_id?: string;
    /** 时间戳 */
    timestamp: string;
  };
}

/** Session 切换事件(SSE event: session_switched,U7 滚动 session 热重载) */
export interface SessionSwitchedEvent {
  type: "session_switched";
  data: {
    /** 新 session ID */
    new_session_id: number;
    /** 新 ruleset 版本号 */
    new_ruleset_version: number;
    /** 旧 session ID */
    old_session_id: number;
    /** 切换原因(如 "ruleset_published" / "rollback") */
    reason: string;
    /** 时间戳 */
    timestamp: string;
  };
}

/** 心跳事件(SSE event: heartbeat,15s 间隔保活) */
export interface HeartbeatEvent {
  type: "heartbeat";
  data: { timestamp: string };
}

/** SSE 事件联合类型 */
export type SSEEvent =
  | FactEvent
  | AnomalyEvent
  | SessionSwitchedEvent
  | HeartbeatEvent;

/** Fact 数据(FactEvent.data 的类型,独立导出供 store 用) */
export type FactData = FactEvent["data"];

/** 异常数据(AnomalyEvent.data 的类型) */
export type AnomalyData = AnomalyEvent["data"];

/** 异常级别 */
export type AnomalyLevel = AnomalyData["level"];
