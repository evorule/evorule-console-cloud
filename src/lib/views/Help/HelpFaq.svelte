<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  HelpFaq — /help 的常见问题 tab
-->

<div class="help-pane">
  <h2>💡 常见问题</h2>

  <div class="faq">
    <h3>Q:工作台显示 "server ○ 离线" / "rule ○ 离线" 怎么办?</h3>
    <p><strong>先检查进程在不在</strong>:</p>
    <pre><code>Get-Process -Name 'evorule-server','evorule-rule-serve'</code></pre>
    <p>如果没进程,跑 <code>start-all.bat</code> 重启。</p>
    <p>如果进程在但端口没 listen,可能是 binary 卡了,Stop-Process 后再 <code>start-all.bat</code>。</p>
  </div>

  <div class="faq">
    <h3>Q:点击"加规则"或"试运行"按钮,提示"请先登录"?</h3>
    <p>这是预期的 — 写操作(加规则/试运行)需要登录才能调 server 写接口。点顶栏右上的"🔐 登录"按钮:</p>
    <ul>
      <li>用 <code>evorule-rule-serve</code> 首次启动时自动创建的 admin 账号(具体凭据看启动日志)</li>
      <li>或用你之前注册的账号</li>
    </ul>
  </div>

  <div class="faq">
    <h3>Q:"4 引导任务"按钮跳到哪里?</h3>
    <p>跳到 5 步建库向导(<code>OnboardingWizard</code>):</p>
    <ol>
      <li>选模板(blank / finance / compliance)</li>
      <li>配置库元数据(库名 + 业务对象)</li>
      <li>创建首条规则</li>
      <li>试运行</li>
      <li>完成建库,进入工作台</li>
    </ol>
    <p>第一次进入 <code>/</code> 路由且库空时,会<strong>自动</strong>弹这个向导(不用手动点)。</p>
  </div>

  <div class="faq">
    <h3>Q:dev server 30 分钟被自动化任务管理器杀掉怎么办?</h3>
    <p>这是某些自动化任务管理器的 hard safety policy(后台 bash task 30 min maxRunMs 到期硬 kill)。</p>
    <p><strong>临时方案</strong>:频繁 <code>start-all.bat</code> 重启。</p>
    <p><strong>长期方案</strong>:用 <a href="https://nssm.cc/" target="_blank" rel="noopener">nssm</a> 把 <code>node scripts/dev.mjs</code> 装成 Windows 服务,完全脱离任务管理器控制。</p>
  </div>

  <div class="faq">
    <h3>Q:为什么 vite dev 在 <code>::1</code> 而不是 <code>127.0.0.1</code>?</h3>
    <p>Vite 5.x 默认 listen IPv6 localhost(<code>::1</code>),这是 Vite 设计如此。</p>
    <p>如果你的浏览器只能解析 IPv4,改用 <code>localhost:5174</code>(自动 fallback 到 IPv6)或在 <code>vite.config.ts</code> 显式配 <code>server.host: '127.0.0.1'</code>。</p>
  </div>

  <div class="faq">
    <h3>Q:工作台刷新太频繁(每 30s 自动),能关吗?</h3>
    <p>当前不能 — 改 <code>WorkbenchView.svelte</code> 顶部的 <code>setInterval</code> 间隔(健康 15s / 数据 30s / 时间 30s)。</p>
    <p>后续 todo:加"暂停自动刷新"开关。</p>
  </div>

  <div class="faq">
    <h3>Q:工作台 Region 3 加规则只支持"set" type,怎么加 call/conditional?</h3>
    <p>当前只预填了 set 模板。要加其它 type,改 <code>WorkbenchQuick.svelte</code> 加 type 下拉选择,或直接去 <code>/view/rules</code> 完整规则库视图操作。</p>
  </div>

  <div class="faq">
    <h3>Q:跳治理页(导出/发布队列/治理中心)显示 404 怎么办?</h3>
    <p>这些页面是 in-page modal 触发(<code>openSettings</code> 模式),<strong>不是真路由</strong>。直接从侧栏点,或访问:</p>
    <ul>
      <li>导出 → <code>/export</code></li>
      <li>发布队列 → <code>/publish-queue</code></li>
      <li>治理中心 → <code>/governance</code></li>
    </ul>
    <p>需要登录 + workspace 存在(否则路由守卫 307 弹回首页)。</p>
  </div>

  <div class="faq">
    <h3>Q:侧栏的"工作台"和"分析视图"是什么关系?</h3>
    <p>"🚀 工作台"是新加的极简首页(<code>/workbench</code>),一屏看清所有状态。"分析视图"下面是 5 个深度视图(规则库/执行台/状态/审计/时间旅行),适合具体操作。</p>
    <p>workbench 适合"看一眼",分析视图适合"做一件事"。</p>
  </div>

  <div class="faq">
    <h3>Q:怎么配 LLM 辅助(智谱/OpenAI/通义/DeepSeek)?</h3>
    <p>顶栏右上的 ⚙️ 设置 → LLM 配置 tab:</p>
    <ol>
      <li>选厂商预设(智谱/通义/DeepSeek/OpenAI)</li>
      <li>填 apiKey(只存浏览器 localStorage,<strong>不</strong>进 .env / git / 日志)</li>
      <li>点保存,侧栏 LLM 助手可用</li>
    </ol>
    <p>推荐<strong>智谱 GLM-4-Flash</strong>(有免费额度):<a href="https://open.bigmodel.cn/usercenter/apikeys" target="_blank" rel="noopener">开放平台</a> 获取 apiKey。</p>
  </div>

  <h2>还有问题?</h2>
  <p>看 <a href="https://gitee.com/evorule/evorule-console-cloud/issues" target="_blank" rel="noopener">Issues</a> 或直接看仓根目录 <code>docs/</code>(完整文档,本页面只是摘要)。</p>
</div>

<style>
  .help-pane {
    max-width: 800px;
  }
  h2 {
    margin: 24px 0 12px;
    font-size: 18px;
    color: var(--text-primary);
  }
  h2:first-child {
    margin-top: 0;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 14px;
    color: var(--text-primary);
  }
  p, ul, ol {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.7;
    margin: 0 0 8px;
  }
  .faq {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 12px;
  }
  .faq h3 {
    margin-top: 0;
    color: var(--primary, #2563eb);
  }
  code {
    background: var(--bg-input);
    border: 1px solid var(--border);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--text-primary);
  }
  pre {
    background: var(--bg-input);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 4px;
    margin: 8px 0;
    overflow-x: auto;
  }
  pre code {
    background: transparent;
    border: 0;
    padding: 0;
  }
  a {
    color: var(--primary, #2563eb);
  }
</style>
