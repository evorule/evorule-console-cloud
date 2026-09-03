<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  系统状态 widget:包装 WorkbenchTop(UV-021 注册表化)。
  数据自取:订阅 workbenchStatus store(宿主轮询产物)+ workspace/mode store。
-->

<script lang="ts">
  import WorkbenchTop from "../WorkbenchTop.svelte";
  import { currentWorkspace, CONSOLE_VERSION } from "$lib/kernel";
  import { netConfig } from "$lib/config/net-config";
  import { workbenchStatus, workbenchRefreshNow } from "$lib/stores/workbench-status";
  import { goto } from "$app/navigation";

  const ws = $derived($currentWorkspace);
  const mode = $derived($netConfig.mode);
  const st = $derived($workbenchStatus);

  function showOnboarding(): void {
    void goto("/?task=open");
  }
</script>

<WorkbenchTop
  serverConnected={st.serverConnected}
  ruleConnected={st.ruleConnected}
  {ws}
  {mode}
  consoleVersion={CONSOLE_VERSION}
  ruleVersion={st.ruleVersion}
  refreshing={st.refreshing}
  lastRefreshAt={st.lastRefreshAt}
  onRefresh={workbenchRefreshNow}
  onShowOnboarding={showOnboarding}
/>
