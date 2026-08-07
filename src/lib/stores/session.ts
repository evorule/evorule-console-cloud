// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 用户登录态 store。
// 持久化:localStorage(key: evorule-console-cloud:session)
// 设计:
//   - 当前为 mock 实现(P0 阶段,认证由 evorule-server 提供)
//   - P1+ 接 evorule-server 真实认证后,API 不变,只改内部实现

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export interface Session {
  loggedIn: boolean;
  userId: string | null;
  username: string | null;
  /** 登录时间戳(ms) */
  loginAt: number | null;
}

const STORAGE_KEY = "evorule-console-cloud:session";

const DEFAULT_SESSION: Session = {
  loggedIn: false,
  userId: null,
  username: null,
  loginAt: null,
};

function loadSession(): Session {
  if (!browser) return DEFAULT_SESSION;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return {
      loggedIn: parsed.loggedIn === true,
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      username: typeof parsed.username === "string" ? parsed.username : null,
      loginAt: typeof parsed.loginAt === "number" ? parsed.loginAt : null,
    };
  } catch {
    return DEFAULT_SESSION;
  }
}

export const sessionStore = writable<Session>(loadSession());

sessionStore.subscribe((s) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
});

// === 便捷更新函数 ===

export function login(userId: string, username: string): void {
  sessionStore.set({
    loggedIn: true,
    userId,
    username,
    loginAt: Date.now(),
  });
}

export function logout(): void {
  sessionStore.set({ ...DEFAULT_SESSION });
}

export function isLoggedIn(): boolean {
  let v = false;
  const unsub = sessionStore.subscribe((s) => {
    v = s.loggedIn;
  });
  unsub();
  return v;
}
