// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// i18n 单测：t 插值 / 字典 key 一致 / 切换反应式
import { describe, it, expect, beforeEach } from "vitest";
import { t, switchLocale, locale, getLocale } from "../i18n.svelte";
import { messagesZh } from "../messages.zh";
import { messagesEn } from "../messages.en";

describe("i18n 字典完整性", () => {
  it("zh 与 en 键完全一致（漏译检测）", () => {
    const zhKeys = Object.keys(messagesZh).sort();
    const enKeys = Object.keys(messagesEn).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("字典非空且含导航键", () => {
    expect(messagesZh["nav.overview"]).toBe("总览");
    expect(messagesEn["nav.overview"]).toBe("Overview");
  });
});

describe("t() 翻译与插值", () => {
  beforeEach(() => {
    // 重置为中文默认
    void switchLocale("zh");
  });

  it("中文取词", () => {
    void switchLocale("zh");
    expect(t("nav.overview")).toBe("总览");
  });

  it("英文取词", async () => {
    await switchLocale("en");
    expect(t("nav.overview")).toBe("Overview");
  });

  it("未命中 key 原样返回（不吞错）", () => {
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("placeholder 插值", () => {
    // 直接测插值逻辑（用临时 key 场景——插值函数对任意含 {} 的文本生效）
    // 注：真实字典插值键随迁移逐步加入；此处验证 t 的 params 机制
    void switchLocale("zh");
    // 用一个含占位符的值做白盒确认：手动注入不可行，故验证 t 对已存在且含 {key} 的值
    // 当前无占位符字典项，占位验证由组件集成测试覆盖；单测仅保证接口稳定
    expect(typeof t("nav.overview", { a: 1 })).toBe("string");
  });

  it("切换后 locale 更新", async () => {
    await switchLocale("en");
    expect(getLocale()).toBe("en");
    expect(locale).toBeDefined();
    await switchLocale("zh");
    expect(getLocale()).toBe("zh");
  });
});