<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  统计卡 widget:包装 WorkbenchStats(UV-021 注册表化)。
  数据自取:订阅 kernel stores,派生逻辑在 workbench-data.ts(纯函数)。
-->

<script lang="ts">
  import WorkbenchStats from "../WorkbenchStats.svelte";
  import { goto } from "$app/navigation";
  import { rules, sessions, publishQueue, auditData } from "$lib/kernel";
  import { deriveStats, type AuditEntrySnapshot, type RuleSnapshot } from "../workbench-data";

  const ruleList = $derived($rules as RuleSnapshot[]);
  const sessionList = $derived($sessions);
  const audit = $derived($auditData);

  const statsData = $derived(
    deriveStats(
      ruleList,
      sessionList.length,
      $publishQueue.filter((p) => p.status === "pending").length,
      audit?.entries as AuditEntrySnapshot[] | undefined,
    )
  );

  function nav(path: string): void {
    void goto(path);
  }
</script>

<WorkbenchStats
  stats={statsData}
  onOpenRules={() => nav("/view/rules")}
  onOpenExecution={() => nav("/view/execution")}
  onOpenPublishQueue={() => nav("/publish-queue")}
  onOpenAudit={() => nav("/view/audit")}
/>
