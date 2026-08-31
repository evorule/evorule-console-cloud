// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Widget 注册表纯逻辑层(DashboardGrid 的纯函数抽出)。
//
// 职责:
//   - 表面过滤:widget 是否声明挂载在某表面
//   - 权限门控:platform 走服务端下发清单,demo 走本地角色矩阵(复用 hasPermission)
//   - 角色白名单:决策者视图等按角色名匹配(demo 角色id / platform 角色名双轨)
//   - 排序:order 升序,同值按 id 字典序(确定性,不依赖注册表书写顺序)
//
// 设计:完全纯函数、泛型保留 component 字段,方便 vitest 单测(无 Svelte 依赖)。

import type { User } from '$lib/stores/auth';
import { hasPermission } from '$lib/stores/auth';
import type { WidgetMeta, WidgetSurface } from './types';

/** 未登录判定:所有 widget 均不可见 */
export function matchesPermission<T extends WidgetMeta>(def: T, user: User | null): boolean {
	if (def.permission === undefined) return user !== null;
	return hasPermission(user, def.permission);
}

/** 角色白名单:def.roles 缺省=不限;否则 user.role 必须在列 */
export function matchesRoles<T extends WidgetMeta>(def: T, user: User | null): boolean {
	if (def.roles === undefined) return true;
	if (user === null) return false;
	return def.roles.includes(user.role);
}

export function isVisibleOnSurface<T extends WidgetMeta>(
	def: T,
	surface: WidgetSurface,
): boolean {
	return def.surfaces.includes(surface);
}

/**
 * 单 widget 可见性 = 表面声明 ∧ 权限 ∧ 角色。
 * 未登录(null)一律不可见(渲染器由路由守卫保证登录,此处双保险)。
 */
export function isWidgetVisible<T extends WidgetMeta>(
	def: T,
	surface: WidgetSurface,
	user: User | null,
): boolean {
	return (
		user !== null && isVisibleOnSurface(def, surface) && matchesPermission(def, user) && matchesRoles(def, user)
	);
}

/** 排序:order 升序,同值按 id 字典序(确定性) */
export function sortForRender<T extends WidgetMeta>(defs: T[]): T[] {
	return [...defs].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 组合:表面 + 权限 + 角色 过滤 → 排序(渲染器唯一入口) */
export function selectWidgets<T extends WidgetMeta>(
	registry: readonly T[],
	surface: WidgetSurface,
	user: User | null,
): T[] {
	return sortForRender(registry.filter((def) => isWidgetVisible(def, surface, user)));
}
