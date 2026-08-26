<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务/开发者模式切换开关(v0 新增,决策 §3.10)
    - 业务模式(默认):业务表单 + 业务预览,面向业务专家
    - 开发者模式:回退到内核 RuleLibraryView(JSON 编辑),面向工程师
    - 双向绑定 devMode,父组件 BusinessRuleLibrary 据此切换视图
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §6.1 + §3.10
-->

<script lang="ts">
  let {
    devMode = $bindable(),
  }: {
    devMode: boolean;
  } = $props();

  function toggle(): void {
    devMode = !devMode;
  }
</script>

<div class="dev-mode-toggle">
  <button
    type="button"
    class="toggle-btn"
    class:active={devMode}
    onclick={toggle}
    role="switch"
    aria-checked={devMode}
    aria-label="开发者模式切换"
  >
    <span class="toggle-track">
      <span class="toggle-thumb"></span>
    </span>
    <span class="toggle-label">
      {devMode ? "👨‍💻 开发者模式" : "👤 业务模式"}
    </span>
  </button>
  <small class="toggle-hint">
    {devMode ? "直接编辑 evorule JSON" : "业务表单填写,自动生成 JSON"}
  </small>
</div>

<style>
  .dev-mode-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 0.15s ease;
  }
  .toggle-btn:hover {
    background: var(--color-gray-100, #f1f5f9);
  }
  .toggle-track {
    display: inline-block;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--color-gray-300, #cbd5e1);
    position: relative;
    transition: background 0.2s ease;
  }
  .toggle-btn.active .toggle-track {
    background: var(--color-primary, #2563eb);
  }
  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg-card);
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .toggle-btn.active .toggle-thumb {
    transform: translateX(16px);
  }
  .toggle-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
    min-width: 96px;
  }
  .toggle-hint {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
</style>
