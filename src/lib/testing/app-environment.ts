// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// $app/environment 测试替身(仅 vitest 生效,见 vite.config.ts resolve.alias)
//
// 为什么需要:组件测试基建(Svelte 5 mount 须 svelte browser 构建)给 vitest
// 全局注入 resolve.conditions=['browser'],这会让 $app/environment 的 browser
// 构建在 node 单测里也返回 browser=true,大量依赖 browser 守卫的模块在无
// window 的 node 环境直接崩(window is not defined)。
// 本替身按真实运行环境判定:node 单测=false(原状),jsdom 组件测试=true(正确语义)。
// 仓库实际只用 browser 一个导出;dev/version/building 仅为对齐 kit 官方导出面。

declare const window: unknown;

export const browser: boolean = typeof window !== 'undefined';
export const dev: boolean = true;
export const version: string = 'test';
export const building: boolean = false;
