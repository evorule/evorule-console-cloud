// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 通用格式转换层 — 6 种格式(JSON/YAML/TOML/CSV/XML/PDF)互转。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §5 定义。
//
// 设计:
//   - 复用 P07 JsonRenderer/CsvRenderer/XmlRenderer/PdfRenderer 的核心逻辑
//   - YAML/TOML:P0 内置最小化实现(不引入 yaml/smol-toml 依赖)
//     支持规则/数据集/表单所需的子集:嵌套对象/数组/标量/字符串
//   - PDF:只序列化(复用 P07 PdfRenderer 的 HTML 降级方案),不反序列化
//   - 任意格式 → 任意格式:convertFormat(data, from, to) 内部经 JSON 中间态
//
// P0 简化说明:
//   - YAML/TOML 解析器只支持我们导出的子集(无 anchor/merge/multi-doc)
//   - 外部 YAML/TOML 文件若含高级特性,反序列化可能失败(抛错提示)
//   - P1 可平滑替换为 yaml + smol-toml 库(接口不变)
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §5

// ============================================================================
// 1. 类型定义
// ============================================================================

export type UniversalFormat = "json" | "yaml" | "toml" | "csv" | "xml" | "pdf";

export interface UniversalConverter {
	format: UniversalFormat;
	/** 序列化:对象 → Blob */
	serialize(data: unknown, options?: SerializeOptions): Promise<Blob>;
	/** 反序列化:字符串/Blob → 对象(仅结构化格式支持,PDF 无此方法) */
	deserialize?(
		input: string | Blob,
		options?: DeserializeOptions,
	): Promise<unknown>;
}

export interface SerializeOptions {
	prettyPrint?: boolean;
	encoding?: "utf-8" | "gbk";
	/** CSV 表头(若 data 是对象数组) */
	csvHeaders?: string[];
}

export interface DeserializeOptions {
	encoding?: "utf-8" | "gbk";
	/** CSV 表头(若首行无表头) */
	csvHeaders?: string[];
}

export const FORMAT_LABELS: Record<UniversalFormat, string> = {
	json: "JSON(开发者)",
	yaml: "YAML(可读性)",
	toml: "TOML(配置)",
	csv: "CSV(Excel)",
	xml: "XML(系统对接)",
	pdf: "PDF(归档,只读)",
};

export const ALL_FORMATS: UniversalFormat[] = [
	"json",
	"yaml",
	"toml",
	"csv",
	"xml",
	"pdf",
];

/** 结构化(可反序列化)格式 */
export const STRUCTURED_FORMATS: UniversalFormat[] = [
	"json",
	"yaml",
	"toml",
	"csv",
	"xml",
];

// ============================================================================
// 2. JSON 转换器(复用 P07 JSON 渲染逻辑)
// ============================================================================

export class JsonConverter implements UniversalConverter {
	format = "json" as const;

	async serialize(
		data: unknown,
		options?: SerializeOptions,
	): Promise<Blob> {
		const indent = options?.prettyPrint ? 2 : 0;
		const jsonStr = JSON.stringify(data, null, indent);
		return new Blob([jsonStr], { type: "application/json;charset=utf-8" });
	}

	async deserialize(input: string | Blob): Promise<unknown> {
		const text = typeof input === "string" ? input : await input.text();
		return JSON.parse(text);
	}
}

// ============================================================================
// 3. YAML 转换器(P0 内置最小化实现)
// ============================================================================

/**
 * YAML 转换器(P0 子集)。
 *
 * 支持的子集:
 *   - 标量:string / number / boolean / null
 *   - 数组(- item)
 *   - 对象(key: value)
 *   - 嵌套(缩进 2 空格)
 *   - 多行字符串(块标量 | 和 >)
 *
 * 不支持:anchor(&)/alias(*)/merge(<<)/tag(!!)/multi-doc(---)
 */
export class YamlConverter implements UniversalConverter {
	format = "yaml" as const;

	async serialize(
		data: unknown,
		options?: SerializeOptions,
	): Promise<Blob> {
		const lines: string[] = ["# evorule export (YAML 1.2 subset)"];
		yamlSerialize(data, lines, 0);
		const yamlStr = lines.join("\n");
		void options; // P0 不区分 pretty
		return new Blob([yamlStr], { type: "application/x-yaml;charset=utf-8" });
	}

	async deserialize(input: string | Blob): Promise<unknown> {
		const text = typeof input === "string" ? input : await input.text();
		return yamlParse(text);
	}
}

/** YAML 序列化(递归) */
function yamlSerialize(
	data: unknown,
	lines: string[],
	indent: number,
	key?: string,
): void {
	const pad = " ".repeat(indent);
	if (data === null || data === undefined) {
		// UV-089 ⑤:三处标量占位分支曾漏 pad,嵌套空值被序列化到第 0 列
		// 解析时错位成顶层 key(如 params.on_false: [] → 根级 on_false)
		lines.push(`${pad}${key !== undefined ? `${key}: ` : ""}null`);
		return;
	}
	if (Array.isArray(data)) {
		if (data.length === 0) {
			lines.push(`${pad}${key !== undefined ? `${key}: ` : ""}[]`);
			return;
		}
		if (key !== undefined) lines.push(`${pad}${key}:`);
		for (const item of data) {
			if (item !== null && typeof item === "object") {
				// 数组项为对象:先 push "- " 触发数组解析,再递归字段(缩进 +2)
				lines.push(`${pad}- `);
				yamlSerialize(item, lines, indent + 2);
			} else {
				lines.push(`${pad}- ${yamlScalar(item)}`);
			}
		}
		return;
	}
	if (typeof data === "object") {
		const entries = Object.entries(data as Record<string, unknown>);
		if (entries.length === 0) {
			lines.push(`${pad}${key !== undefined ? `${key}: ` : ""}{}`);
			return;
		}
		if (key !== undefined) lines.push(`${pad}${key}:`);
		for (const [k, v] of entries) {
			yamlSerialize(v, lines, indent + (key !== undefined ? 2 : 0), k);
		}
		return;
	}
	// 标量
	lines.push(`${pad}${key !== undefined ? `${key}: ` : ""}${yamlScalar(data)}`);
}

/** YAML 标量格式化 */
function yamlScalar(v: unknown): string {
	if (typeof v === "string") {
		// 含特殊字符的字符串用双引号包裹
		if (/[:#\[\]{}&*!|>'"%@`]/.test(v) || v.includes("\n")) {
			return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
		}
		return v;
	}
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return String(v);
}

/** YAML 解析(P0 子集,基于行的递归下降) */
export function yamlParse(text: string): unknown {
	// 去注释 + 去空行
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.replace(/(^|\s)#.*$/, "$1").trimEnd())
		.filter((l) => l.length > 0);
	if (lines.length === 0) return null;
	return yamlParseBlock(lines, 0, 0).value;
}

function yamlParseBlock(
	lines: string[],
	startIdx: number,
	indent: number,
): { value: unknown; nextIdx: number } {
	let i = startIdx;
	const firstLine = lines[i];
	const firstIndent = leadingSpaces(firstLine);
	const trimmedFirst = firstLine.trimStart();

	// 数组检测:支持 "- value" 和 "-" (后跟嵌套)
	if (trimmedFirst === "-" || trimmedFirst.startsWith("- ")) {
		const arr: unknown[] = [];
		while (i < lines.length) {
			const line = lines[i];
			const li = leadingSpaces(line);
			if (li < firstIndent) break;
			if (li > firstIndent) {
				// 跳过属于上一个元素的嵌套行(已在元素解析中处理)
				i++;
				continue;
			}
			const trimmed = line.trimStart();
			if (trimmed !== "-" && !trimmed.startsWith("- ")) break;

			// 提取 - 后面的内容
			const content = trimmed === "-" ? "" : trimmed.slice(2).trim();
			if (content === "" || content === "|" || content === ">") {
				// "- " 后跟嵌套对象,解析下一行起的嵌套块
				const nested = yamlParseBlock(lines, i + 1, firstIndent + 2);
				arr.push(nested.value);
				i = nested.nextIdx;
			} else if (content.includes(": ") || content.endsWith(":")) {
				// "- key: value" 或 "- key:" (inline 对象开头)
				const obj: Record<string, unknown> = {};
				const colonIdx = content.indexOf(": ");
				if (colonIdx === -1) {
					// "key:" 形式,看后续嵌套
					const k = content.replace(/:$/, "").trim();
					i++;
					const nested = yamlParseBlock(lines, i, firstIndent + 4);
					obj[k] = nested.value;
					i = nested.nextIdx;
				} else {
					const k = content.slice(0, colonIdx).trim();
					const v = content.slice(colonIdx + 2).trim();
					if (v === "" || v === "|" || v === ">") {
						i++;
						const nested = yamlParseBlock(lines, i, firstIndent + 4);
						obj[k] = nested.value;
						i = nested.nextIdx;
					} else {
						obj[k] = parseYamlScalar(v);
						i++;
					}
				}
				// 继续解析同对象的后续字段(缩进 > firstIndent)
				while (i < lines.length) {
					const nl = lines[i];
					const nli = leadingSpaces(nl);
					if (nli <= firstIndent) break;
					const ntrimmed = nl.trimStart();
					if (ntrimmed === "-" || ntrimmed.startsWith("- ")) break;
					const nci = ntrimmed.indexOf(": ");
					if (nci === -1) {
						// "key:" 无值,检查嵌套
						const nk = ntrimmed.replace(/:$/, "").trim();
						i++;
						if (i < lines.length && leadingSpaces(lines[i]) > nli) {
							const nested2 = yamlParseBlock(lines, i, nli + 2);
							obj[nk] = nested2.value;
							i = nested2.nextIdx;
						} else if (i < lines.length && isSeqItemLine(lines[i], nli)) {
							// UV-089 ⑤:同缩进 dash 序列(yamlSerialize 输出形态),同上
							const nested2 = yamlParseBlock(lines, i, nli);
							obj[nk] = nested2.value;
							i = nested2.nextIdx;
						} else {
							obj[nk] = null;
						}
					} else {
						const nk = ntrimmed.slice(0, nci).trim();
						const nv = ntrimmed.slice(nci + 2).trim();
						if (nv === "" || nv === "|" || nv === ">") {
							i++;
							const nested2 = yamlParseBlock(lines, i, nli + 2);
							obj[nk] = nested2.value;
							i = nested2.nextIdx;
						} else {
							obj[nk] = parseYamlScalar(nv);
							i++;
						}
					}
				}
				arr.push(obj);
			} else {
				arr.push(parseYamlScalar(content));
				i++;
			}
		}
		return { value: arr, nextIdx: i };
	}

	// 对象解析
	const obj: Record<string, unknown> = {};
	while (i < lines.length) {
		const line = lines[i];
		const li = leadingSpaces(line);
		if (li < firstIndent) break;
		if (li > firstIndent) {
			// 属于上一个 key 的嵌套内容,跳过(已在嵌套解析中处理)
			i++;
			continue;
		}
		const trimmed = line.trimStart();
		if (trimmed === "-" || trimmed.startsWith("- ")) break;

		// 查找 key: value 或 key: (嵌套)
		const colonIdx = trimmed.indexOf(": ");
		if (colonIdx === -1) {
			// 可能是 "key:" (无空格,后跟嵌套)
			const colonPos = trimmed.indexOf(":");
			if (colonPos === trimmed.length - 1) {
				// "key:" 形式
				const k = trimmed.slice(0, colonPos).trim();
				i++;
				// 检查下一行是否有更大缩进(嵌套内容)
				if (i < lines.length && leadingSpaces(lines[i]) > firstIndent) {
					const nested = yamlParseBlock(lines, i, firstIndent + 2);
					obj[k] = nested.value;
					i = nested.nextIdx;
				} else if (i < lines.length && isSeqItemLine(lines[i], firstIndent)) {
					// UV-089 ⑤:yamlSerialize 对 key 下非空数组输出"key 同缩进的 `- ` 项"形态,
					// 曾只认更大缩进导致该 key 静默置 null(roundtrip 丢 transform 无报错)
					const nested = yamlParseBlock(lines, i, firstIndent);
					obj[k] = nested.value;
					i = nested.nextIdx;
				} else {
					obj[k] = null;
				}
			} else {
				// 不是 key-value,跳过
				i++;
			}
			continue;
		}
		const k = trimmed.slice(0, colonIdx).trim();
		const v = trimmed.slice(colonIdx + 2).trim();
		if (v === "" || v === "|" || v === ">") {
			i++;
			const nested = yamlParseBlock(lines, i, firstIndent + 2);
			obj[k] = nested.value;
			i = nested.nextIdx;
		} else {
			obj[k] = parseYamlScalar(v);
			i++;
		}
	}
	return { value: obj, nextIdx: i };
}

function leadingSpaces(s: string): number {
	return s.match(/^ */)?.[0].length ?? 0;
}

/**
 * UV-089 ⑤:行是否为位于指定缩进的序列项("-" 或 "- xxx")。
 * yamlSerialize 对 key 下的非空数组输出"`key:` 同缩进的 `- ` 项"形态,
 * 解析侧须能识别该形态并交给数组块解析(否则 key 静默置 null)。
 */
function isSeqItemLine(line: string, indent: number): boolean {
	if (leadingSpaces(line) !== indent) return false;
	const t = line.trimStart();
	return t === "-" || t.startsWith("- ");
}

function parseYamlScalar(s: string): unknown {
	if (s === "null" || s === "~") return null;
	if (s === "true") return true;
	if (s === "false") return false;
	if (s === "[]") return [];
	if (s === "{}") return {};
	if (/^-?\d+$/.test(s)) return parseInt(s, 10);
	if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
	// 去引号
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return s;
}

// ============================================================================
// 4. TOML 转换器(P0 内置最小化实现)
// ============================================================================

/**
 * TOML 转换器(P0 子集)。
 *
 * 支持的子集:
 *   - 顶层 key = value
 *   - [section] 表
 *   - 数组用 [[section]] 或内联 [1, 2, 3]
 *   - 字符串/数字/布尔/日期
 *
 * 不支持:dotted keys / inline table / multi-line array(完整版)
 */
export class TomlConverter implements UniversalConverter {
	format = "toml" as const;

	async serialize(
		data: unknown,
		options?: SerializeOptions,
	): Promise<Blob> {
		const lines: string[] = ["# evorule export (TOML 1.0 subset)"];
		tomlSerialize(data, lines, "");
		void options;
		return new Blob([lines.join("\n")], {
			type: "application/toml;charset=utf-8",
		});
	}

	async deserialize(input: string | Blob): Promise<unknown> {
		const text = typeof input === "string" ? input : await input.text();
		return tomlParse(text);
	}
}

function tomlSerialize(
	data: unknown,
	lines: string[],
	prefix: string,
): void {
	if (data === null || typeof data !== "object") return;
	const obj = data as Record<string, unknown>;
	const scalars: Record<string, unknown> = {};
	const nested: Record<string, unknown> = {};
	const arrays: Record<string, unknown[]> = {};

	for (const [k, v] of Object.entries(obj)) {
		if (v !== null && typeof v === "object" && !Array.isArray(v)) {
			nested[k] = v;
		} else if (Array.isArray(v) && v.every((x) => x !== null && typeof x === "object")) {
			arrays[k] = v;
		} else {
			scalars[k] = v;
		}
	}

	// 顶层标量先输出
	if (prefix === "") {
		for (const [k, v] of Object.entries(scalars)) {
			lines.push(`${k} = ${tomlScalar(v)}`);
		}
		if (Object.keys(scalars).length > 0) lines.push("");
	}

	// 嵌套对象
	for (const [k, v] of Object.entries(nested)) {
		const section = prefix ? `${prefix}.${k}` : k;
		lines.push(`[${section}]`);
		const subObj = v as Record<string, unknown>;
		const subScalars: Record<string, unknown> = {};
		const subNested: Record<string, unknown> = {};
		for (const [sk, sv] of Object.entries(subObj)) {
			if (sv !== null && typeof sv === "object" && !Array.isArray(sv)) {
				subNested[sk] = sv;
			} else {
				subScalars[sk] = sv;
			}
		}
		for (const [sk, sv] of Object.entries(subScalars)) {
			lines.push(`${sk} = ${tomlScalar(sv)}`);
		}
		lines.push("");
		tomlSerialize(subNested, lines, section);
	}

	// 数组对象([[section]])
	for (const [k, v] of Object.entries(arrays)) {
		const section = prefix ? `${prefix}.${k}` : k;
		for (const item of v) {
			lines.push(`[[${section}]]`);
			const itemObj = item as Record<string, unknown>;
			for (const [ik, iv] of Object.entries(itemObj)) {
				if (iv !== null && typeof iv === "object" && !Array.isArray(iv)) {
					// 嵌套对象转 JSON 字符串(P0 简化)
					lines.push(`${ik} = ${tomlScalar(JSON.stringify(iv))}`);
				} else {
					lines.push(`${ik} = ${tomlScalar(iv)}`);
				}
			}
			lines.push("");
		}
	}

	// 顶层标量数组(转 JSON 字符串)
	if (prefix === "") {
		for (const [k, v] of Object.entries(obj)) {
			if (Array.isArray(v) && !arrays[k]) {
				lines.push(`${k} = ${tomlScalar(JSON.stringify(v))}`);
			}
		}
	}
}

function tomlScalar(v: unknown): string {
	if (typeof v === "string") return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (v === null) return '""';
	return `"${JSON.stringify(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlParse(text: string): unknown {
	const lines = text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#") && l.trim().length > 0);
	const root: Record<string, unknown> = {};
	let currentSection: Record<string, unknown> = root;
	let currentArray: { section: string; items: Record<string, unknown>[] } | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		// [[array.section]]
		const arrMatch = trimmed.match(/^\[\[(.+)\]\]$/);
		if (arrMatch) {
			const section = arrMatch[1];
			if (!currentArray || currentArray.section !== section) {
				currentArray = { section, items: [] };
				setPath(root, section, currentArray.items);
			}
			currentSection = {};
			currentArray.items.push(currentSection);
			continue;
		}
		// [section]
		const secMatch = trimmed.match(/^\[(.+)\]$/);
		if (secMatch) {
			const section = secMatch[1];
			currentArray = null;
			currentSection = {};
			setPath(root, section, currentSection);
			continue;
		}
		// key = value
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const k = trimmed.slice(0, eqIdx).trim();
		const v = trimmed.slice(eqIdx + 1).trim();
		currentSection[k] = parseTomlScalar(v);
	}
	return root;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(".");
	let cur = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") {
			cur[parts[i]] = {};
		}
		cur = cur[parts[i]] as Record<string, unknown>;
	}
	cur[parts[parts.length - 1]] = value;
}

function parseTomlScalar(s: string): unknown {
	if (s === "true") return true;
	if (s === "false") return false;
	if (/^-?\d+$/.test(s)) return parseInt(s, 10);
	if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return s;
}

// ============================================================================
// 5. CSV 转换器(复用 P07 CSV 逻辑)
// ============================================================================

export class CsvConverter implements UniversalConverter {
	format = "csv" as const;

	async serialize(
		data: unknown,
		options?: SerializeOptions,
	): Promise<Blob> {
		const delimiter = ",";
		const rows = csvFlattenToRows(data);
		const lines: string[] = [];
		if (rows.length === 0) {
			lines.push("# 无数据");
		} else {
			const headers = options?.csvHeaders ?? Object.keys(rows[0]);
			lines.push(headers.map((h) => csvEscape(h, delimiter)).join(delimiter));
			for (const row of rows) {
				lines.push(
					headers
						.map((h) => csvEscape(String(row[h] ?? ""), delimiter))
						.join(delimiter),
				);
			}
		}
		const bom = "\uFEFF";
		return new Blob([bom + lines.join("\n")], {
			type: "text/csv;charset=utf-8",
		});
	}

	async deserialize(
		input: string | Blob,
		options?: DeserializeOptions,
	): Promise<unknown> {
		const text = typeof input === "string" ? input : await input.text();
		return csvParse(text, options?.csvHeaders);
	}
}

function csvFlattenToRows(data: unknown): Record<string, unknown>[] {
	if (Array.isArray(data)) {
		return data.map((item) =>
			item !== null && typeof item === "object" ? flattenObject(item) : { value: item },
		);
	}
	if (data && typeof data === "object") {
		const obj = data as Record<string, unknown>;
		if (Array.isArray(obj.entries)) {
			return obj.entries.map((item: unknown) =>
				item !== null && typeof item === "object" ? flattenObject(item) : { value: item },
			);
		}
		return [flattenObject(data)];
	}
	return [];
}

function flattenObject(
	obj: unknown,
	prefix = "",
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (!obj || typeof obj !== "object") {
		result[prefix || "value"] = obj;
		return result;
	}
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		const fullKey = prefix ? `${prefix}.${k}` : k;
		if (v !== null && typeof v === "object" && !Array.isArray(v)) {
			Object.assign(result, flattenObject(v, fullKey));
		} else if (Array.isArray(v)) {
			result[fullKey] = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ");
		} else {
			result[fullKey] = v;
		}
	}
	return result;
}

function csvEscape(value: string, delimiter: string): string {
	if (!value) return "";
	if (
		value.includes(delimiter) ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r")
	) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function csvParse(
	text: string,
	headers?: string[],
): Record<string, string>[] {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith("#"));
	if (lines.length === 0) return [];
	const parseLine = (line: string): string[] => {
		const result: string[] = [];
		let cur = "";
		let inQuote = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (inQuote) {
				if (ch === '"') {
					if (line[i + 1] === '"') {
						cur += '"';
						i++;
					} else {
						inQuote = false;
					}
				} else {
					cur += ch;
				}
			} else {
				if (ch === ",") {
					result.push(cur);
					cur = "";
				} else if (ch === '"') {
					inQuote = true;
				} else {
					cur += ch;
				}
			}
		}
		result.push(cur);
		return result;
	};
	const headerCells = headers ?? parseLine(lines[0]);
	const dataLines = headers ? lines : lines.slice(1);
	return dataLines.map((line) => {
		const cells = parseLine(line);
		const row: Record<string, string> = {};
		headerCells.forEach((h, i) => {
			row[h] = cells[i] ?? "";
		});
		return row;
	});
}

// ============================================================================
// 6. XML 转换器(复用 P07 XML 逻辑)
// ============================================================================

export class XmlConverter implements UniversalConverter {
	format = "xml" as const;

	async serialize(data: unknown, _options?: SerializeOptions): Promise<Blob> {
		const lines: string[] = [
			`<?xml version="1.0" encoding="UTF-8"?>`,
			`<evorule-export>`,
			objectToXml(data, 2),
			`</evorule-export>`,
		];
		return new Blob([lines.join("\n")], {
			type: "application/xml;charset=utf-8",
		});
	}

	async deserialize(input: string | Blob): Promise<unknown> {
		const text = typeof input === "string" ? input : await input.text();
		return xmlParse(text);
	}
}

function objectToXml(obj: unknown, indent: number): string {
	const pad = " ".repeat(indent);
	if (obj === null || obj === undefined) return `${pad}<null/>`;
	if (typeof obj !== "object") return `${pad}${xmlEscape(String(obj))}`;
	if (Array.isArray(obj)) {
		return obj
			.map(
				(item) =>
					`${pad}<item>\n${objectToXml(item, indent + 2)}\n${pad}</item>`,
			)
			.join("\n");
	}
	const entries = Object.entries(obj as Record<string, unknown>);
	return entries
		.map(([k, v]) => {
			const tag = xmlTagName(k);
			if (v !== null && typeof v === "object") {
				return `${pad}<${tag}>\n${objectToXml(v, indent + 2)}\n${pad}</${tag}>`;
			}
			return `${pad}<${tag}>${xmlEscape(String(v ?? ""))}</${tag}>`;
		})
		.join("\n");
}

function xmlEscape(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function xmlTagName(key: string): string {
	let name = key.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
	if (!/^[a-zA-Z_]/.test(name)) name = `_${name}`;
	return name;
}

/** XML 解析(用 DOMParser,P0 浏览器环境) */
function xmlParse(text: string): unknown {
	if (typeof DOMParser === "undefined") {
		throw new Error("XML 解析需要浏览器环境(DOMParser)");
	}
	const parser = new DOMParser();
	const doc = parser.parseFromString(text, "application/xml");
	const root = doc.documentElement;
	return xmlNodeToObject(root);
}

function xmlNodeToObject(node: Element): unknown {
	// 子元素
	const children = Array.from(node.children);
	if (children.length === 0) {
		return node.textContent?.trim() ?? "";
	}
	// 检测数组(全部子元素同名)
	const firstTag = children[0].tagName;
	const allSameTag = children.every((c) => c.tagName === firstTag);
	if (allSameTag && children.length > 1) {
		return children.map((c) => xmlNodeToObject(c));
	}
	const obj: Record<string, unknown> = {};
	for (const child of children) {
		const tag = child.tagName;
		const value = xmlNodeToObject(child);
		if (tag in obj) {
			// 同名 → 转数组
			const existing = obj[tag];
			if (Array.isArray(existing)) {
				existing.push(value);
			} else {
				obj[tag] = [existing, value];
			}
		} else {
			obj[tag] = value;
		}
	}
	return obj;
}

// ============================================================================
// 7. PDF 转换器(只序列化,降级为 HTML,复用 P07 策略)
// ============================================================================

export class PdfConverter implements UniversalConverter {
	format = "pdf" as const;

	async serialize(data: unknown, _options?: SerializeOptions): Promise<Blob> {
		// P0:降级为可打印 HTML(blob 类型 text/html,下载时扩展名 .html)
		// 调用方提示用户用浏览器"另存为 PDF"
		const html = renderPrintableHtml(data);
		return new Blob([html], { type: "text/html;charset=utf-8" });
	}

	// PDF 不支持反序列化(显式声明为 undefined 以满足 UniversalConverter 接口)
	deserialize: undefined;
}

function renderPrintableHtml(data: unknown): string {
	const lines: string[] = [];
	lines.push(`<!DOCTYPE html>`);
	lines.push(`<html lang="zh-CN"><head><meta charset="UTF-8">`);
	lines.push(`<title>evorule 导出报告</title>`);
	lines.push(`<style>`);
	lines.push(`body { font-family: "Microsoft YaHei", sans-serif; padding: 32px; color: #111827; }`);
	lines.push(`h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }`);
	lines.push(`pre { background: #f9fafb; padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; }`);
	lines.push(`@media print { body { padding: 16px; } }`);
	lines.push(`</style></head><body>`);
	lines.push(`<h1>evorule 导出报告</h1>`);
	lines.push(`<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
	lines.push(`<script>window.onload = () => { setTimeout(() => window.print(), 500); };<\/script>`);
	lines.push(`</body></html>`);
	return lines.join("\n");
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// ============================================================================
// 8. 转换器注册表 + 通用 API
// ============================================================================

export const CONVERTERS: Record<UniversalFormat, UniversalConverter> = {
	json: new JsonConverter(),
	yaml: new YamlConverter(),
	toml: new TomlConverter(),
	csv: new CsvConverter(),
	xml: new XmlConverter(),
	pdf: new PdfConverter(),
};

/** 获取转换器 */
export function getConverter(format: UniversalFormat): UniversalConverter {
	return CONVERTERS[format];
}

/**
 * 任意格式 → 任意格式转换。
 * 内部经 JSON 中间态(对象 → JSON → 对象 → 目标格式)。
 */
export async function convertFormat(
	data: unknown,
	_fromFormat: UniversalFormat,
	toFormat: UniversalFormat,
): Promise<Blob> {
	const converter = getConverter(toFormat);
	return converter.serialize(data, { prettyPrint: true });
}

/**
 * 序列化对象为目标格式 Blob。
 * @param data 待序列化数据
 * @param format 目标格式
 * @param options 序列化选项
 */
export async function serializeTo(
	data: unknown,
	format: UniversalFormat,
	options?: SerializeOptions,
): Promise<Blob> {
	return getConverter(format).serialize(data, options);
}

/**
 * 从字符串/Blob 反序列化为对象。
 * PDF 不支持反序列化(抛错)。
 */
export async function deserializeFrom(
	input: string | Blob,
	format: UniversalFormat,
	options?: DeserializeOptions,
): Promise<unknown> {
	const converter = getConverter(format);
	if (!converter.deserialize) {
		throw new Error(`格式 ${format} 不支持反序列化`);
	}
	return converter.deserialize(input, options);
}
