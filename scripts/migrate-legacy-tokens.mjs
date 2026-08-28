// PR9 全量 legacy token 迁移脚本
// 将组件中的 var(--color-*) 引用替换为对应的 v3 token(值保持等价)。
// 不修改 app.css(其 --color-* 别名/强制深色块在本脚本后手动清理)。
// 可重复运行:幂等。用法: node scripts/migrate-legacy-tokens.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = join(process.cwd(), "src");

// legacy --color-* -> v3 token 映射(基于 app.css 别名块 + 强制深色块语义)
const MAP = {
  "--color-text-secondary": "--text-secondary",
  "--color-gray-200": "--border",
  "--color-primary": "--brand",
  "--color-text-primary": "--text-primary",
  "--color-gray-300": "--border",
  "--color-gray-50": "--bg-page",
  "--color-info-bg": "--info-bg",
  "--color-error": "--danger",
  "--color-gray-500": "--text-secondary",
  "--color-warning": "--warning",
  "--color-gray-100": "--bg-hover",
  "--color-info": "--info",
  "--color-success": "--success",
  "--color-error-bg": "--danger-bg",
  "--color-gray-600": "--text-secondary",
  "--color-warning-bg": "--warning-bg",
  "--color-gray-700": "--text-primary",
  "--color-success-bg": "--success-bg",
  "--color-gray-400": "--text-secondary",
  "--color-info-text": "--info",
  "--color-gray-900": "--text-primary",
  "--color-error-text": "--danger",
  "--color-success-text": "--success",
  "--color-warning-text": "--warning",
  "--color-primary-hover": "--brand-hover",
  "--color-primary-dark": "--brand-hover",
  "--color-gray-800": "--text-primary",
  "--color-primary-bg": "--brand-bg", // 新增 v3 token(:root 中定义)
  "--color-bg-primary": "--bg-page",
  "--color-danger-bg": "--danger-bg",
  "--color-border": "--border",
};

const TARGET_EXT = new Set([".svelte", ".ts", ".js"]);
const SKIP = new Set(["app.css"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".svelte-kit") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TARGET_EXT.has(extname(name)) && !SKIP.has(name)) out.push(p);
  }
  return out;
}

const re = /var\(\s*(--color-[a-zA-Z0-9-]+)\s*(,\s*[^)]*?)?\s*\)/g;
// 第二遍:清理嵌套 fallback 中的 legacy 中间段,如
//   var(--info, var(--color-info, #1e40af)) -> var(--info, #1e40af)
// (--info 已是 v3 定义,内部 legacy 段为死分支)
const reNested = /,\s*var\(--color-[a-zA-Z0-9-]+,\s*([^()]*)\)/g;

let filesChanged = 0;
let totalReplaces = 0;
const unknowns = new Set();

for (const file of walk(ROOT)) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!content.includes("--color-")) continue;

  let n = 0;
  let next = content.replace(re, (m, tok, fallback) => {
    const v3 = MAP[tok];
    if (!v3) {
      unknowns.add(tok);
      return m;
    }
    n++;
    return `var(${v3}${fallback || ""})`;
  });
  // 第二遍:去掉嵌套 fallback 中的 legacy 中间段
  const nestedBefore = next;
  next = next.replace(reNested, (_, fallback) => `, ${fallback.trim()}`);
  const nestedCount = (nestedBefore.match(reNested) || []).length;
  n += nestedCount;

  if (next !== content) {
    writeFileSync(file, next, "utf8");
    filesChanged++;
    totalReplaces += n;
    console.log(`  + ${n}  ${file.replace(ROOT + "/", "")}`);
  }
}

console.log(`\n替换完成: ${filesChanged} 个文件, ${totalReplaces} 处引用。`);
if (unknowns.size) {
  console.log(`⚠️ 未映射的 legacy token(已跳过,需手动处理):`);
  for (const u of unknowns) console.log("   - " + u);
}
