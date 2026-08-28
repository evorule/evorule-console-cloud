<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:一键回滚按钮(P06 §6.1 + §7.5)
    - 点击触发 onRollbackRequest(version),由父组件弹出 ConfirmDialog
    - 不直接调 backend.rollbackRuleset(该 API 不在 ExecutionBackend 接口,
      滚动 session 切换由父组件/MonitorDashboard 统一处理)
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6.1 + §7.5
-->

<script lang="ts">
  interface Props {
    version: number;
    disabled?: boolean;
    onRollbackRequest?: (version: number) => void;
  }

  let { version, disabled = false, onRollbackRequest }: Props = $props();
</script>

<button
  class="rollback-button"
  {disabled}
  onclick={() => onRollbackRequest?.(version)}
  title={`回滚到 ruleset v${version}(将用旧规则产生新版本)`}
>
  ↩ 回滚到 v{version}
</button>

<style>
  .rollback-button {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--danger-bg, #fef2f2);
    color: var(--danger, #991b1b);
    border: 1px solid var(--danger, #fca5a5);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
    white-space: nowrap;
  }
  .rollback-button:hover:not(:disabled) {
    background: var(--danger-bg, #fee2e2);
  }
  .rollback-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
