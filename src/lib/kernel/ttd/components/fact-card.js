// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Fact 卡片 — 单条事实的渲染(按 type 上色 + 摘要)
//
// fact 字段(来自 /replay、/history):
//   {version, type, id, ...变体字段}
// type 取值:Command|StateTransition|IoRequest|IoResponse|Stable|PayloadUpdate|Error

import { h, esc } from '../core/dom.js';

// fact.type → fact-card CSS class(对应 main.css 中 .fact-card.cmd 等)
const TYPE_CLASS = {
  Command: 'cmd',
  StateTransition: 'statetransition',
  IoRequest: 'iorequest',
  IoResponse: 'ioresponse',
  Stable: 'stable',
  PayloadUpdate: 'cmd',  // PayloadUpdate 视为命令类(紫色)
  Error: 'error',
};

/**
 * 渲染单条 fact 卡片
 * @param {Object} fact - fact 对象
 * @param {{selected?: boolean, onSelect?: (fact: Object) => void}} opts
 * @returns {HTMLElement}
 */
export function renderFactCard(fact, { selected = false, onSelect = null } = {}) {
  const cls = TYPE_CLASS[fact.type] || '';
  const body = renderBody(fact);

  return h('div', {
    class: `fact-card ${cls}${selected ? ' selected' : ''}`.trim(),
    dataset: { version: String(fact.version), factId: String(fact.id) },
    onclick: onSelect ? () => onSelect(fact) : null
  }, [
    h('div', { class: 'head' }, [
      h('span', { class: 'type' }, `${fact.type} · v${fact.version}`),
      h('span', { class: 'id' }, `#${fact.id}`)
    ]),
    h('div', { class: 'body' }, body)
  ]);
}

function renderBody(fact) {
  switch (fact.type) {
    case 'Command':
      return [
        h('div', { class: 'tooltip' }, 'instruction:'),
        h('pre', { class: 'json-block' }, safeJson(fact.instruction))
      ];
    case 'StateTransition':
      return [
        h('div', { class: 'tooltip' }, `cause: #${fact.cause}`),
        h('pre', { class: 'json-block' }, safeJson(fact.new_payload))
      ];
    case 'IoRequest':
      return [
        h('div', { class: 'tooltip' },
          `io_type: ${esc(fact.io_type || '?')} · cause: #${fact.cause}`),
        h('pre', { class: 'json-block' }, safeJson(fact.params))
      ];
    case 'IoResponse':
      return fact.error
        ? [h('div', { class: 'error' }, `error: ${esc(fact.error)}`)]
        : [
            h('div', { class: 'tooltip' }, `request: #${fact.request_id}`),
            h('pre', { class: 'json-block' }, safeJson(fact.result))
          ];
    case 'Stable':
      // CR-20260901-001: Stable 瘦身为版本号(不再内嵌 final_snapshot 全量快照)
      return [
        h('div', { class: 'tooltip' }, `stable version: ${fact.version ?? '?'}`)
      ];
    case 'PayloadUpdate':
      return [
        h('div', { class: 'tooltip' }, `path: ${esc(fact.path)}`),
        h('pre', { class: 'json-block' }, safeJson(fact.value))
      ];
    case 'Error':
      return [h('div', { class: 'error' }, esc(fact.message || 'unknown error'))];
    default:
      return [h('pre', { class: 'json-block' }, safeJson(fact))];
  }
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); }
  catch { return String(v); }
}
