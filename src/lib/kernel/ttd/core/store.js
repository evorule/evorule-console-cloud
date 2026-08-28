// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 响应式 store — subscribe + dispatch 模式,单一真相源

const initialState = {
  apiUrl: 'http://127.0.0.1:18080',
  sessions: [],
  currentSessionId: null,
  selectedVersion: 0,
  searchTerm: '',
  views: {
    timeline: { facts: [], maxVersion: 0, loading: false, playing: false, playSpeed: 1 },
    state: { version: null, payload: null },
    causal: { focusFactId: null, chain: [] },
    diff: { vA: null, vB: null, mode: 'server' },
    whatif: {
      status: 'idle', forkSessionId: null, parentVersion: null,
      commands: [], comparison: null
    }
  },
  auditBadge: { verified: null, factCount: null }
};

let state = { ...initialState, views: { ...initialState.views } };
const subscribers = new Set();

export const store = {
  getState() { return state; },

  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  dispatch(updater) {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...partial };
    subscribers.forEach(fn => fn(state));
  },

  /** 更新某个视图的局部状态 */
  setView(viewName, partial) {
    state = {
      ...state,
      views: {
        ...state.views,
        [viewName]: { ...state.views[viewName], ...partial }
      }
    };
    subscribers.forEach(fn => fn(state));
  },

  reset() {
    state = { ...initialState, views: { ...initialState.views } };
    subscribers.forEach(fn => fn(state));
  }
};
