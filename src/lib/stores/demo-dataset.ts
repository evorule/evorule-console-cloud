// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// demo 模式数据集切换(医疗/财务)。
// 持久化:localStorage(key: evorule-console-cloud:demo-dataset)
// 默认:'medical'(业务直观,决策者秒懂)

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export type DemoDataset = "medical" | "finance" | "agent";

const STORAGE_KEY = "evorule-console-cloud:demo-dataset";
const DEFAULT_DATASET: DemoDataset = "medical";

function loadDataset(): DemoDataset {
  if (!browser) return DEFAULT_DATASET;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "medical" || raw === "finance" || raw === "agent") return raw;
  return DEFAULT_DATASET;
}

export const demoDatasetStore = writable<DemoDataset>(loadDataset());

demoDatasetStore.subscribe((d) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, d);
});

export function setDemoDataset(d: DemoDataset): void {
  demoDatasetStore.set(d);
}

export function toggleDemoDataset(): void {
  demoDatasetStore.update((d) =>
    d === "agent" ? "medical" : d === "medical" ? "finance" : "agent",
  );
}
