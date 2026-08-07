// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Toast 队列 store。
// - 最多同时 3 条,超过先进先出
// - 每条自动消失(success/info 4s,warning 5s,error 6s)
// - 支持手动关闭

import { writable } from "svelte/store";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number; // ms
}

const MAX_TOASTS = 3;
const DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

export const toastStore = writable<Toast[]>([]);

/** 内部:安排自动消失 */
function scheduleDismiss(id: string, duration: number): void {
  setTimeout(() => dismissToast(id), duration);
}

/** 内部:实际写入队列 */
function addToast(type: ToastType, message: string, title?: string): void {
  const id = crypto.randomUUID();
  const duration = DURATION[type];
  const toast: Toast = { id, type, title, message, duration };

  toastStore.update((queue) => {
    const next = [...queue, toast];
    // 超过上限,移除最早的
    if (next.length > MAX_TOASTS) {
      next.splice(0, next.length - MAX_TOASTS);
    }
    return next;
  });

  scheduleDismiss(id, duration);
}

/**
 * 显示 toast(通用入口)
 * @param message 消息文本
 * @param type toast 类型(默认 info)
 * @param title 可选标题
 */
export function pushToast(message: string, type: ToastType = "info", title?: string): void {
  addToast(type, message, title);
}

/** 便捷方法 */
export function toastSuccess(message: string, title?: string): void {
  addToast("success", message, title);
}

export function toastError(message: string, title?: string): void {
  addToast("error", message, title);
}

export function toastWarning(message: string, title?: string): void {
  addToast("warning", message, title);
}

export function toastInfo(message: string, title?: string): void {
  addToast("info", message, title);
}

/** 手动关闭 */
export function dismissToast(id: string): void {
  toastStore.update((queue) => queue.filter((t) => t.id !== id));
}

/** 清空所有 */
export function clearToasts(): void {
  toastStore.set([]);
}
