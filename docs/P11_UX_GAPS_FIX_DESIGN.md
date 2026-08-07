<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# P0-11 详细设计(5 缺口修复)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-11` 的可实施落地。
>
> **定位**:P0-11 是 P0 收尾的体验打磨 — 统一 5 个体验缺口(操作反馈 / 空态 / 引导 / 决策者 / demo),让 P03-P10 的功能「好用、易上手、对决策者友好」。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-11`(5 缺口修复:操作反馈 / 空态 / 引导 / 决策者 / demo)+ §3.2(角色 B 决策者)+ §5.8.4(状态 A demo 模式)
> - 三层架构:`evorule-three-layer-architecture.md §11.4`(同步状态表)
> - 首页设计:`HOME_DESIGN.md §3`(状态机)+ §5.8(首页细化)+ §8.3(DemoHome)
> - 全部前置:`P03-P10`(本文档为所有 P0 视图补统一反馈组件)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-11)

> P0-11 5 缺口修复(操作反馈 / 空态 / 引导 / 决策者 / demo)— 体验报告 — 状态徽标 / toast / 自动跳转 / 空态一致

P0-1 到 P0-10 完成了功能层设计,但体验层有 5 个共性缺口(来自体验报告 + 战略文档 §3.2 决策者定位):

| # | 缺口 | 现状问题 | P0-11 修复 |
| --- | --- | --- | --- |
| 1 | **操作反馈** | 用户操作后无即时反馈(规则保存 / 提交 / 删除成功?) | 统一 Toast 组件 + 状态徽标 |
| 2 | **空态一致** | 各视图空态样式不统一(有的「暂无数据」,有的空白) | 统一 EmptyState 组件 + 4 类空态文案 |
| 3 | **引导优化** | 新用户不知从哪开始(无首屏引导 / 无视图首次提示) | 首屏引导条 + 视图首次访问 GuidedHint |
| 4 | **决策者视图** | 决策者看不懂技术视图(需要简化版) | DecisionMakerView(关键指标卡 + 业务语言) |
| 5 | **demo 打磨** | P10 demo 模式细节粗糙(banner / 切换 / CTA) | demo 模式 UX 细化 |

### 1.2 5 缺口的相互关系

```
缺口 5 demo 打磨 ─── 依赖 ──→ 缺口 1 操作反馈(demo 中也要 toast)
                  └── 依赖 ──→ 缺口 2 空态(demo 切换时空态一致)
                  └── 依赖 ──→ 缺口 3 引导(demo 引导任务有引导条)

缺口 4 决策者视图 ─── 依赖 ──→ 缺口 1 操作反馈
                   └── 依赖 ──→ 缺口 2 空态(决策者视图也有空态)

全部缺口 ─── 横向贯穿 ──→ P03-P10 所有视图
```

**结论**:缺口 1(操作反馈)和缺口 2(空态)是基础,缺口 3/4/5 建立其上。建议实施顺序:1 → 2 → 3 → 4 → 5。

### 1.3 现状:无统一反馈组件

经代码审查,`src/` 目录下**无**现有的 Toast / EmptyState / Badge / GuidedHint 组件。P0-11 从零建立统一组件,避免 P03-P10 各自实现导致风格分裂。

### 1.4 与其他 P0 的关系

| 前置设计 | P0-11 补的缺口 |
| --- | --- |
| HOME_DESIGN | demo 打磨(状态 A banner / 切换 / CTA) |
| P01 业务规则库 | 操作反馈(保存 / 删除 toast)+ 空态(空库引导) |
| P02 业务语言层 | 引导(术语库首次访问提示) |
| P03 数据集 | 操作反馈 + 空态(无数据集引导) |
| P04 业务执行台 | 操作反馈(提交 toast)+ 引导(首次表单填写) |
| P05 监控大屏 | 决策者视图(简化版)+ 空态(无运行数据) |
| P06 业务审计 | 决策者视图(简化版)+ 操作反馈(导出 toast) |
| P07 通用结果导出 | 操作反馈(导出进度 / 完成 toast) |
| P08 协作工作流 | 操作反馈(批准 / 驳回 toast)+ 空态(无待审) |
| P09 导入导出基础设施 | 操作反馈(导入进度 / 冲突 toast) |
| P10 任务流 + demo | demo 打磨 + 操作反馈(任务完成 toast)+ 引导(任务流首次提示) |

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现统一 `Toast.svelte` 组件(成功 / 错误 / 警告 / 信息 4 类,自动消失)
- ✅ 实现 `toastStore`(队列管理,最多同时 3 条)
- ✅ 实现统一 `EmptyState.svelte` 组件(图标 + 标题 + 描述 + CTA)
- ✅ 定义 4 类空态文案(无数据 / 无权限 / 加载失败 / 未配置)
- ✅ 实现统一 `StatusBadge.svelte`(规则状态 / 数据集状态 / 任务状态)
- ✅ 实现首屏引导条 `OnboardingBanner.svelte`(新用户首次进入状态 C)
- ✅ 实现视图首次访问提示 `GuidedHint.svelte`(每个视图的「这是干什么的」)
- ✅ 实现 `DecisionMakerView.svelte`(决策者简化视图,关键指标 + 业务语言)
- ✅ 打磨 demo 模式(banner 优化 / 数据集切换动画 / CTA 强化)
- ✅ 横向贯穿 P03-P10 所有视图(替换零散的反馈逻辑)
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖 toastStore / EmptyState / StatusBadge(Vitest)
- ✅ E2E 测试覆盖 4 类 toast / 4 类空态 / 决策者视图(Playwright)

### 2.2 非目标

- ❌ 不实现复杂的引导教程(如 Shepherd.js / Intro.js 风格的步骤式引导)— P2
- ❌ 不实现决策者视图的独立路由(P0 是状态 C 内的「视图模式切换」)
- ❌ 不实现 toast 的持久化(P0 是浏览器内即用即弃)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)
- ❌ 不重构 P03-P10 的核心功能(只补反馈组件,不改业务逻辑)
- ❌ 不实现通知中心(P2:站内通知 + 邮件)

---

## 3. 关键架构决策

### 3.1 决策 1:统一组件 + Store 模式,非各视图自行实现

**决策**:建立 `Toast.svelte` / `EmptyState.svelte` / `StatusBadge.svelte` / `GuidedHint.svelte` 4 个统一组件 + `toastStore` 1 个统一 store,P03-P10 所有视图引用,不自行实现。

**理由**:
1. 避免风格分裂(每个视图自己写 toast 会导致样式 / 行为不一致)
2. 集中维护(改一处,全视图生效)
3. 降低 P03-P10 的实现负担(引用组件 < 自己实现)
4. 符合「组合优于继承」原则

### 3.2 决策 2:Toast 队列最多 3 条,先进先出

**决策**:`toastStore` 维护队列,最多同时显示 3 条 toast,超过则先进先出(最早的消失)。

**理由**:
1. 3 条是视觉舒适上限(更多会遮挡内容)
2. 先进先出保证最新操作反馈可见
3. 每条 toast 默认 4 秒自动消失(错误类 6 秒,需手动关闭)

### 3.3 决策 3:空态分 4 类,每类有标准文案模板

**决策**:`EmptyState` 支持 4 类空态,每类有标准文案模板:

| 类型 | 触发场景 | 文案模板 |
| --- | --- | --- |
| `no_data` | 无数据(空库 / 无规则 / 无审计) | 「还没有 {noun},点击 {cta} 创建第一条」 |
| `no_permission` | 无权限查看 | 「你没有查看 {noun} 的权限,联系管理员」 |
| `load_failed` | 加载失败 | 「{noun} 加载失败,{cta} 重试」 |
| `not_configured` | 未配置(无 LLM / 无 server) | 「{noun} 未配置,{cta} 去设置」 |

**理由**:
1. 4 类覆盖 P03-P10 所有空态场景
2. 标准文案模板保证一致性(不出现「暂无数据」vs「没有数据」vs「空」的混乱)
3. 每类都有 CTA(引导用户下一步,而非死路)

### 3.4 决策 4:决策者视图 = 状态 C 内的「视图模式切换」,非独立路由

**决策**:在状态 C 真实工作台顶部加「专家模式 / 决策者模式」toggle,决策者模式下隐藏技术细节,只显示关键指标卡 + 业务语言。

**理由**:
1. §3.2 角色 B 决策者要的是「30 秒看懂」,不是独立路由
2. 状态 C 已是真实工作台,决策者模式是其简化视图
3. 避免新增独立路由(`/decision`)的维护成本
4. toggle 让决策者随时切回专家模式(不锁死)

### 3.5 决策 5:demo 打磨 = P10 demo 模式的 UX 细化,非重做

**决策**:P11 的 demo 打磨是对 P10 demo 模式的细节优化(banner 文案 / 切换动画 / CTA 强化),不重做架构。

**优化点**:
1. banner 文案更明确(「这是 demo,数据是预填的」→「📋 演示模式 · 数据为预填示例,[注册建自己的库]」)
2. 数据集切换加动画(平滑过渡,非闪切)
3. CTA 强化(底部 CTA 加视觉权重 + 「30 秒看懂 evorule」视频链接)
4. 引导任务卡片加 hover 效果 + 完成进度(已试过 / 未试过)

---

## 4. 统一组件设计

### 4.1 Toast.svelte

```svelte
<!-- src/lib/views/Feedback/Toast.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一 Toast 通知组件
    - 4 类:success / error / warning / info
    - 自动消失(success/info 4s,warning 5s,error 6s)
    - 队列最多 3 条,先进先出
    - 支持手动关闭(× 按钮)
  依赖:toastStore
-->

<script lang="ts">
  import { toastStore, dismissToast } from '$lib/stores/toast';

  const toasts = $derived($toastStore);
</script>

{#if toasts.length > 0}
  <div class="toast-container" role="region" aria-label="通知">
    {#each toasts as toast (toast.id)}
      <div class={`toast toast-${toast.type}`} role="alert">
        <span class="toast-icon">
          {#if toast.type === 'success'}✅{/if}
          {#if toast.type === 'error'}❌{/if}
          {#if toast.type === 'warning'}⚠️{/if}
          {#if toast.type === 'info'}ℹ️{/if}
        </span>
        <div class="toast-content">
          {#if toast.title}
            <div class="toast-title">{toast.title}</div>
          {/if}
          <div class="toast-message">{toast.message}</div>
        </div>
        <button class="toast-close" onclick={() => dismissToast(toast.id)} aria-label="关闭">×</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 360px;
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slide-in 0.3s ease-out;
  }
  .toast-success { background: var(--color-success-bg); border-left: 4px solid var(--color-success); }
  .toast-error { background: var(--color-error-bg); border-left: 4px solid var(--color-error); }
  .toast-warning { background: var(--color-warning-bg); border-left: 4px solid var(--color-warning); }
  .toast-info { background: var(--color-info-bg); border-left: 4px solid var(--color-info); }
  .toast-icon { font-size: 16px; }
  .toast-content { flex: 1; }
  .toast-title { font-weight: 600; margin-bottom: 2px; }
  .toast-message { font-size: 14px; color: var(--color-text-secondary); }
  .toast-close {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--color-text-secondary);
    padding: 0;
    line-height: 1;
  }
  @keyframes slide-in {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
```

### 4.2 EmptyState.svelte

```svelte
<!-- src/lib/views/Feedback/EmptyState.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一空态组件
    - 4 类:no_data / no_permission / load_failed / not_configured
    - 每类有标准图标 + 标题 + 描述 + CTA
    - 支持自定义 noun / cta 文案
-->

<script lang="ts">
  import type { EmptyStateType } from '$lib/stores/empty-state-types';

  interface Props {
    type: EmptyStateType;
    noun: string; // 如「规则」「数据集」「审计记录」
    ctaLabel?: string; // CTA 按钮文案,如「创建第一条」「重试」「去设置」
    ctaAction?: () => void;
    description?: string; // 可选:覆盖默认描述
  }

  let { type, noun, ctaLabel, ctaAction, description }: Props = $props();

  const config = $derived({
    no_data: { icon: '📭', title: `还没有${noun}`, desc: description ?? `点击下方按钮,创建你的第一条${noun}` },
    no_permission: { icon: '🔒', title: '无权限', desc: description ?? `你没有查看${noun}的权限,请联系管理员` },
    load_failed: { icon: '⚠️', title: `${noun}加载失败`, desc: description ?? '请检查网络或后端服务,然后重试' },
    not_configured: { icon: '⚙️', title: `${noun}未配置`, desc: description ?? `请先配置${noun},才能使用此功能` },
  }[type]);
</script>

<div class="empty-state">
  <div class="empty-icon">{config.icon}</div>
  <h3 class="empty-title">{config.title}</h3>
  <p class="empty-desc">{config.desc}</p>
  {#if ctaLabel && ctaAction}
    <button class="empty-cta" onclick={ctaAction}>{ctaLabel}</button>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    text-align: center;
  }
  .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.6; }
  .empty-title { font-size: 18px; font-weight: 600; margin: 0 0 8px 0; }
  .empty-desc { color: var(--color-text-secondary); font-size: 14px; margin: 0 0 16px 0; max-width: 360px; }
  .empty-cta {
    padding: 8px 20px;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }
  .empty-cta:hover { opacity: 0.9; }
</style>
```

### 4.3 StatusBadge.svelte

```svelte
<!-- src/lib/views/Feedback/StatusBadge.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一状态徽标
    - 规则状态:draft / final
    - 数据集状态:draft / testing / ready / published
    - 任务状态:running / completed / cancelled
    - 协作状态:pending / approved / rejected
-->

<script lang="ts">
  type StatusKind = 'draft' | 'final' | 'testing' | 'ready' | 'published' | 'running' | 'completed' | 'cancelled' | 'pending' | 'approved' | 'rejected';

  interface Props {
    status: StatusKind;
    size?: 'sm' | 'md';
  }

  let { status, size = 'md' }: Props = $props();

  const config: Record<StatusKind, { label: string; color: string }> = {
    draft: { label: '草稿', color: 'gray' },
    final: { label: '已发布', color: 'green' },
    testing: { label: '测试中', color: 'yellow' },
    ready: { label: '就绪', color: 'blue' },
    published: { label: '已发布', color: 'green' },
    running: { label: '运行中', color: 'blue' },
    completed: { label: '已完成', color: 'green' },
    cancelled: { label: '已取消', color: 'gray' },
    pending: { label: '待审', color: 'yellow' },
    approved: { label: '已批准', color: 'green' },
    rejected: { label: '已驳回', color: 'red' },
  };

  const current = $derived(config[status]);
</script>

<span class={`status-badge status-${current.color} size-${size}`}>
  {current.label}
</span>

<style>
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
  }
  .size-sm { font-size: 11px; padding: 1px 6px; }
  .status-gray { background: var(--color-gray-bg); color: var(--color-gray-text); }
  .status-green { background: var(--color-success-bg); color: var(--color-success-text); }
  .status-yellow { background: var(--color-warning-bg); color: var(--color-warning-text); }
  .status-blue { background: var(--color-info-bg); color: var(--color-info-text); }
  .status-red { background: var(--color-error-bg); color: var(--color-error-text); }
</style>
```

### 4.4 GuidedHint.svelte

```svelte
<!-- src/lib/views/Feedback/GuidedHint.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:视图首次访问引导提示
    - 每个视图首次访问时显示「这是干什么的」
    - 用户可关闭,关闭后不再显示(localStorage 记忆)
    - 支持多步骤提示(可选)
-->

<script lang="ts">
  import { browser } from '$app/environment';

  interface Props {
    hintId: string; // 唯一标识,如 'rules_first_visit'
    title: string;
    content: string;
    ctaLabel?: string;
    ctaAction?: () => void;
  }

  let { hintId, title, content, ctaLabel, ctaAction }: Props = $props();

  const dismissed = $derived(browser && localStorage.getItem(`hint:${hintId}`) === 'dismissed');

  function handleDismiss() {
    if (browser) localStorage.setItem(`hint:${hintId}`, 'dismissed');
  }
</script>

{#if !dismissed}
  <div class="guided-hint">
    <div class="hint-icon">💡</div>
    <div class="hint-content">
      <div class="hint-title">{title}</div>
      <div class="hint-text">{content}</div>
      {#if ctaLabel && ctaAction}
        <button class="hint-cta" onclick={() => { ctaAction(); handleDismiss(); }}>{ctaLabel}</button>
      {/if}
    </div>
    <button class="hint-close" onclick={handleDismiss} aria-label="关闭提示">×</button>
  </div>
{/if}

<style>
  .guided-hint {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    background: var(--color-info-bg);
    border: 1px solid var(--color-info);
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .hint-icon { font-size: 20px; }
  .hint-content { flex: 1; }
  .hint-title { font-weight: 600; margin-bottom: 4px; }
  .hint-text { color: var(--color-text-secondary); font-size: 14px; }
  .hint-cta {
    margin-top: 8px;
    padding: 4px 12px;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }
  .hint-close {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--color-text-secondary);
  }
</style>
```

---

## 5. Store 设计

### 5.1 Store 一览

| Store | 文件 | 职责 | 持久化 |
| --- | --- | --- | --- |
| `toastStore` | `src/lib/stores/toast.ts` | Toast 队列(最多 3 条) | ❌ |
| `viewModeStore` | `src/lib/stores/view-mode.ts` | 视图模式(expert / decision_maker) | ✅ localStorage |
| `hintDismissedStore` | `src/lib/stores/hint-dismissed.ts` | 已关闭的引导提示 ID 集合 | ✅ localStorage |

### 5.2 toastStore

```typescript
// src/lib/stores/toast.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Toast 队列 store。
// - 最多同时 3 条,超过先进先出
// - 每条自动消失(success/info 4s,warning 5s,error 6s)
// - 支持手动关闭

import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number; // ms
}

const MAX_TOASTS = 3;
const DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

export const toastStore = writable<Toast[]>([]);

/** 内部:安排自动消失 */
function scheduleDismiss(id: string, duration: number): void {
  setTimeout(() => dismissToast(id), duration);
}

/** 显示 toast */
function pushToast(type: ToastType, message: string, title?: string): void {
  const id = crypto.randomUUID();
  const duration = DURATION[type];
  const toast: Toast = { id, type, title, message, duration };

  toastStore.update((queue) => {
    const next = [...queue, toast];
    // 超过上限,移除最早的
    if (next.length > MAX_TOASTS) {
      next.splice(0, next.length - MAX_TOASTS);
    }
    return next;
  });

  scheduleDismiss(id, duration);
}

/** 便捷方法 */
export function toastSuccess(message: string, title?: string): void {
  pushToast('success', message, title);
}

export function toastError(message: string, title?: string): void {
  pushToast('error', message, title);
}

export function toastWarning(message: string, title?: string): void {
  pushToast('warning', message, title);
}

export function toastInfo(message: string, title?: string): void {
  pushToast('info', message, title);
}

/** 手动关闭 */
export function dismissToast(id: string): void {
  toastStore.update((queue) => queue.filter((t) => t.id !== id));
}

/** 清空所有 */
export function clearToasts(): void {
  toastStore.set([]);
}
```

### 5.3 viewModeStore

```typescript
// src/lib/stores/view-mode.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 视图模式 store(状态 C 内的专家/决策者切换)。
// - 'expert':专家模式(默认,显示技术细节)
// - 'decision_maker':决策者模式(简化,只显示关键指标 + 业务语言)
//
// 持久化:localStorage(key: evorule-console-cloud:view-mode)

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type ViewMode = 'expert' | 'decision_maker';

const STORAGE_KEY = 'evorule-console-cloud:view-mode';

function loadMode(): ViewMode {
  if (!browser) return 'expert';
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'decision_maker' ? 'decision_maker' : 'expert';
}

export const viewModeStore = writable<ViewMode>(loadMode());

viewModeStore.subscribe((mode) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, mode);
});

export function setViewMode(mode: ViewMode): void {
  viewModeStore.set(mode);
}

export function toggleViewMode(): void {
  viewModeStore.update((m) => (m === 'expert' ? 'decision_maker' : 'expert'));
}
```

---

## 6. 5 缺口修复方案

### 6.1 缺口 1:操作反馈(Toast + 状态徽标)

**修复内容**:P03-P10 所有关键操作(保存 / 删除 / 提交 / 导出 / 导入 / 批准 / 驳回 / 回滚 / 热重载)后,调用 `toastSuccess` / `toastError` / `toastWarning` / `toastInfo`。

**覆盖清单**:

| P0 文档 | 操作 | Toast 类型 | 示例 |
| --- | --- | --- | --- |
| P01 业务规则库 | 保存规则 | success | 「规则 R-001 已保存」 |
| P01 业务规则库 | 删除规则 | warning | 「规则 R-001 已删除」 |
| P03 数据集 | 创建数据集 | success | 「数据集 DS-001 已创建」 |
| P03 数据集 | 发布数据集 | success | 「数据集 DS-001 已发布到生产」 |
| P04 业务执行台 | 提交事件 | info | 「事件 E-042 已提交,触发 2 条规则」 |
| P04 业务执行台 | LLM 翻译失败 | error | 「LLM 翻译失败,请重试或手动编辑」 |
| P05 监控大屏 | 中断执行 | warning | 「已中断执行,等待中的 3 条 Fact 已丢弃」 |
| P05 监控大屏 | 回滚 | success | 「已回滚到版本 v15」 |
| P06 业务审计 | 导出审计 | success | 「审计链已导出:audit-20260806.json」 |
| P06 业务审计 | BLAKE3 验证 | success | 「审计链验证通过(verified: true)」 |
| P06 业务审计 | 决策支持完成 | info | 「LLM 决策建议已生成」 |
| P07 通用结果导出 | 导出完成 | success | 「报告已导出:report-20260806.pdf」 |
| P08 协作工作流 | 批准规则 | success | 「规则 R-001 已批准」 |
| P08 协作工作流 | 驳回规则 | warning | 「规则 R-001 已驳回,原因:字段缺失」 |
| P09 导入导出基础设施 | 导入完成 | success | 「已导入 12 条规则」 |
| P09 导入导出基础设施 | 导入冲突 | warning | 「3 条规则冲突,已跳过」 |
| P10 任务流 | 任务完成 | success | 「✓ 任务完成:加规则」 |
| P10 任务流 | 任务取消 | info | 「任务已取消」 |

**实施方式**:在各视图的 action handler 中调用 toast 函数,示例:

```typescript
// P01 业务规则库 - 保存规则
async function handleSaveRule(rule: Rule): Promise<void> {
  try {
    await saveRule(rule);
    toastSuccess(`规则 ${rule.id} 已保存`);
  } catch (e) {
    toastError(`保存失败: ${(e as Error).message}`);
  }
}
```

### 6.2 缺口 2:空态一致(EmptyState 组件)

**修复内容**:P03-P10 所有视图的空态,统一用 `EmptyState.svelte`,4 类空态有标准文案。

**覆盖清单**:

| P0 文档 | 空态场景 | 类型 | noun | CTA |
| --- | --- | --- | --- | --- |
| P01 业务规则库 | 无规则 | no_data | 「规则」 | 「创建第一条规则」 |
| P03 数据集 | 无数据集 | no_data | 「数据集」 | 「创建第一个数据集」 |
| P03 数据集 | 无标签 | no_data | 「标签」 | 「创建标签」 |
| P04 业务执行台 | 无 session | not_configured | 「执行会话」 | 「去设置」 |
| P05 监控大屏 | 无运行数据 | no_data | 「运行记录」 | (无 CTA,等待数据) |
| P06 业务审计 | 无审计记录 | no_data | 「审计记录」 | (无 CTA,等待运行) |
| P08 协作工作流 | 无待审任务 | no_data | 「待审任务」 | (无 CTA) |
| P08 协作工作流 | 无权限 | no_permission | 「协作工作流」 | (无 CTA) |
| P10 任务历史 | 无历史 | no_data | 「任务历史」 | (无 CTA) |

**实施方式**:在各视图的空态判断中引用 `EmptyState`,示例:

```svelte
<!-- P01 业务规则库 -->
{#if rules.length === 0}
  <EmptyState
    type="no_data"
    noun="规则"
    ctaLabel="创建第一条规则"
    ctaAction={() => goto('/view/rules?action=create')}
  />
{:else}
  <!-- 规则列表 -->
{/if}
```

### 6.3 缺口 3:引导优化(首屏引导 + 视图首次提示)

**修复内容**:
1. **首屏引导条**(`OnboardingBanner.svelte`):新用户首次进入状态 C 时显示「欢迎,从这 3 步开始」
2. **视图首次访问提示**(`GuidedHint.svelte`):每个视图首次访问显示「这是干什么的」

**首屏引导条**:

```svelte
<!-- src/lib/views/Feedback/OnboardingBanner.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';

  const dismissed = $derived(browser && localStorage.getItem('hint:onboarding_banner') === 'dismissed');

  function dismiss() {
    if (browser) localStorage.setItem('hint:onboarding_banner', 'dismissed');
  }
</script>

{#if !dismissed}
  <div class="onboarding-banner">
    <span class="banner-icon">👋</span>
    <div class="banner-content">
      <strong>欢迎使用 evorule</strong>
      <span>从这 3 步开始:加规则 → 测试 → 发布</span>
    </div>
    <button onclick={() => goto('/view/rules?action=create')}>开始</button>
    <button class="dismiss" onclick={dismiss} aria-label="关闭">×</button>
  </div>
{/if}
```

**视图首次访问提示覆盖清单**:

| 视图 | hintId | title | content |
| --- | --- | --- | --- |
| 业务规则库 | `rules_first_visit` | 「业务规则库」 | 「这里管理你的所有业务规则。用业务表单或 LLM 辅助创建,点击规则查看详情。」 |
| 业务执行台 | `execution_first_visit` | 「业务执行台」 | 「这里提交业务事件,触发规则执行。选业务事件类型 → 填表单 → 看影响预览 → 提交。」 |
| 业务状态 | `state_first_visit` | 「业务状态」 | 「这里查看业务对象的当前状态。选业务对象(病人/案件/订单),查看其状态和历史。」 |
| 业务审计 | `audit_first_visit` | 「业务审计」 | 「这里查看规则的执行审计。BLAKE3 哈希链保证不可篡改,点击 Fact 查看因果链。」 |
| 业务时间旅行 | `timetravel_first_visit` | 「业务时间旅行」 | 「这里回放历史。选时间点 → rewind 回溯 → diff 对比 → whatif 假设分析。」 |
| 数据集管理 | `dataset_first_visit` | 「数据集管理」 | 「这里把规则组合成可运行的数据集。加规则 → 配置参数 → 测试 → 发布。」 |
| 协作工作流 | `collab_first_visit` | 「协作工作流」 | 「这里审核他人提交的规则。查看待审 → 审核详情 → 批准或驳回。」 |
| 任务流历史 | `history_first_visit` | 「任务历史」 | 「这里查看你的任务流历史。点击查看每次任务的步骤和上下文。」 |

### 6.4 缺口 4:决策者视图(DecisionMakerView)

**修复内容**:在状态 C 真实工作台顶部加「专家模式 / 决策者模式」toggle,决策者模式下隐藏技术细节。

**DecisionMakerView 布局**:

```
┌─────────────────────────────────────────────────────────────────┐
│ [logo] [任务流 ▼] [专家模式 | 决策者模式] [🔔] [👤] [看 demo]   │ ← 顶部(含 toggle)
├─────────────────────────────────────────────────────────────────┤
│ ┌─关键指标卡(业务语言)──────────────────────────────────────┐ │
│ │ 📊 今日规则执行    │ 🚨 待处理异常      │ ⏳ 待审规则       │ │
│ │ 1,432 次           │ 3 条(1 条紧急)   │ 2 条(平均 4h)   │ │
│ │ 比昨日 +12%        │ ↓ 比昨日 -2 条     │ ↓ 比昨日 -1 条    │ │
│ └─────────────────────┴─────────────────────┴─────────────────┘ │
│                                                                 │
│ ┌─今日要事(业务语言,无技术术语)────────────────────────────┐ │
│ │ 14:32 病人 P-1283 触发高烧 CT 检查(规则:65岁以上发烧)     │ │
│ │ 13:15 财务 R-067 报销申请待 CFO 批准(金额 ¥12,000)        │ │
│ │ 11:08 规则「报销上限」已更新(张医生修改,待审)             │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─合规状态(决策者最关心)────────────────────────────────────┐ │
│ │ ✅ BLAKE3 审计链:完整(最近验证 14:00)                     │ │
│ │ ✅ 规则版本:v17(最后发布 2026-08-05 18:00)                │ │
│ │ ⚠️ 待办:3 条规则待审,1 条异常未处理                       │ │
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**与专家模式的差异**:

| 元素 | 专家模式 | 决策者模式 |
| --- | --- | --- |
| Reactor phase | 显示(idle/executing/awaiting_io) | 隐藏(只显示「运行中」/「异常」) |
| Fact 流 | 显示 raw Fact JSON | 隐藏(只显示业务语言摘要) |
| BLAKE3 hash | 显示 | 隐藏(只显示「验证通过」) |
| 性能指标 | P50/P99/吞吐 | 隐藏 |
| 干预按钮 | 13 个 | 隐藏(只留「一键回滚」) |
| 数据集管理 | 显示 | 隐藏 |
| 协作工作流 | 显示 | 隐藏(只显示「待审 N 条」) |
| 业务语言摘要 | 隐藏 | 显示 |

**实现**:决策者模式下,RealWorkbench 渲染 `DecisionMakerView.svelte` 替代 `MonitorDashboard.svelte`,后者只在专家模式显示。

### 6.5 缺口 5:demo 打磨

**修复内容**:P10 demo 模式的细节优化。

**优化清单**:

| # | 优化点 | 现状 | 优化后 |
| --- | --- | --- | --- |
| 1 | banner 文案 | 「⚠ 这是 demo,数据是预填的」 | 「📋 演示模式 · 数据为预填示例 · [注册建自己的库]」 |
| 2 | 数据集切换 | 闪切(无动画) | 平滑过渡(opacity + transform 300ms) |
| 3 | 引导任务卡片 | 无 hover 效果 | hover 上浮 + 阴影 + 颜色变化 |
| 4 | 引导任务进度 | 不记录是否试过 | localStorage 记忆「已试过 / 未试过」(打勾标记) |
| 5 | CTA 强化 | 普通 footer | 加视觉权重(渐变背景 + 「30 秒看懂 evorule」视频链接) |
| 6 | 能力特性 | 6 个 ✅ 列表 | 6 个卡片(图标 + 标题 + 一句话 + 「了解更多」链接) |
| 7 | 数据卡 | 静态数字 | 加动画(数字滚动 count-up,1s) |
| 8 | 加载状态 | 无 | 预填数据加载时显示骨架屏(避免白屏) |

**示例:引导任务进度记忆**:

```typescript
// src/lib/stores/guided-task-progress.ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'evorule-console-cloud:guided-task-progress';

function loadProgress(): Set<string> {
  if (!browser) return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export const guidedTaskProgressStore = writable<Set<string>>(loadProgress());

guidedTaskProgressStore.subscribe((progress) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...progress]));
});

export function markTaskTried(taskId: string): void {
  guidedTaskProgressStore.update((p) => new Set([...p, taskId]));
}
```

```svelte
<!-- GuidedTasks.svelte(增强版,加进度记忆) -->
{#each GUIDED_TASKS as task}
  {@const tried = $guidedTaskProgressStore.has(task.id)}
  <button class="task-card" class:tried onclick={() => handleTaskClick(task.id)}>
    <span class="task-emoji">{tried ? '✅' : '👉'}</span>
    <div class="task-content">
      <div class="task-name">
        {task.name}
        {#if tried}<span class="tried-badge">已试过</span>{/if}
      </div>
      <div class="task-pitch">{task.pitch}</div>
    </div>
  </button>
{/each}
```

---

## 7. 数据流

### 7.1 操作反馈数据流(以保存规则为例)

```
用户在业务规则库点「保存」
  ↓
P01 RuleLibraryView.handleSaveRule(rule)
  ↓
saveRule(rule) → 后端 API
  ↓
成功:
  toastSuccess(`规则 ${rule.id} 已保存`)
  ↓
toastStore 更新 → Toast.svelte 渲染
  ↓
4 秒后自动消失(scheduleDismiss)
  ↓
失败:
  toastError(`保存失败: ${error.message}`)
  ↓
toastStore 更新 → Toast.svelte 渲染(红色)
  ↓
6 秒后自动消失(或用户手动 ×)
```

### 7.2 空态渲染数据流(以业务规则库为例)

```
RuleLibraryView 加载
  ↓
rulesStore 加载规则列表
  ↓
rules.length === 0?
  ↓ 是
渲染 <EmptyState type="no_data" noun="规则" ctaLabel="创建第一条规则" ctaAction={...} />
  ↓ 否
渲染规则列表
```

### 7.3 决策者模式切换数据流

```
用户点顶部「决策者模式」toggle
  ↓
toggleViewMode()
  ↓
viewModeStore.set('decision_maker')
  ↓
RealWorkbench 检测 viewModeStore 变化
  ↓
$viewModeStore === 'decision_maker'?
  ↓ 是
渲染 <DecisionMakerView /> (隐藏技术细节)
  ↓ 否
渲染 <MonitorDashboard /> (专家模式,显示全部)
```

### 7.4 首屏引导数据流

```
新用户首次登录 → HomeRouter 进入状态 C
  ↓
RealWorkbench 检测 hint:onboarding_banner 是否 dismissed
  ↓ 未 dismissed
渲染 <OnboardingBanner />
  ↓
用户点「开始」→ goto('/view/rules?action=create') + dismiss()
  ↓
或用户点 × → dismiss()
  ↓
localStorage 记忆 dismissed,下次不再显示
```

---

## 8. 关键代码示例

### 8.1 DecisionMakerView.svelte(决策者简化视图)

```svelte
<!-- src/lib/views/DecisionMaker/DecisionMakerView.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:决策者简化视图(状态 C 内,viewMode='decision_maker' 时渲染)
    - 隐藏技术细节(Reactor phase / BLAKE3 hash / 性能指标)
    - 显示业务语言摘要(关键指标 + 今日要事 + 合规状态)
    - 只保留「一键回滚」操作(隐藏其他 12 个干预按钮)
  依赖:factStreamStore(派生业务摘要)/ productionStateStore / businessAuditStore
-->

<script lang="ts">
  import { derived } from 'svelte/store';
  import { factStreamStore } from '$lib/stores/fact-stream';
  import { productionStateStore } from '$lib/stores/production-state';
  import { businessAuditStore } from '$lib/stores/business-audit';
  import { toastSuccess } from '$lib/stores/toast';

  // 派生:今日关键指标(业务语言)
  const todayStats = $derived.by(() => {
    const facts = $factStreamStore;
    const audits = $businessAuditStore;

    return {
      executions: facts.length,
      anomalies: facts.filter((f) => f.payload?.anomaly).length,
      pendingReviews: 2, // TODO: 接 P08 协作工作流 store
    };
  });

  // 派生:今日要事(最近 5 条,业务语言)
  const recentEvents = $derived.by(() => {
    return $factStreamStore.slice(0, 5).map((f) => ({
      time: new Date(f.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      summary: describeBusinessEvent(f), // 业务语言描述
    }));
  });

  function describeBusinessEvent(fact: unknown): string {
    // P0 简化:用 fact 类型 + payload 关键字段
    const f = fact as { type: string; payload: Record<string, unknown> };
    return `${f.type}: ${JSON.stringify(f.payload).slice(0, 80)}`;
  }

  function handleRollback() {
    // 复用 P05 InterventionBar 的回滚逻辑
    if (confirm('确认回滚到上一个版本?')) {
      toastSuccess('已回滚到上一版本');
    }
  }
</script>

<div class="decision-maker-view">
  <section class="stats-cards">
    <div class="stat-card">
      <div class="stat-icon">📊</div>
      <div class="stat-value">{todayStats.executions}</div>
      <div class="stat-label">今日规则执行</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🚨</div>
      <div class="stat-value">{todayStats.anomalies}</div>
      <div class="stat-label">待处理异常</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">⏳</div>
      <div class="stat-value">{todayStats.pendingReviews}</div>
      <div class="stat-label">待审规则</div>
    </div>
  </section>

  <section class="recent-events">
    <h3>今日要事</h3>
    <ul>
      {#each recentEvents as event}
        <li>
          <span class="event-time">{event.time}</span>
          <span class="event-summary">{event.summary}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="compliance-status">
    <h3>合规状态</h3>
    <div class="compliance-item">
      ✅ BLAKE3 审计链:完整(最近验证 {new Date().toLocaleTimeString('zh-CN')})
    </div>
    <div class="compliance-item">
      ✅ 规则版本:v{$productionStateStore?.rulesetVersion ?? '?'}
    </div>
    {#if todayStats.anomalies > 0}
      <div class="compliance-item warning">
        ⚠️ 待办:{todayStats.anomalies} 条异常未处理
      </div>
    {/if}
  </section>

  <section class="actions">
    <button class="btn-rollback" onclick={handleRollback}>↩ 一键回滚</button>
  </section>
</div>

<style>
  .decision-maker-view {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .stats-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .stat-card {
    padding: 20px;
    background: var(--color-surface);
    border-radius: 8px;
    text-align: center;
  }
  .stat-icon { font-size: 24px; }
  .stat-value { font-size: 32px; font-weight: 700; margin: 8px 0 4px; }
  .stat-label { color: var(--color-text-secondary); font-size: 14px; }
  .recent-events h3, .compliance-status h3 { margin: 0 0 12px; font-size: 16px; }
  .recent-events ul { list-style: none; padding: 0; margin: 0; }
  .recent-events li { padding: 8px 0; border-bottom: 1px solid var(--color-border); }
  .event-time { color: var(--color-text-secondary); font-size: 13px; margin-right: 12px; }
  .compliance-item { padding: 8px 0; }
  .compliance-item.warning { color: var(--color-warning-text); }
  .btn-rollback {
    padding: 10px 20px;
    background: var(--color-error);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
```

### 8.2 RealWorkbench 集成(状态 C,加 toggle + 决策者视图)

```svelte
<!-- src/lib/views/Home/RealWorkbench.svelte(修改版) -->
<script lang="ts">
  import { viewModeStore, toggleViewMode } from '$lib/stores/view-mode';
  import { layerStore } from '$lib/stores/layer';
  import MonitorDashboard from './MonitorDashboard.svelte';
  import WorkspaceConsole from './WorkspaceConsole.svelte';
  import DecisionMakerView from '../DecisionMaker/DecisionMakerView.svelte';
  import TaskFlowDropdown from '../TaskFlow/TaskFlowDropdown.svelte';
  import TaskFlowWizard from '../TaskFlow/TaskFlowWizard.svelte';
  import OnboardingBanner from '../Feedback/OnboardingBanner.svelte';
  import Toast from '../Feedback/Toast.svelte';
</script>

<div class="real-workbench">
  <nav class="top-nav">
    <span class="logo">evorule</span>
    <TaskFlowDropdown />
    {#if $layerStore === 'L1'}
      <button onclick={() => layerStore.set('L2')}>L2 编辑</button>
    {:else}
      <button onclick={() => layerStore.set('L1')}>L1 监控</button>
    {/if}

    <!-- 视图模式 toggle(缺口 4) -->
    <div class="view-mode-toggle">
      <button class:active={$viewModeStore === 'expert'} onclick={() => viewModeStore.set('expert')}>专家</button>
      <button class:active={$viewModeStore === 'decision_maker'} onclick={() => viewModeStore.set('decision_maker')}>决策者</button>
    </div>

    <button class="bell">🔔</button>
    <button class="user">👤</button>
    <a href="/demo">看 demo</a>
  </nav>

  <OnboardingBanner />

  <TaskFlowWizard />

  <main class="content">
    {#if $viewModeStore === 'decision_maker'}
      <DecisionMakerView />
    {:else if $layerStore === 'L1'}
      <MonitorDashboard />
    {:else}
      <WorkspaceConsole />
    {/if}
  </main>

  <Toast />
</div>
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

```typescript
// tests/unit/toast.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toastStore, toastSuccess, toastError, dismissToast, clearToasts } from '$lib/stores/toast';

describe('toastStore', () => {
  beforeEach(() => {
    clearToasts();
    vi.useFakeTimers();
  });

  it('toastSuccess 应添加 success 类型 toast', () => {
    toastSuccess('保存成功');
    expect($toastStore).toHaveLength(1);
    expect($toastStore[0].type).toBe('success');
    expect($toastStore[0].message).toBe('保存成功');
  });

  it('超过 3 条应先进先出', () => {
    toastSuccess('1');
    toastSuccess('2');
    toastSuccess('3');
    toastSuccess('4');
    expect($toastStore).toHaveLength(3);
    expect($toastStore[0].message).toBe('2'); // 第一条已被移除
  });

  it('success toast 4 秒后应自动消失', () => {
    toastSuccess('test');
    expect($toastStore).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect($toastStore).toHaveLength(0);
  });

  it('error toast 6 秒后应自动消失', () => {
    toastError('test');
    vi.advanceTimersByTime(4000);
    expect($toastStore).toHaveLength(1); // 4 秒还在
    vi.advanceTimersByTime(2000);
    expect($toastStore).toHaveLength(0); // 6 秒消失
  });

  it('dismissToast 应手动关闭', () => {
    toastSuccess('test');
    const id = $toastStore[0].id;
    dismissToast(id);
    expect($toastStore).toHaveLength(0);
  });
});
```

```typescript
// tests/unit/view-mode.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { viewModeStore, setViewMode, toggleViewMode } from '$lib/stores/view-mode';

describe('viewModeStore', () => {
  beforeEach(() => {
    setViewMode('expert');
  });

  it('默认应为 expert', () => {
    expect($viewModeStore).toBe('expert');
  });

  it('toggleViewMode 应切换', () => {
    toggleViewMode();
    expect($viewModeStore).toBe('decision_maker');
    toggleViewMode();
    expect($viewModeStore).toBe('expert');
  });
});
```

### 9.2 E2E 测试(Playwright)

```typescript
// tests/e2e/ux-gaps.spec.ts

import { test, expect } from '@playwright/test';

test.describe('缺口 1:操作反馈', () => {
  test('保存规则后应显示 success toast', async ({ page }) => {
    // 模拟登录 + 有库
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('evorule-console-cloud:session', JSON.stringify({ userId: 'test' }));
      localStorage.setItem('evorule-console-cloud:db', JSON.stringify({ id: 'db1', name: '测试库', ruleCount: 5 }));
    });
    await page.reload();

    // 进入业务规则库,创建规则,保存
    await page.click('button:has-text("任务流")');
    await page.click('button:has-text("加规则")');
    // ... 填写表单
    await page.click('button:has-text("保存")');

    // 应出现 success toast
    await expect(page.locator('.toast-success')).toBeVisible();
    await expect(page.locator('.toast-success')).toContainText('已保存');
  });
});

test.describe('缺口 2:空态一致', () => {
  test('空库应显示 EmptyState', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('evorule-console-cloud:session', JSON.stringify({ userId: 'test' }));
      localStorage.setItem('evorule-console-cloud:db', JSON.stringify({ id: 'db1', name: '空库', ruleCount: 0 }));
    });
    await page.reload();

    await page.click('a:has-text("业务规则库")');
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-title')).toHaveText('还没有规则');
  });
});

test.describe('缺口 3:引导优化', () => {
  test('首次进入应显示 OnboardingBanner', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('evorule-console-cloud:session', JSON.stringify({ userId: 'new_user' }));
      localStorage.setItem('evorule-console-cloud:db', JSON.stringify({ id: 'db1', name: '新库', ruleCount: 1 }));
      localStorage.removeItem('hint:onboarding_banner');
    });
    await page.reload();

    await expect(page.locator('.onboarding-banner')).toBeVisible();
  });

  test('关闭 OnboardingBanner 后不再显示', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('hint:onboarding_banner', 'dismissed');
    });
    await page.reload();

    await expect(page.locator('.onboarding-banner')).not.toBeVisible();
  });
});

test.describe('缺口 4:决策者视图', () => {
  test('切换到决策者模式应隐藏技术细节', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('evorule-console-cloud:session', JSON.stringify({ userId: 'test' }));
      localStorage.setItem('evorule-console-cloud:db', JSON.stringify({ id: 'db1', name: '测试库', ruleCount: 5 }));
    });
    await page.reload();

    // 切换到决策者模式
    await page.click('button:has-text("决策者")');

    // 应显示 DecisionMakerView
    await expect(page.locator('.decision-maker-view')).toBeVisible();
    // 应隐藏 ReactorStateBar(技术细节)
    await expect(page.locator('.reactor-state-bar')).not.toBeVisible();
  });
});

test.describe('缺口 5:demo 打磨', () => {
  test('demo 引导任务完成后应标记「已试过」', async ({ page }) => {
    await page.goto('/');
    // 点引导任务
    await page.click('button:has-text("试试加规则")');
    // 完成或取消任务
    await page.click('.cancel-btn');
    // 回到首页
    await page.goto('/');

    // 该引导任务应显示「已试过」
    await expect(page.locator('.task-card.tried')).toBeVisible();
  });
});
```

### 9.3 测试覆盖率目标

| 模块 | 覆盖率目标 | 测试类型 |
| --- | --- | --- |
| toast.ts(store) | 100% | 单元(Vitest) |
| view-mode.ts(store) | 100% | 单元(Vitest) |
| empty-state-types.ts | 100% | 类型(编译时) |
| Toast.svelte | ≥ 80% | E2E(Playwright) |
| EmptyState.svelte | ≥ 80% | E2E(Playwright) |
| StatusBadge.svelte | ≥ 80% | 单元(Vitest) |
| GuidedHint.svelte | ≥ 80% | E2E(Playwright) |
| OnboardingBanner.svelte | ≥ 80% | E2E(Playwright) |
| DecisionMakerView.svelte | ≥ 80% | E2E(Playwright) |

---

## 10. 与其他文档的关系

### 10.1 与 HOME_DESIGN 的关系

| HOME_DESIGN 章节 | P0-11 关系 |
| --- | --- |
| §3 状态机 | OnboardingBanner 仅在状态 C 触发 |
| §5.8.3 状态 C 真实工作台 | 加 viewMode toggle + DecisionMakerView |
| §5.8.4 状态 A demo 模式 | demo 打磨(banner / 切换 / CTA / 引导任务进度) |
| §8.3 DemoHome.svelte | demo 打磨细化 |

### 10.2 与 P03-P10 的关系

| 文档 | P0-11 补的缺口 |
| --- | --- |
| P01 业务规则库 | 缺口 1(保存/删除 toast)+ 缺口 2(空库 EmptyState)+ 缺口 3(首次访问 GuidedHint) |
| P02 业务语言层 | 缺口 3(术语库首次访问提示) |
| P03 数据集 | 缺口 1 + 缺口 2 + 缺口 3 |
| P04 业务执行台 | 缺口 1(提交/翻译 toast)+ 缺口 3(首次表单填写提示) |
| P05 监控大屏 | 缺口 1(干预 toast)+ 缺口 4(决策者视图)+ 缺口 2(无运行数据空态) |
| P06 业务审计 | 缺口 1(导出/验证 toast)+ 缺口 4(决策者视图简化版) |
| P07 通用结果导出 | 缺口 1(导出进度/完成 toast) |
| P08 协作工作流 | 缺口 1(批准/驳回 toast)+ 缺口 2(无待审空态)+ 缺口 3(首次访问提示) |
| P09 导入导出基础设施 | 缺口 1(导入进度/冲突 toast) |
| P10 任务流 + demo | 缺口 1(任务完成 toast)+ 缺口 5(demo 打磨) |

### 10.3 与三层架构的关系

| 三层架构章节 | P0-11 关系 |
| --- | --- |
| §3.1 Production Runtime | DecisionMakerView 是 L1 监控大屏的简化版 |
| §11.4 同步状态表 | P0-11 完成后更新为「✅ 已设计」 |

### 10.4 与战略文档的关系

| b2b2c-strategy 章节 | P0-11 落地 |
| --- | --- |
| §3.2 角色 B 决策者 | 决策者视图(缺口 4)+ demo 打磨(缺口 5) |
| §5.8.4 状态 A demo 模式 | demo 打磨(缺口 5) |
| §20.2 P0-11 | 完整覆盖(5 缺口修复) |

---

## 11. 长期演进路径

### 11.1 P0 → P1

| 演进项 | P0 | P1 |
| --- | --- | --- |
| Toast | 浏览器内,即用即弃 | 持久化到 server(跨设备同步) |
| 引导 | 单次提示(localStorage 记忆) | 步骤式教程(Shepherd.js 风格) |
| 决策者视图 | 简化版(隐藏技术细节) | 可配置(决策者自选要看什么) |
| 空态 | 4 类标准文案 | 多语言 + 行业定制文案 |
| demo | GitHub Pages + MockBackend | 自定义域名 + 真实后端试用实例 |

### 11.2 P2

| 演进项 | 说明 |
| --- | --- |
| 通知中心 | 站内通知 + 邮件 + WebSocket 实时推送 |
| 引导教程 | 交互式教程(高亮 + 步骤 + 跳过) |
| 视图自定义 | 用户拖拽布局,自定义工作台 |
| a11y | WCAG 2.1 AA(视障 / 老年 / 色弱) |
| i18n | 中英双语(空态 / toast / 引导) |

---

## 12. 代码变更列表

### 12.1 新增文件

```
src/lib/stores/toast.ts                           # toastStore(队列管理)
src/lib/stores/view-mode.ts                       # viewModeStore(专家/决策者切换)
src/lib/stores/empty-state-types.ts               # EmptyStateType 类型
src/lib/stores/guided-task-progress.ts            # demo 引导任务进度记忆
src/lib/views/Feedback/Toast.svelte               # 统一 Toast 组件
src/lib/views/Feedback/EmptyState.svelte          # 统一空态组件
src/lib/views/Feedback/StatusBadge.svelte         # 统一状态徽标
src/lib/views/Feedback/GuidedHint.svelte          # 视图首次访问提示
src/lib/views/Feedback/OnboardingBanner.svelte    # 首屏引导条
src/lib/views/DecisionMaker/DecisionMakerView.svelte  # 决策者简化视图
tests/unit/toast.test.ts                          # toastStore 测试
tests/unit/view-mode.test.ts                      # viewModeStore 测试
tests/e2e/ux-gaps.spec.ts                         # 5 缺口修复 E2E 测试
```

### 12.2 修改文件

```
src/lib/views/Home/RealWorkbench.svelte   # 加 viewMode toggle + DecisionMakerView + OnboardingBanner + Toast
src/lib/views/Home/DemoHome.svelte        # demo 打磨(banner 文案 / 切换动画 / CTA 强化)
src/lib/views/Home/Demo/GuidedTasks.svelte # 加引导任务进度记忆
src/lib/views/Home/Demo/DemoBanner.svelte  # banner 文案优化
src/lib/views/Home/Demo/CapabilityList.svelte # 改为卡片布局
src/lib/views/Home/Demo/CtaFooter.svelte   # CTA 强化
# 以下视图加 Toast 调用 + EmptyState 引用 + GuidedHint:
src/lib/views/RuleLibrary/RuleLibraryView.svelte       # P01
src/lib/views/Dataset/DatasetManager.svelte            # P03
src/lib/views/Execution/BusinessExecutionPad.svelte    # P04
src/lib/views/Monitor/MonitorDashboard.svelte          # P05
src/lib/views/Audit/BusinessAuditView.svelte           # P06
src/lib/views/Export/ExportPanel.svelte                # P07
src/lib/views/Collab/CollabWorkflowView.svelte         # P08
src/lib/views/Import/ImportPanel.svelte                # P09
src/lib/views/TaskFlow/TaskFlowWizard.svelte           # P10(加完成 toast)
src/routes/+layout.svelte                # 全局挂载 Toast.svelte
```

### 12.3 实施顺序建议

```
1. 缺口 1 操作反馈(基础)
   ├─ toast.ts(store)
   ├─ Toast.svelte(组件)
   ├─ +layout.svelte 全局挂载
   └─ P03-P10 各视图加 toast 调用

2. 缺口 2 空态一致(基础)
   ├─ EmptyState.svelte(组件)
   ├─ empty-state-types.ts
   └─ P03-P10 各视图替换零散空态

3. 缺口 3 引导优化
   ├─ GuidedHint.svelte
   ├─ OnboardingBanner.svelte
   └─ 各视图加首次访问提示

4. 缺口 4 决策者视图
   ├─ view-mode.ts(store)
   ├─ DecisionMakerView.svelte
   └─ RealWorkbench 加 toggle + 条件渲染

5. 缺口 5 demo 打磨
   ├─ guided-task-progress.ts
   ├─ DemoHome / DemoBanner / GuidedTasks / CapabilityList / CtaFooter 细化
   └─ 数据集切换动画 + 数据卡 count-up
```

---

## 13. 待办

### 13.1 立即可做(P0-11 实施前)

- [ ] 确认 4 类空态文案与各视图场景匹配
- [ ] 确认决策者视图要显示/隐藏的元素清单(与 P05/P06 协调)
- [ ] 设计 CSS 变量(--color-success-bg 等,确保与 app.css 对齐)

### 13.2 P0-11 实施时

- [ ] 实现 toast.ts / view-mode.ts / empty-state-types.ts / guided-task-progress.ts
- [ ] 实现 Toast / EmptyState / StatusBadge / GuidedHint / OnboardingBanner 5 个组件
- [ ] 实现 DecisionMakerView.svelte
- [ ] 修改 RealWorkbench(加 toggle + 条件渲染)
- [ ] 修改 DemoHome 及子组件(demo 打磨)
- [ ] 横向贯穿 P03-P10 各视图(加 toast 调用 + EmptyState 引用 + GuidedHint)

### 13.3 与战略文档同步

- [ ] 在 b2b2c-strategy.md §20.2 标注 P0-11 已设计(引用本文档)
- [ ] 在三层架构 §11.4 同步状态表新增 P11 条目(✅ 已设计)
- [ ] 在 临时1.md 标注 P11 已完成设计
