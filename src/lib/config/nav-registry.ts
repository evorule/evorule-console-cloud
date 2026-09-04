// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// nav-registry — 导航注册表(UV-022 首项改造:一切皆 plugin 交互层落地之二)
//
// 单一事实源:侧栏(+layout)、总览跳单卡(WorkbenchJump)、命令面板(CommandPalette)
// 三处消费同一清单,门控天然一致(闭合 UV-023:此前侧栏仅登录门控、跳单卡按权限门控)。
//
// 契约(iterations/09-一切皆plugin-架构原则.md §2):
//   - 注册项五要素:id/声明/门控/实现(path+requiresDb)/表面(group+jump)
//   - 过滤逻辑纯函数(visibleNavItems),单测锁定
//   - 宿主不得特判具体项;新增导航 = 追加一行
//
// 与 VIEW_LIST 的分工:/view/* 分析视图由 VIEW_LIST(kernel view 域)驱动,
// 本注册表只管独立页面路由。

import type { PermissionAction } from "$lib/stores/permission-matrix";

/** 侧栏分组 */
export type NavGroup = "home" | "discover" | "governance";

export interface NavDef {
  /** 全局唯一标识(nav-<id> 亦作命令面板命令 id) */
  id: string;
  label: string;
  icon: string;
  path: string;
  group: NavGroup;
  /** 悬停说明(能力自描述) */
  title: string;
  /** 需登录;未登录时不可见 */
  loginRequired?: boolean;
  /**
   * 平台权限门控,ANY 语义(任一命中即可见)。
   * 双轨判定由调用方注入 hasPermission(平台=服务端下发,demo=本地矩阵)。
   */
  permissions?: PermissionAction[];
  /**
   * 进入前需已建库(非空库);未登录/空库时引导登录或建库向导。
   * 由宿主 +layout 的 navTo 实现分流(导出中心语义)。
   */
  requiresDb?: boolean;
  /** 出现在总览跳单卡(WorkbenchJump 消费) */
  jump?: boolean;
  /** 未登录锁定原因说明(跳单卡锁定态提示) */
  lockHint?: string;
}

export const NAV_REGISTRY: readonly NavDef[] = [
  {
    id: "overview",
    label: "总览",
    icon: "🧭",
    path: "/workbench",
    group: "home",
    title: "总览 — 一键看到所有状态 + 高频操作 + 单页跳",
  },
  {
    id: "monitor",
    label: "监控",
    icon: "📊",
    path: "/monitor",
    group: "home",
    title: "监控大屏 — 生产运行状态实时总览",
  },
  {
    id: "marketplace",
    label: "市场",
    icon: "🛒",
    path: "/marketplace",
    group: "discover",
    title: "模板市场 — 官方规则集(等保 2.0 等)一键导入",
    jump: true,
  },
  {
    id: "knowledge",
    label: "知识库",
    icon: "📚",
    path: "/knowledge",
    group: "discover",
    title: "知识库 — 执行侧知识数据资产浏览(UV-084 W5)",
    loginRequired: true,
  },
  {
    id: "help",
    label: "帮助",
    icon: "❓",
    path: "/help",
    group: "discover",
    title: "帮助 — 5 分钟上手 + 详细使用指南",
  },
  {
    id: "export",
    label: "导出",
    icon: "📤",
    path: "/export",
    group: "governance",
    title: "通用结果导出中心 — 6 种内容 × 4 种格式,BLAKE3 完整性自证",
    loginRequired: true,
    requiresDb: true,
    jump: true,
  },
  {
    id: "publish-queue",
    label: "发布队列",
    icon: "📥",
    path: "/publish-queue",
    group: "governance",
    title: "发布队列 — 规则集发布审批与紧急回滚",
    loginRequired: true,
    // UV-023 闭合:与跳单卡同门控(view_publish_queue),无权用户侧栏/跳单卡均隐藏
    permissions: ["view_publish_queue"],
    jump: true,
    lockHint: "需登录并具备发布队列查看权限",
  },
  {
    id: "version-history",
    label: "版本历史",
    icon: "📜",
    path: "/version-history",
    group: "governance",
    title: "版本历史 — 生产规则集版本时间线",
    loginRequired: true,
  },
  {
    id: "audit-log",
    label: "审计记录",
    icon: "🔍",
    path: "/audit",
    group: "governance",
    title: "审计员工作台 — BLAKE3 审计链 + 因果链回溯",
    loginRequired: true,
  },
  {
    id: "governance",
    label: "治理中心",
    icon: "🗂️",
    path: "/governance",
    group: "governance",
    title: "治理(evorule-rule)— 数据集/规则/5 态生命周期/审批发布/版本链",
    loginRequired: true,
    jump: true,
    lockHint: "需治理角色登录(admin/approver 等,演示凭据见启动说明)",
  },
  {
    id: "users",
    label: "用户管理",
    icon: "👥",
    path: "/users",
    group: "governance",
    title: "用户管理 — 平台账号/角色分配/启停(manage_users 可管理)",
    permissions: ["view_users", "manage_users"],
  },
  {
    id: "roles",
    label: "角色管理",
    icon: "🛡️",
    path: "/roles",
    group: "governance",
    title: "角色管理 — 自定义角色与权限矩阵",
    permissions: ["manage_roles"],
  },
  {
    id: "permissions",
    label: "权限策略",
    icon: "🔐",
    path: "/permissions",
    group: "governance",
    title: "权限策略 — A-流权限条目生命周期(草稿→审批→激活)与判定测试",
    loginRequired: true,
  },
];

/** 可见性判定上下文(由宿主注入,保持本模块纯函数无 store 依赖) */
export interface NavVisibilityContext {
  loggedIn: boolean;
  /** 用户是否持有该权限点(平台=服务端下发,demo=本地矩阵;null=未登录一律 false) */
  hasPermission: (action: PermissionAction) => boolean;
}

/**
 * 过滤出当前上下文可见的导航项(纯函数,保序)。
 * 规则:loginRequired 未登录隐藏;permissions 任一未命中隐藏;其余恒可见。
 */
export function visibleNavItems(
  registry: readonly NavDef[],
  ctx: NavVisibilityContext,
): NavDef[] {
  return registry.filter((item) => {
    if (item.loginRequired && !ctx.loggedIn) return false;
    if (item.permissions && !item.permissions.some((p) => ctx.hasPermission(p))) return false;
    return true;
  });
}

/** 按分组归类(保序);供侧栏分区渲染 */
export function navItemsByGroup(items: readonly NavDef[]): Record<NavGroup, NavDef[]> {
  const out: Record<NavGroup, NavDef[]> = { home: [], discover: [], governance: [] };
  for (const item of items) out[item.group].push(item);
  return out;
}
