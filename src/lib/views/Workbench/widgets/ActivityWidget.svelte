<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  最近活动 widget:包装 WorkbenchActivity(UV-021 注册表化)。
  数据自取:audit store → deriveActivity 纯函数(workbench-data.ts)。
-->

<script lang="ts">
  import WorkbenchActivity from "../WorkbenchActivity.svelte";
  import { goto } from "$app/navigation";
  import { auditData } from "$lib/kernel";
  import { deriveActivity, type AuditEntrySnapshot } from "../workbench-data";

  const audit = $derived($auditData);
  const activityData = $derived(
    deriveActivity(audit?.entries as AuditEntrySnapshot[] | undefined)
  );

  function openFull(): void {
    void goto("/view/audit");
  }
</script>

<WorkbenchActivity activity={activityData} onOpenFull={openFull} />
