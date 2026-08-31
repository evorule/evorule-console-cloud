<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /help 路由 — 用户帮助页(R7 UX 原则第 2 条)
  展示:
    - 5 分钟 0→1 quickstart
    - 工作台 5 region 速查
    - 一键启停 3 方式
    - 跳完整 docs/* 链接
  数据源:docs/ 下的 .md(Svelte 直接渲染,不走 markdown 解析,确保零依赖)
-->

<script lang="ts">
  import { goto } from "$app/navigation";
  import HelpQuickstart from "$lib/views/Help/HelpQuickstart.svelte";
  import HelpWorkbench from "$lib/views/Help/HelpWorkbench.svelte";
  import HelpStart from "$lib/views/Help/HelpStart.svelte";
  import HelpFaq from "$lib/views/Help/HelpFaq.svelte";

  let activeTab = $state<"quickstart" | "workbench" | "start" | "faq">("quickstart");

  function jumpDocs(path: string) {
    // docs/ 下的文件是 markdown,跳到 GitHub 仓
    const url = `https://gitee.com/evorule/evorule-console-cloud/blob/main/${path}`;
    window.open(url, "_blank", "noopener");
  }

  function openFeedback() {
    const url = "https://gitee.com/evorule/evorule-console-cloud/issues";
    window.open(url, "_blank", "noopener");
  }

  function openMail() {
    window.location.href =
      "mailto:evorulelab@gmail.com?subject=" +
      encodeURIComponent("[evorule-console-cloud] 反馈与建议");
  }
</script>

<div class="help">
  <h1 class="help-title">❓ 帮助</h1>
  <p class="help-subtitle">5 分钟上手 + 详细使用指南 · 新用户从 quickstart 开始</p>

  <!-- Tabs -->
  <div class="help-tabs">
    <button
      class="help-tab"
      class:active={activeTab === "quickstart"}
      onclick={() => (activeTab = "quickstart")}
    >
      🚀 5 分钟上手
    </button>
    <button
      class="help-tab"
      class:active={activeTab === "workbench"}
      onclick={() => (activeTab = "workbench")}
    >
      📊 工作台速查
    </button>
    <button
      class="help-tab"
      class:active={activeTab === "start"}
      onclick={() => (activeTab = "start")}
    >
      ▶▶ 一键启停
    </button>
    <button
      class="help-tab"
      class:active={activeTab === "faq"}
      onclick={() => (activeTab = "faq")}
    >
      💡 常见问题
    </button>
  </div>

  <!-- Tab 内容 -->
  <div class="help-content">
    {#if activeTab === "quickstart"}
      <HelpQuickstart />
    {:else if activeTab === "workbench"}
      <HelpWorkbench />
    {:else if activeTab === "start"}
      <HelpStart />
    {:else if activeTab === "faq"}
      <HelpFaq />
    {/if}
  </div>

  <!-- 底部:跳完整文档 -->
  <div class="help-footer">
    <h2>📚 完整文档</h2>
    <p>这些只是快速参考,完整教程在 <code>docs/</code> 目录(GitHub 仓可读):</p>
    <ul>
      <li>
        <button class="link-btn" onclick={() => jumpDocs("docs/tutorial/01-quickstart.md")}>
          docs/tutorial/01-quickstart.md
        </button>
        — 5 分钟 0→1 详细 step-by-step
      </li>
      <li>
        <button class="link-btn" onclick={() => jumpDocs("docs/how-to/navigate-workbench.md")}>
          docs/how-to/navigate-workbench.md
        </button>
        — 工作台 5 region 详解
      </li>
      <li>
        <button class="link-btn" onclick={() => jumpDocs("docs/how-to/start-services.md")}>
          docs/how-to/start-services.md
        </button>
        — 一键启停 + 故障排查
      </li>
      <li>
        <button class="link-btn" onclick={() => jumpDocs("docs/workbench.md")}>
          docs/workbench.md
        </button>
        — 工作台设计 + 修改指南
      </li>
      <li>
        <button class="link-btn" onclick={() => jumpDocs("README.md")}>
          README.md
        </button>
        — 仓根目录 README
      </li>
    </ul>

    <!-- 反馈入口(UV-010) -->
    <div class="feedback-entry">
      <h2>💬 反馈与建议</h2>
      <p>使用中遇到问题、或有改进想法?我们认真对待每一条反馈,两种方式任选:</p>
      <ul>
        <li>
          <button class="link-btn" onclick={openFeedback}>
            Gitee Issues
          </button>
          — 提交问题/建议(推荐,可跟踪处理进度)
        </li>
        <li>
          <button class="link-btn" onclick={openMail}>
            evorulelab@gmail.com
          </button>
          — 邮件反馈(离线环境或不想注册 Gitee 时用)
        </li>
      </ul>
      <p class="feedback-note">
        提反馈时若方便,请附上:做了什么操作、期望结果、实际结果(截图更佳);
        请勿在反馈中粘贴你的 LLM API Key 或其他凭据。
      </p>
    </div>
  </div>
</div>

<style>
  .help {
    padding: 20px 24px;
    max-width: 1080px;
    margin: 0 auto;
  }
  .help-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 4px;
    font-size: 22px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .help-subtitle {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 20px;
  }
  .help-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 20px;
  }
  .help-tab {
    padding: 10px 16px;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 14px;
  }
  .help-tab:hover {
    color: var(--text-primary);
  }
  .help-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--primary, #2563eb);
  }
  .help-content {
    min-height: 400px;
  }
  .help-footer {
    margin-top: 40px;
    padding: 20px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .help-footer h2 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--text-primary);
  }
  .help-footer p {
    margin: 0 0 12px;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .help-footer ul {
    margin: 0;
    padding-left: 20px;
  }
  .help-footer li {
    color: var(--text-secondary);
    font-size: 13px;
    margin-bottom: 6px;
  }
  .link-btn {
    background: transparent;
    border: 0;
    color: var(--primary, #2563eb);
    cursor: pointer;
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
    font-size: 12px;
    padding: 0;
    text-decoration: underline;
  }
  .link-btn:hover {
    color: #1d4ed8;
  }
  .feedback-entry {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px dashed var(--border);
  }
  .feedback-note {
    margin-top: 12px;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
