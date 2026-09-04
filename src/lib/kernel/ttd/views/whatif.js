// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// What-If 视图 — 假设分析(4 步 wizard)
//
// 流程:
//   1. 选 fork 点(version)→ api.fork(parentId, version) 创建 fork session
//   2. 输入替代命令(JSON 数组)→ api.command(forkId, instruction) 逐条提交
//   3. 轮询 fork session 等待反应器稳定(version 连续 3 次不变)
//   4. 对比:fork 最终状态 vs 原始 session 在 fork 点的状态 → deepDiff
//
// 关键:
//   - command 是异步的(发送到 channel 后立即返回),必须轮询
//   - 不修改原 session(fork 是独立副本)
//   - 对比的基线是 fork 点(原始 session 在 parentVersion 的状态),
//     隔离"替代命令的净效果"

import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { eventbus, EVENTS } from '../core/eventbus.js';
import { h, clear, esc } from '../core/dom.js';
import { deepDiff } from '../algorithms/deep-diff.js';
import { renderDiffTree } from '../components/diff-tree.js';

const POLL_INTERVAL = 100;   // ms
const STABLE_THRESHOLD = 3;  // 连续 3 次版本不变 → 稳定
const MAX_WAIT = 8000;       // 最长等待 8s

export const WhatIfView = {
  /** SESSION_SELECT → 重置 */
  onSessionChange(id) {
    if (!id) return;
    this.reset();
  },

  onShow() {
    const state = store.getState();
    if (state.currentSessionId && state.views.whatif.status === 'idle') {
      this.render();
    }
  },

  /** 步骤 1:Fork */
  async runFork(parentVersion) {
    const state = store.getState();
    const parentId = state.currentSessionId;
    if (parentId == null) return;

    store.setView('whatif', { status: 'forking', parentVersion, error: null });
    this.render();

    try {
      const result = await api.fork(parentId, parentVersion);
      store.setView('whatif', {
        status: 'forked',
        forkSessionId: result.session_id
      });
      this.render();
    } catch (e) {
      store.setView('whatif', { status: 'error', error: `Fork 失败: ${e.message}` });
      this.render();
    }
  },

  /** 步骤 2-3:提交命令 + 轮询 + 对比 */
  async runCommands(commandsJson) {
    let commands;
    try {
      commands = JSON.parse(commandsJson);
      if (!Array.isArray(commands)) commands = [commands];
    } catch (e) {
      store.setView('whatif', { status: 'error', error: `JSON 解析失败: 指令须为合法 JSON 对象,如 {"type": "set", "path": "x", "value": 1}(浏览器原始报错:${e.message})` });
      this.render();
      return;
    }

    const state = store.getState();
    const w = state.views.whatif;
    const forkId = w.forkSessionId;
    const parentId = state.currentSessionId;
    const parentVersion = w.parentVersion;
    if (forkId == null || parentId == null) return;

    store.setView('whatif', { status: 'running', commands });
    this.render();

    try {
      // 逐条提交命令
      for (let i = 0; i < commands.length; i++) {
        const result = await api.command(forkId, commands[i]);
        if (result.success === false) {
          throw new Error(`命令 #${i} 提交失败: ${result.message}`);
        }
      }

      // 轮询等待稳定
      store.setView('whatif', { status: 'comparing' });
      this.render();
      await waitForStable(forkId);

      // 对比:fork 最终状态 vs 原始 session 在 fork 点的状态
      const [forkState, parentState] = await Promise.all([
        api.state(forkId),
        api.rewind(parentId, parentVersion)
      ]);

      const tree = deepDiff(parentState.payload, forkState.payload);
      store.setView('whatif', { status: 'done', comparison: tree });
      this.render();
    } catch (e) {
      store.setView('whatif', { status: 'error', error: `执行失败: ${e.message}` });
      this.render();
    }
  },

  reset() {
    store.setView('whatif', {
      status: 'idle', forkSessionId: null, parentVersion: null,
      commands: [], comparison: null, error: null
    });
    this.render();
  },

  render() {
    const panel = document.getElementById('panel-whatif');
    if (!panel) return;
    const state = store.getState();
    const w = state.views.whatif;
    clear(panel);

    if (!state.currentSessionId) {
      panel.appendChild(h('div', { class: 'empty' },
        '🔀 What-If 分析 — 从左侧选择一个 session 开始'));
      return;
    }

    panel.appendChild(h('div', { class: 'whatif-warn' },
      '⚠ What-If 会创建真实的 fork session 并提交命令。不修改原 session。'));

    switch (w.status) {
      case 'idle': case 'forking':     this.renderStep1(panel, state, w); break;
      case 'forked':                   this.renderStep2(panel, state, w); break;
      case 'running': case 'comparing': this.renderProgress(panel, w); break;
      case 'done':                     this.renderResult(panel, state, w); break;
      case 'error':                    this.renderError(panel, w); break;
      default:                         this.renderStep1(panel, state, w);
    }
  },

  renderStep1(panel, state, w) {
    const sel = state.selectedVersion || 0;
    const loading = w.status === 'forking';
    panel.appendChild(h('div', { class: 'whatif-step' }, [
      h('h3', {}, '步骤 1 · 选择 fork 点'),
      h('div', { class: 'tooltip' },
        `从原 session 的哪个 version 创建 fork(默认当前选中:v${sel})`),
      h('div', { class: 'actions-row', style: { marginTop: '8px' } }, [
        h('label', {}, ['parent version: ', h('input', {
          type: 'number', id: 'whatif-parent-version',
          value: String(sel), min: '0',
          style: { width: '70px' }, disabled: loading
        })]),
        h('button', {
          class: 'primary', disabled: loading,
          onclick: () => {
            const el = document.getElementById('whatif-parent-version');
            const v = parseInt(el?.value || '0', 10) || 0;
            this.runFork(v);
          }
        }, loading ? '⏳ Forking...' : '⑂ Fork')
      ])
    ]));
  },

  renderStep2(panel, state, w) {
    const defaultCmds = '[\n  {"type": "set", "path": "x", "value": 1}\n]';
    panel.appendChild(h('div', { class: 'whatif-step' }, [
      h('h3', {}, '步骤 2 · 输入替代命令'),
      h('div', { class: 'tooltip' },
        `fork session #${w.forkSessionId} 已就绪。输入要在 fork 上运行的命令(JSON 数组):`),
      h('textarea', {
        class: 'whatif-editor', id: 'whatif-commands'
      }, defaultCmds),
      h('div', { class: 'actions-row', style: { marginTop: '8px' } }, [
        h('button', {
          class: 'primary',
          onclick: () => {
            const el = document.getElementById('whatif-commands');
            this.runCommands(el?.value || '[]');
          }
        }, '▶ 运行命令'),
        h('button', { onclick: () => this.reset() }, '取消')
      ])
    ]));
  },

  renderProgress(panel, w) {
    const msg = w.status === 'running'
      ? `⏳ 提交 ${w.commands.length} 条命令到 fork #${w.forkSessionId}...`
      : `⏳ 等待 fork 反应器稳定,计算差异中...`;
    panel.appendChild(h('div', { class: 'whatif-step' }, [
      h('h3', {}, '步骤 3 · 执行中'),
      h('div', { class: 'empty' }, msg)
    ]));
  },

  renderResult(panel, state, w) {
    panel.appendChild(h('div', { class: 'whatif-step' }, [
      h('h3', {}, '步骤 4 · 对比结果'),
      h('div', { class: 'tooltip' },
        `fork #${w.forkSessionId}(替代命令后) vs 原始 #${state.currentSessionId}(fork 点 v${w.parentVersion})`),
      h('div', { class: 'actions-row', style: { marginTop: '8px' } }, [
        h('button', { onclick: () => this.reset() }, '↻ 重新开始')
      ])
    ]));
    if (w.comparison) {
      panel.appendChild(renderDiffTree(w.comparison, 2));
    } else {
      panel.appendChild(h('div', { class: 'empty' }, '无差异(两个状态完全相同)'));
    }
  },

  renderError(panel, w) {
    panel.appendChild(h('div', { class: 'error' }, w.error || '未知错误'));
    panel.appendChild(h('div', { class: 'actions-row', style: { marginTop: '8px' } }, [
      h('button', { onclick: () => this.reset() }, '↻ 重新开始')
    ]));
  }
};

/**
 * 轮询 session 直到 version 稳定(连续 STABLE_THRESHOLD 次不变)
 * @returns {Promise<number>} 最终 version
 */
async function waitForStable(sessionId) {
  const start = Date.now();
  let lastVersion = -1;
  let stableCount = 0;

  while (Date.now() - start < MAX_WAIT) {
    try {
      const st = await api.state(sessionId);
      const v = st.version;
      if (v === lastVersion) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) return v;
      } else {
        stableCount = 0;
        lastVersion = v;
      }
    } catch { /* 瞬时错误,继续轮询 */ }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  // 超时:返回最后一次看到的 version(可能是未完全稳定的状态)
  return lastVersion;
}
