// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Widget 注册表类型定义(UV-021 Dashboard 总览页)。
//
// 「一切皆 plugin」交互层首个落地:widget 声明式注册,
// 渲染器(DashboardGrid)不感知具体 widget,注册即接入。
//
// 关联计划:iterations/07-UV021Dashboard总览页专项-盘点与计划.md §4

import type { Component } from 'svelte';
import type { PermissionAction } from '$lib/stores/permission-matrix';

/** widget 可挂载的表面(预留扩展口:未来同一 widget 可挂侧栏/其他页) */
export type WidgetSurface = 'workbench';

/**
 * widget 定义。
 * component 为 Svelte 组件,契约:无 props、数据自取(订阅全局 store),
 * 加载失败在卡内如实显示错误态(不静默降级)。
 */
export interface WidgetDef {
	/** 唯一 id,如 'identity' | 'system-status' */
	id: string;
	title: string;
	icon?: string;
	/**
	 * 权限门控(缺省=登录即见)。
	 * platform 用户:服务端下发 permissions 清单;demo 用户:本地角色矩阵。
	 * 双轨判定复用 hasPermission($currentUser,…)(UV-017 W5 响应式范式)。
	 */
	permission?: PermissionAction;
	/**
	 * 角色白名单(可选,缺省=不限角色)。
	 * 按角色名匹配:demo 用户为本地角色 id(exec/auditor/...),
	 * platform 用户为 server 角色名(administrator/approver/...)。
	 */
	roles?: string[];
	/** 网格跨度(3 列制) */
	span: 1 | 2 | 3;
	/** 排序权重,越小越靠上;同值按 id 字典序(确定性) */
	order: number;
	component: Component;
	/** 声明出现在哪些表面 */
	surfaces: WidgetSurface[];
}

/** 渲染相关元数据(component 之外的纯数据部分,纯函数层操作此形状) */
export type WidgetMeta = Omit<WidgetDef, 'component'>;
