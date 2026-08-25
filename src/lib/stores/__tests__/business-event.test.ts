// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// business-event + business-event-templates 单测
//
// 运行: npx vitest run src/lib/stores/__tests__/business-event.test.ts
//
// 关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §4.1 + §5.2 + §7.1/§7.2

import { describe, test, expect, vi, beforeEach } from "vitest";
import { get as storeGet } from "svelte/store";

const { mockLocalStorage, mockBrowser, mockLs } = vi.hoisted(() => {
  const storage: Record<string, string> = {};
  const ls = {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete storage[key];
    }),
    clear: vi.fn(() => {
      Object.keys(storage).forEach((k) => delete storage[k]);
    }),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: ls,
    writable: true,
    configurable: true,
  });
  return {
    mockLocalStorage: storage,
    mockBrowser: { browser: true },
    mockLs: ls,
  };
});

vi.mock("$app/environment", () => ({
  get browser() {
    return mockBrowser.browser;
  },
}));

import {
  BUILTIN_TEMPLATES,
  getTemplate,
  templatesByIndustry,
} from "$lib/stores/business-event-templates";
import {
  businessEventStore,
  createEventFromTemplate,
  getEvent,
  updateFormData,
  updateInstruction,
  updateEventName,
  deleteEvent,
  currentEventId,
  type TranslateStatus,
  type BusinessEvent,
} from "$lib/stores/business-event";

beforeEach(() => {
  mockLs.clear.mockClear();
  mockLs.getItem.mockClear();
  mockLs.setItem.mockClear();
  mockLs.removeItem.mockClear();
  Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
  businessEventStore.set([]);
  currentEventId.set(null);
});

// ============================================================================
// business-event-templates
// ============================================================================

describe("BUILTIN_TEMPLATES - 内置模板数量与 getTemplate", () => {
  test("BUILTIN_TEMPLATES 至少有 3 个模板", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  test("getTemplate(id) 返回正确的模板", () => {
    const patientVisit = getTemplate("patient_visit");
    expect(patientVisit).toBeDefined();
    expect(patientVisit?.id).toBe("patient_visit");
    expect(patientVisit?.name).toBe("病人就诊");
    expect(patientVisit?.industry).toBe("medical");

    const drugPrescribe = getTemplate("drug_prescribe");
    expect(drugPrescribe).toBeDefined();
    expect(drugPrescribe?.id).toBe("drug_prescribe");
    expect(drugPrescribe?.name).toBe("药品开具");

    const invoiceApprove = getTemplate("invoice_approve");
    expect(invoiceApprove).toBeDefined();
    expect(invoiceApprove?.id).toBe("invoice_approve");
    expect(invoiceApprove?.industry).toBe("finance");
  });

  test("getTemplate 不存在的 id 返回 undefined", () => {
    expect(getTemplate("non_existent")).toBeUndefined();
  });
});

describe("templatesByIndustry - 按行业过滤", () => {
  test("templatesByIndustry('medical') 过滤出 2 个医疗模板", () => {
    const medical = templatesByIndustry("medical");
    expect(medical).toHaveLength(2);
    expect(medical.map((t) => t.id).sort()).toEqual(
      ["patient_visit", "drug_prescribe"].sort(),
    );
    medical.forEach((t) => expect(t.industry).toBe("medical"));
  });

  test("templatesByIndustry('finance') 过滤出 1 个财务模板", () => {
    const finance = templatesByIndustry("finance");
    expect(finance).toHaveLength(1);
    expect(finance[0].id).toBe("invoice_approve");
    expect(finance[0].industry).toBe("finance");
  });

  test("templatesByIndustry 不存在的行业返回空数组", () => {
    expect(templatesByIndustry("nonexistent" as never)).toEqual([]);
  });
});

// ============================================================================
// business-event CRUD
// ============================================================================

describe("createEventFromTemplate + getEvent - 从模板创建事件", () => {
  test("createEventFromTemplate 从 patient_visit 创建事件", () => {
    const eventId = createEventFromTemplate("patient_visit");
    expect(eventId).toBeTruthy();
    expect(eventId.startsWith("evt_")).toBe(true);

    const event = getEvent(eventId);
    expect(event).toBeDefined();
    expect(event?.id).toBe(eventId);
    expect(event?.templateId).toBe("patient_visit");
    expect(event?.name).toBe("病人就诊");
    expect(event?.formData).toEqual({
      patientId: "P-1283",
      temperature: 39.2,
      symptom: "fever",
      age: 65,
    });
    expect(event?.instruction).toBeNull();
    expect(event?.translateStatus).toBe("idle");
    expect(event?.translateError).toBeNull();
    expect(event?.lastResult).toBeNull();
    expect(event?.createdAt).toBeTruthy();
    expect(event?.lastSubmittedAt).toBeNull();
  });

  test("createEventFromTemplate 从 invoice_approve 创建事件", () => {
    const eventId = createEventFromTemplate("invoice_approve");
    const event = getEvent(eventId);
    expect(event?.templateId).toBe("invoice_approve");
    expect(event?.name).toBe("发票审批");
    expect(event?.formData).toEqual({
      invoiceId: "INV-2026-001",
      amount: 50000,
      department: "急诊科",
      urgency: "urgent",
    });
  });

  test("createEventFromTemplate 不存在的模板抛错", () => {
    expect(() => createEventFromTemplate("bad_tpl")).toThrow(
      /业务事件模板 bad_tpl 不存在/,
    );
  });

  test("getEvent 不存在的 id 返回 undefined", () => {
    expect(getEvent("evt_nonexistent")).toBeUndefined();
  });

  test("多次创建事件,store 中数量正确", () => {
    const id1 = createEventFromTemplate("patient_visit");
    const id2 = createEventFromTemplate("drug_prescribe");
    const id3 = createEventFromTemplate("invoice_approve");

    const events = storeGet(businessEventStore);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id).sort()).toEqual([id1, id2, id3].sort());
  });
});

describe("updateFormData - 更新表单数据", () => {
  test("updateFormData 写入 formData 对应字段并重置翻译状态", () => {
    const eventId = createEventFromTemplate("patient_visit");

    const instructionBefore = { domain: "medical", action: "test" };
    updateInstruction(eventId, instructionBefore);
    expect(getEvent(eventId)?.translateStatus).toBe("translated");

    updateFormData(eventId, {
      patientId: "P-9999",
      temperature: 38.5,
      symptom: "cough",
      age: 30,
    });

    const event = getEvent(eventId);
    expect(event?.formData.patientId).toBe("P-9999");
    expect(event?.formData.temperature).toBe(38.5);
    expect(event?.formData.symptom).toBe("cough");
    expect(event?.formData.age).toBe(30);
    expect(event?.instruction).toBeNull();
    expect(event?.translateStatus).toBe("idle");
    expect(event?.translateError).toBeNull();
  });

  test("updateFormData 不影响其他事件", () => {
    const id1 = createEventFromTemplate("patient_visit");
    const id2 = createEventFromTemplate("drug_prescribe");

    updateFormData(id1, { patientId: "P-1", temperature: 37, symptom: "cough", age: 20 });

    expect(getEvent(id1)?.formData.patientId).toBe("P-1");
    expect(getEvent(id2)?.formData.patientId).toBe("P-1283");
  });
});

describe("updateInstruction - 更新 instruction", () => {
  test("updateInstruction 正确写入并将状态置为 translated", () => {
    const eventId = createEventFromTemplate("patient_visit");
    const instruction = {
      domain: "medical",
      action: "patient_visit",
      payload: { patientId: "P-1" },
      meta: { ts: 1 },
    };

    updateInstruction(eventId, instruction);

    const event = getEvent(eventId);
    expect(event?.instruction).toEqual(instruction);
    expect(event?.translateStatus).toBe("translated");
    expect(event?.translateError).toBeNull();
  });

  test("updateInstruction 覆盖之前的 error 状态", () => {
    const eventId = createEventFromTemplate("patient_visit");
    businessEventStore.update((all) =>
      all.map((e) =>
        e.id === eventId
          ? { ...e, translateStatus: "error" as TranslateStatus, translateError: "旧错误" }
          : e,
      ),
    );
    expect(getEvent(eventId)?.translateStatus).toBe("error");

    updateInstruction(eventId, { foo: "bar" });
    const event = getEvent(eventId);
    expect(event?.translateStatus).toBe("translated");
    expect(event?.translateError).toBeNull();
  });
});

describe("updateEventName / deleteEvent - CRUD 收尾", () => {
  test("updateEventName 修改事件名称", () => {
    const eventId = createEventFromTemplate("patient_visit");
    expect(getEvent(eventId)?.name).toBe("病人就诊");

    updateEventName(eventId, "张三就诊 2026-08-07");
    expect(getEvent(eventId)?.name).toBe("张三就诊 2026-08-07");
  });

  test("deleteEvent 删除事件", () => {
    const id1 = createEventFromTemplate("patient_visit");
    const id2 = createEventFromTemplate("drug_prescribe");

    expect(storeGet(businessEventStore)).toHaveLength(2);

    deleteEvent(id1);

    expect(storeGet(businessEventStore)).toHaveLength(1);
    expect(getEvent(id1)).toBeUndefined();
    expect(getEvent(id2)).toBeDefined();
  });

  test("deleteEvent 删除当前事件时清空 currentEventId", () => {
    const eventId = createEventFromTemplate("patient_visit");
    currentEventId.set(eventId);
    expect(storeGet(currentEventId)).toBe(eventId);

    deleteEvent(eventId);
    expect(storeGet(currentEventId)).toBeNull();
  });

  test("deleteEvent 删除非当前事件时 currentEventId 不变", () => {
    const id1 = createEventFromTemplate("patient_visit");
    const id2 = createEventFromTemplate("drug_prescribe");
    currentEventId.set(id2);

    deleteEvent(id1);
    expect(storeGet(currentEventId)).toBe(id2);
  });
});

// ============================================================================
// TranslateStatus 枚举 + localStorage Mock 验证
// ============================================================================

describe("TranslateStatus 枚举值验证", () => {
  test("TranslateStatus 取值覆盖 idle/translating/translated/error", () => {
    const eventId = createEventFromTemplate("patient_visit");
    const setStatus = (s: TranslateStatus) => {
      businessEventStore.update((all) =>
        all.map((e) => (e.id === eventId ? { ...e, translateStatus: s } : e)),
      );
    };

    setStatus("idle");
    expect(getEvent(eventId)?.translateStatus).toBe("idle");

    setStatus("translating");
    expect(getEvent(eventId)?.translateStatus).toBe("translating");

    setStatus("translated");
    expect(getEvent(eventId)?.translateStatus).toBe("translated");

    setStatus("error");
    expect(getEvent(eventId)?.translateStatus).toBe("error");
  });
});

describe("localStorage Mock - 避免持久化污染", () => {
  test("每个 beforeEach 清空 mockLocalStorage,不跨测试污染", () => {
    const eventId = createEventFromTemplate("patient_visit");
    const events = storeGet(businessEventStore);
    expect(events).toHaveLength(1);

    expect(mockLs.setItem).toHaveBeenCalled();
  });

  test("独立测试不共享状态(本测试初始应为空)", () => {
    expect(storeGet(businessEventStore)).toEqual([]);
  });
});
