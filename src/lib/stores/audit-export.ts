// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 审计导出/导入 store(P06 §5.4 简化版)。
//
// 注意:P06 §5.4 设计的是"单一 JSON 导出/导入"的简版;
// P07_RESULT_EXPORT_DESIGN.md 设计的是"多内容 + 多格式 + 模板"的完整版
// (位于 ./export-engine.ts + ./export-store.ts)。
//
// 本 store 处理:
//   - audit_chain 内容的 JSON / 压缩 JSON 导出(调 backend audit/export API)
//   - 审计链导入验证(调 backend import audit API)
//   - 状态机:idle / exporting / importing / done / error
//
// 与 P07 的关系:P07 ExportDialog 的"audit_chain + JSON"组合会复用本 store 的逻辑,
// 但 P07 也支持其他 5 种内容 + 4 种格式,由 export-engine.ts 统一调度。

import { writable } from "svelte/store";
import type { AuditImportResult, ExecutionBackend } from "$lib/kernel";

// ============================================================================
// 类型
// ============================================================================

export type ExportStatus = "idle" | "exporting" | "importing" | "done" | "error";

export interface AuditExportState {
  status: ExportStatus;
  message: string;
  /** 导出数据(只在 status=done 时有,供调试查看) */
  data: unknown | null;
}

export const auditExportStore = writable<AuditExportState>({
  status: "idle",
  message: "",
  data: null,
});

// ============================================================================
// Actions
// ============================================================================

/**
 * 导出审计链(JSON 或压缩 JSON)。
 *
 * @param sessionId  当前 session id
 * @param backend    ExecutionBackend(UV-062 W2 起 exportAudit/exportAuditCompressed 为接口必选方法)
 * @param compressed 是否压缩(P06 §5.4,false=JSON,true=JSON.gz)
 * @param filename   自定义文件名(默认 audit-session-{id}.json)
 */
export async function exportAudit(
  sessionId: number,
  backend: ExecutionBackend,
  compressed = false,
  filename?: string,
): Promise<void> {
  auditExportStore.set({
    status: "exporting",
    message: compressed ? "正在导出(压缩)..." : "正在导出...",
    data: null,
  });

  try {
    const finalName =
      filename ?? `audit-session-${sessionId}.${compressed ? "json.gz" : "json"}`;

    if (compressed) {
      // 压缩格式:返回 Blob,直接下载
      const blob = await backend.exportAuditCompressed(sessionId);
      downloadBlob(blob, finalName);
    } else {
      // JSON 格式:返回对象,序列化后下载
      const data = await backend.exportAudit(sessionId);
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      downloadBlob(blob, finalName);
    }

    auditExportStore.set({
      status: "done",
      message: `审计链已导出: ${finalName}`,
      data: null,
    });
  } catch (e) {
    auditExportStore.set({
      status: "error",
      message: `导出失败: ${(e as Error).message}`,
      data: null,
    });
  }
}

/**
 * 导入审计链(server 导入后自动 verify,响应携带 verify_ok / status)。
 *
 * ⚠ 破坏性操作:server 端 import 会**完全覆盖**当前会话的审计链,
 * 调用方(UI 层)必须先经用户二次确认再调用本函数。
 *
 * @param sessionId  当前 session id
 * @param backend    ExecutionBackend(UV-084 W1 起 importAudit/importAuditCompressed 为接口必选方法)
 * @param data       导入的数据(JSON 对象或 Blob)
 * @param compressed 是否压缩
 */
export async function importAudit(
  sessionId: number,
  backend: ExecutionBackend,
  data: unknown,
  compressed = false,
): Promise<void> {
  auditExportStore.set({
    status: "importing",
    message: "正在导入验证...",
    data: null,
  });

  try {
    let result: AuditImportResult;

    if (compressed) {
      if (!(data instanceof Blob)) {
        throw new Error("压缩导入需要 Blob 类型数据");
      }
      result = await backend.importAuditCompressed(sessionId, data);
    } else {
      result = await backend.importAudit(sessionId, data);
    }

    auditExportStore.set({
      status: "done",
      message: result.verify_ok
        ? "审计链导入验证成功(BLAKE3 链完整)"
        : "审计链导入成功但验证失败:数据可能损坏(链断裂或不完整)",
      data: result,
    });
  } catch (e) {
    auditExportStore.set({
      status: "error",
      message: `导入失败: ${(e as Error).message}`,
      data: null,
    });
  }
}

/** 重置导出/导入状态 */
export function resetAuditExport(): void {
  auditExportStore.set({ status: "idle", message: "", data: null });
}

// ============================================================================
// 工具
// ============================================================================

/** 触发浏览器文件下载(Blob) */
function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return; // SSR 环境(noop)
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 异步释放 URL(给浏览器时间发起下载)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 从 File 对象读取为文本(导入用)。
 * UI 层用 <input type="file"> 选择文件后调用此函数获取内容。
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

/**
 * 从 File 对象读取为 Blob(压缩导入用)。
 */
export function readFileAsBlob(file: File): Blob {
  return file.slice(0, file.size, file.type || "application/octet-stream");
}
