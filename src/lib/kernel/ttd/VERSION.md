# ttd (Time-Travel Debugger) — evorule-console 内嵌副本

> **Source**: `time-travel-debugger/` (同仓,父目录)
> **Copied from**: ttd v1.0 (2026-07-31 重设计版本)
> **Copy date**: 2026-08-02
> **SPDX-License-Identifier**: AGPL-3.0-or-later
> **Copyright**: (C) 2026 EvoRule Project

## 复制原则

依据 `docs/SPEC.md §4.2` 与 `docs/IMPLEMENTATION_PLAN.md 阶段5`,
为性能优先,把 ttd 源码**整体直接复制**进 evorule-console,而非通过 iframe 嵌入或接口引用。

## 与原 ttd 的差异(适配点)

为在 SvelteKit 5 + vite 环境下运行,本副本做了**最小适配**:

1. **`main.js`**:把自动执行的 `init()` 改为 `export function initTtd(opts)`,由 Svelte 包装组件
   `views/TimeTravel/TimeTravel.svelte` 在 `onMount` 中显式触发。
2. **`console-adapter.ts`**(新增):把 console 的 `ExecutionBackend`(HttpBackend)适配成 ttd 的
   `api` 对象,避免 ttd 内部重复实现 fetch(单一真相源,符合"TCB 纯净")。
3. **`styles/main.css`**:样式作用域通过 `TimeTravel.svelte` 的 `:global(.ttd-root)` 限定,
   避免污染 evorule-console 的 light 主题。

## 不变的部分

- `algorithms/`(deep-diff / dag-layout / json-tree):纯函数,零成本复用
- `core/store.js / eventbus.js / dom.js`:零成本复用
- `components/`:vanilla DOM 渲染,在 Svelte 容器内运行无碍
- `views/`:5 视图(timeline / state / diff / causal / whatif)逻辑不变

## 同步策略

- 原仓 `time-travel-debugger/src/` 升级时,本副本需同步更新
- 同步时只需覆盖 `algorithms/` / `components/` / `views/` / `core/` 目录,保留适配文件
  (`main.js` 的 `initTtd` export、`console-adapter.ts`)
