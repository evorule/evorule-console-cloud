<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  快速跳单页 widget:包装 WorkbenchJump(UV-021 注册表化)。
  UV-017/021:目标项按权限门控(与侧栏同源 hasPermission 双轨判定),
  无权限的项直接隐藏(而非渲染后 403)。
-->

<script lang="ts">
  import WorkbenchJump from "../WorkbenchJump.svelte";
  import { goto } from "$app/navigation";
  import { sessionStore } from "$lib/stores/session";
  import { currentUser, hasPermission } from "$lib/stores/auth";
  import { toastInfo } from "$lib/stores/toast";

  const loggedIn = $derived($sessionStore.loggedIn);
  const user = $derived($currentUser);

  function onNav(path: string, loginRequired: boolean): void {
    if (loginRequired && !loggedIn) {
      toastInfo("请先登录");
      void goto("/login");
      return;
    }
    void goto(path);
  }
</script>

<WorkbenchJump loggedIn={loggedIn} {user} {hasPermission} {onNav} />
