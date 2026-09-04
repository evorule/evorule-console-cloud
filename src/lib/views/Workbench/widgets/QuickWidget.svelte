<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  一键操作 widget:包装 WorkbenchQuick(UV-021 注册表化)。
  数据自取:sessionList 订阅 kernel;后端注入经 useBackend/useWorkspaceBackend。
-->

<script lang="ts">
  import WorkbenchQuick from "../WorkbenchQuick.svelte";
  import {
    useBackend,
    useWorkspaceBackend,
    sessions,
    currentWorkspace,
    refreshRules,
  } from "$lib/kernel";
  import { sessionStore } from "$lib/stores/session";
  import { isLlmConfigured, llmConfig } from "$lib/config/llm-config";
  import { toastInfo, toastError } from "$lib/stores/toast";
  import { translateJsonParseError } from "$lib/utils/json-error";

  const backend = useBackend();
  const wsBackend = useWorkspaceBackend();
  const sessionList = $derived($sessions);
  const ws = $derived($currentWorkspace);
  const loggedIn = $derived($sessionStore.loggedIn);
  const llmReady = $derived(isLlmConfigured($llmConfig));

  async function quickAddRule(ruleJson: string): Promise<void> {
    if (!ws) {
      toastError("当前无 workspace,请先创建");
      return;
    }
    try {
      const parsed = JSON.parse(ruleJson) as {
        rule_id?: string;
        type?: string;
        params?: object;
      };
      const ruleName = parsed.rule_id ?? `rule.user.${Date.now()}`;
      const content = JSON.stringify(
        { type: parsed.type, params: parsed.params ?? {} },
        null,
        2,
      );
      const { addRule } = await import("$lib/kernel");
      const newId = await addRule(wsBackend, ws.id, {
        name: ruleName,
        content,
      });
      if (newId) {
        toastInfo(`规则已提交: ${ruleName}`);
        await refreshRules(wsBackend, ws.id);
      } else {
        toastError("规则提交失败");
      }
    } catch (e) {
      toastError(`规则提交失败: ${translateJsonParseError(e, '{"type": "set", "params": {...}}')}`);
    }
  }

  async function quickRun(payloadJson: string): Promise<void> {
    try {
      const payload = JSON.parse(payloadJson) as object;
      const { submitCommand } = await import("$lib/kernel");
      const res = await submitCommand(backend, payload);
      if (res === null) {
        toastError("无活动 session,请先在执行台创建");
        return;
      }
      if (res.accepted) {
        toastInfo(`命令已提交,version=${res.version ?? "?"}`);
      } else {
        toastError(`执行失败: ${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      toastError(`Payload 解析失败: ${translateJsonParseError(e)}`);
    }
  }
</script>

<WorkbenchQuick
  {loggedIn}
  {llmReady}
  {sessionList}
  onAddRule={quickAddRule}
  onRun={quickRun}
/>
