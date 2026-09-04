// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// JSON 解析错误转译(UV-078 W1-A3)
// 背景:工作台/执行台/What-If 的指令提交输入面,非 JSON 文本直接把
// 浏览器引擎原文("Unexpected token 'u', ... is not valid JSON")抛给业务用户,
// 对不懂 JSON 的用户是硬伤。fail-fast 是设计(Error fact 保留原文),
// 但输入预校验层应给出可理解的中文指引。
//
// 原则:不吞错、不伪装 —— 中文解释 + 示例 + 原始错误一并呈现。

/**
 * 把 JSON.parse 抛出的 SyntaxError 转译为中文可操作提示。
 * 非 SyntaxError 原样返回其 message。
 *
 * @param err      JSON.parse 抛出的错误
 * @param example  展示给用户的合法示例(如 '{"amount": 50000}')
 */
export function translateJsonParseError(err: unknown, example = '{"amount": 50000}'): string {
  const raw = err instanceof Error ? err.message : String(err);
  const isSyntax = err instanceof SyntaxError || /is not valid JSON|Unexpected token|Unexpected end/i.test(raw);
  if (!isSyntax) return raw;
  return `指令须为合法 JSON 对象,如 ${example}(浏览器原始报错:${raw})`;
}
