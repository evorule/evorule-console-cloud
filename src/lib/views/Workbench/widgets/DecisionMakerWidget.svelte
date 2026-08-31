<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  决策者视图 widget(UV-021 W1d):包装 DecisionMakerView。
  按角色白名单展示(demo exec/auditor + platform approver,见注册表),
  决策者登录即见简化视图(P11 初衷),技术细节隐藏。
-->

<script lang="ts">
  import DecisionMakerView from "$lib/views/DecisionMaker/DecisionMakerView.svelte";
</script>

<div class="region-decision">
  <h2 class="region-title"><span class="icon">🎯</span>决策者视图</h2>
  <div class="decision-body">
    <DecisionMakerView />
  </div>
</div>

<style>
  .region-decision {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .region-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .icon {
    margin-right: 4px;
  }
  .decision-body {
    font-size: 13px;
  }
</style>
