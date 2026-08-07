// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务事件 store(CRUD + LLM 翻译 + 提交)。
// 业务事件分两层:表单层(业务专家可读)+ 指令层(LLM 翻译的 instruction JSON)。
//
// 持久化:localStorage(key: evorule-console-cloud:business-events)
//
// 关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §4.1 + §5.2 + §7.1/§7.2(数据流)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import type { CommandResult, ExecutionBackend } from "@evorule/console";
import type { LlmAssistant } from "$lib/assistant/types";
import { getTemplate } from "./business-event-templates";

/** LLM 翻译状态 */
export type TranslateStatus = "idle" | "translating" | "translated" | "error";

/** 业务事件(表单层 + 指令层) */
export interface BusinessEvent {
  /** 事件 ID(前端生成) */
  id: string;
  /** 事件模板 ID */
  templateId: string;
  /** 事件名称(用户可改,默认取模板名) */
  name: string;
  /** 表单数据(业务专家填写) */
  formData: Record<string, unknown>;
  /** LLM 翻译后的 instruction(内核 4 元素指令 JSON) */
  instruction: object | null;
  /** LLM 翻译状态 */
  translateStatus: TranslateStatus;
  /** LLM 翻译错误信息 */
  translateError: string | null;
  /** 提交历史(最近一次 CommandResult) */
  lastResult: CommandResult | null;
  /** 创建时间 */
  createdAt: string;
  /** 最后提交时间 */
  lastSubmittedAt: string | null;
}

const STORAGE_KEY = "evorule-console-cloud:business-events";

function loadEvents(): BusinessEvent[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BusinessEvent[];
  } catch {
    return [];
  }
}

export const businessEventStore = writable<BusinessEvent[]>(loadEvents());

/** 持久化 */
businessEventStore.subscribe((events) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
});

/** 当前编辑的事件 ID */
export const currentEventId = writable<string | null>(null);

/** 当前编辑的事件(派生) */
export const currentEvent = derived(
  [businessEventStore, currentEventId],
  ([$events, $id]) => $events.find((e) => e.id === $id) ?? null,
);

function genId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 按 ID 获取事件(非响应式) */
export function getEvent(id: string): BusinessEvent | undefined {
  return get(businessEventStore).find((e) => e.id === id);
}

// === CRUD ===

/**
 * 从模板创建业务事件(预填示例数据,translateStatus=idle)。
 * @returns 新事件 ID
 */
export function createEventFromTemplate(templateId: string): string {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error(`业务事件模板 ${templateId} 不存在`);
  }

  const id = genId();
  const event: BusinessEvent = {
    id,
    templateId,
    name: template.name,
    formData: { ...template.sampleData },
    instruction: null,
    translateStatus: "idle",
    translateError: null,
    lastResult: null,
    createdAt: nowIso(),
    lastSubmittedAt: null,
  };
  businessEventStore.update((all) => [...all, event]);
  return id;
}

/** 更新表单数据(用户编辑表单时调用;清空已翻译的 instruction,需重新翻译) */
export function updateFormData(
  eventId: string,
  formData: Record<string, unknown>,
): void {
  businessEventStore.update((all) =>
    all.map((e) =>
      e.id === eventId
        ? {
            ...e,
            formData,
            // 表单变了,之前的翻译失效
            instruction: null,
            translateStatus: "idle" as TranslateStatus,
            translateError: null,
          }
        : e,
    ),
  );
}

/** 更新 instruction(开发者模式手写,跳过 LLM 翻译) */
export function updateInstruction(
  eventId: string,
  instruction: object,
): void {
  businessEventStore.update((all) =>
    all.map((e) =>
      e.id === eventId
        ? {
            ...e,
            instruction,
            translateStatus: "translated" as TranslateStatus,
            translateError: null,
          }
        : e,
    ),
  );
}

/** 更新事件名称 */
export function updateEventName(eventId: string, name: string): void {
  businessEventStore.update((all) =>
    all.map((e) => (e.id === eventId ? { ...e, name } : e)),
  );
}

/** 删除事件 */
export function deleteEvent(eventId: string): void {
  businessEventStore.update((all) => all.filter((e) => e.id !== eventId));
  // 若删除的是当前事件,清空 currentEventId
  if (get(currentEventId) === eventId) {
    currentEventId.set(null);
  }
}

// === LLM 翻译 ===

/**
 * 触发 LLM 翻译(表单数据 → instruction JSON)。
 * 翻译流程(设计 §7.2):
 * 1. translateStatus = "translating"
 * 2. 组装 prompt:template.translatePrompt.replace("{formData}", JSON.stringify(formData))
 * 3. assistant.generateInput(prompt) → 返回 object
 * 4. translateStatus = "translated", instruction = result
 * 5. 失败 → translateStatus = "error", translateError = 错误信息
 *
 * @param eventId 事件 ID
 * @param assistant LLM Assistant(需已配置)
 */
export async function translateEvent(
  eventId: string,
  assistant: LlmAssistant,
): Promise<void> {
  const event = getEvent(eventId);
  if (!event) {
    throw new Error(`业务事件 ${eventId} 不存在`);
  }

  const template = getTemplate(event.templateId);
  if (!template) {
    throw new Error(`事件模板 ${event.templateId} 不存在`);
  }

  // 标记翻译中
  businessEventStore.update((all) =>
    all.map((e) =>
      e.id === eventId
        ? {
            ...e,
            translateStatus: "translating" as TranslateStatus,
            translateError: null,
          }
        : e,
    ),
  );

  try {
    // 组装 prompt
    const prompt = template.translatePrompt.replace(
      "{formData}",
      JSON.stringify(event.formData, null, 2),
    );

    // 调 LLM 翻译
    const instruction = await assistant.generateInput(prompt);

    // 翻译成功
    businessEventStore.update((all) =>
      all.map((e) =>
        e.id === eventId
          ? {
              ...e,
              instruction,
              translateStatus: "translated" as TranslateStatus,
              translateError: null,
            }
          : e,
      ),
    );
  } catch (err) {
    // 翻译失败
    const message =
      err instanceof Error ? err.message : "LLM 翻译失败,未知错误";
    businessEventStore.update((all) =>
      all.map((e) =>
        e.id === eventId
          ? {
              ...e,
              translateStatus: "error" as TranslateStatus,
              translateError: message,
            }
          : e,
      ),
    );
    throw err;
  }
}

// === 提交 ===

/**
 * 提交业务事件到 session(调内核 submitCommand)。
 * 设计 §7.1 步骤 5:
 * 1. 校验 instruction 已翻译(translated 状态)
 * 2. backend.submitCommand(sessionId, instruction)
 * 3. 更新 lastResult + lastSubmittedAt
 *
 * @returns CommandResult
 */
export async function submitEvent(
  eventId: string,
  sessionId: number,
  backend: ExecutionBackend,
): Promise<CommandResult> {
  const event = getEvent(eventId);
  if (!event) {
    throw new Error(`业务事件 ${eventId} 不存在`);
  }
  if (!event.instruction) {
    throw new Error("业务事件尚未翻译为 instruction,无法提交");
  }

  const result = await backend.submitCommand(sessionId, event.instruction);
  const now = nowIso();

  businessEventStore.update((all) =>
    all.map((e) =>
      e.id === eventId
        ? { ...e, lastResult: result, lastSubmittedAt: now }
        : e,
    ),
  );

  return result;
}
