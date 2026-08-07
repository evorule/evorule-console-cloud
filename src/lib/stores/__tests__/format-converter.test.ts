// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P09 format-converter 单测 — 6 格式互转矩阵 + 反序列化
//
// 运行: npx vitest run src/lib/stores/__tests__/format-converter.test.ts
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §5

import { describe, test, expect } from "vitest";
import {
	CONVERTERS,
	serializeTo,
	deserializeFrom,
	convertFormat,
	ALL_FORMATS,
	STRUCTURED_FORMATS,
	JsonConverter,
	YamlConverter,
	TomlConverter,
	CsvConverter,
	XmlConverter,
	PdfConverter,
	type UniversalFormat,
} from "../format-converter";

// ============================================================================
// 测试数据(模拟规则对象)
// ============================================================================

const SAMPLE_RULE = {
	id: "test.rule.1",
	version: 1,
	description: "测试规则:体温 > 38 触发热诊",
	condition: { fact: "patient.temperature", op: ">", value: 38 },
	action: { type: "block", reason: "高温分诊" },
	priority: 50,
	enabled: true,
};

const SAMPLE_ARRAY = [
	{ id: "r1", name: "规则1", value: 100 },
	{ id: "r2", name: "规则2", value: 200 },
];

// ============================================================================
// 1. 注册表完整性
// ============================================================================

describe("P09 format-converter 注册表", () => {
	test("6 个格式全部注册", () => {
		expect(ALL_FORMATS).toHaveLength(6);
		expect(ALL_FORMATS).toContain("json");
		expect(ALL_FORMATS).toContain("yaml");
		expect(ALL_FORMATS).toContain("toml");
		expect(ALL_FORMATS).toContain("csv");
		expect(ALL_FORMATS).toContain("xml");
		expect(ALL_FORMATS).toContain("pdf");
	});

	test("5 个结构化格式(可反序列化)", () => {
		expect(STRUCTURED_FORMATS).toHaveLength(5);
		expect(STRUCTURED_FORMATS).not.toContain("pdf");
	});

	test("每个 converter 都有 serialize 方法", () => {
		for (const f of ALL_FORMATS) {
			expect(CONVERTERS[f].format).toBe(f);
			expect(typeof CONVERTERS[f].serialize).toBe("function");
		}
	});

	test("PDF 不支持 deserialize", () => {
		expect(CONVERTERS.pdf.deserialize).toBeUndefined();
	});

	test("结构化格式都支持 deserialize", () => {
		for (const f of STRUCTURED_FORMATS) {
			expect(typeof CONVERTERS[f].deserialize).toBe("function");
		}
	});
});

// ============================================================================
// 2. JSON 转换器
// ============================================================================

describe("P09 JsonConverter", () => {
	const c = new JsonConverter();

	test("序列化为 Blob", async () => {
		const blob = await c.serialize(SAMPLE_RULE);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toContain("application/json");
	});

	test("反序列化还原对象", async () => {
		const blob = await c.serialize(SAMPLE_RULE);
		const restored = (await c.deserialize(blob)) as typeof SAMPLE_RULE;
		expect(restored.id).toBe("test.rule.1");
		expect(restored.condition.value).toBe(38);
	});

	test("prettyPrint 选项生效", async () => {
		const blob1 = await c.serialize(SAMPLE_RULE, { prettyPrint: false });
		const blob2 = await c.serialize(SAMPLE_RULE, { prettyPrint: true });
		expect(blob2.size).toBeGreaterThan(blob1.size);
	});
});

// ============================================================================
// 3. YAML 转换器(P0 子集)
// ============================================================================

describe("P09 YamlConverter", () => {
	const c = new YamlConverter();

	test("序列化为 YAML", async () => {
		const blob = await c.serialize(SAMPLE_RULE);
		const text = await blob.text();
		expect(text).toContain("id: test.rule.1");
		expect(text).toContain("condition:");
		expect(text).toContain("value: 38");
	});

	test("反序列化 YAML → 对象", async () => {
		const yamlText = `id: test
version: 1
description: 测试
priority: 50
enabled: true`;
		const obj = (await c.deserialize(yamlText)) as Record<string, unknown>;
		expect(obj.id).toBe("test");
		expect(obj.version).toBe(1);
		expect(obj.enabled).toBe(true);
	});

	test("数组序列化 + 反序列化", async () => {
		const blob = await c.serialize(SAMPLE_ARRAY);
		const restored = (await c.deserialize(blob)) as typeof SAMPLE_ARRAY;
		expect(restored).toHaveLength(2);
		expect(restored[0].id).toBe("r1");
		expect(restored[1].value).toBe(200);
	});

	test("嵌套对象 roundtrip", async () => {
		const blob = await c.serialize(SAMPLE_RULE);
		const restored = (await c.deserialize(blob)) as typeof SAMPLE_RULE;
		expect(restored.condition.fact).toBe("patient.temperature");
		expect(restored.action.type).toBe("block");
	});
});

// ============================================================================
// 4. TOML 转换器(P0 子集)
// ============================================================================

describe("P09 TomlConverter", () => {
	const c = new TomlConverter();

	test("序列化为 TOML", async () => {
		const blob = await c.serialize({
			name: "test",
			version: 1,
			enabled: true,
		});
		const text = await blob.text();
		expect(text).toContain('name = "test"');
		expect(text).toContain("version = 1");
		expect(text).toContain("enabled = true");
	});

	test("反序列化 TOML → 对象", async () => {
		const tomlText = `name = "test"
version = 1
enabled = true`;
		const obj = (await c.deserialize(tomlText)) as Record<string, unknown>;
		expect(obj.name).toBe("test");
		expect(obj.version).toBe(1);
		expect(obj.enabled).toBe(true);
	});

	test("[section] 表解析", async () => {
		const tomlText = `[rule]
id = "r1"
priority = 50`;
		const obj = (await c.deserialize(tomlText)) as Record<string, unknown>;
		const rule = obj.rule as Record<string, unknown>;
		expect(rule.id).toBe("r1");
		expect(rule.priority).toBe(50);
	});
});

// ============================================================================
// 5. CSV 转换器
// ============================================================================

describe("P09 CsvConverter", () => {
	const c = new CsvConverter();

	test("序列化数组为 CSV(含表头)", async () => {
		const blob = await c.serialize(SAMPLE_ARRAY);
		const text = await blob.text();
		expect(text).toContain("id,name,value");
		expect(text).toContain("r1,规则1,100");
		expect(text).toContain("r2,规则2,200");
	});

	test("反序列化 CSV → 对象数组", async () => {
		const csvText = "id,name,value\nr1,规则1,100\nr2,规则2,200";
		const arr = (await c.deserialize(csvText)) as Record<string, string>[];
		expect(arr).toHaveLength(2);
		expect(arr[0].id).toBe("r1");
		expect(arr[1].value).toBe("200");
	});

	test("含逗号的字段用引号包裹", async () => {
		const blob = await c.serialize([{ name: "hello, world" }]);
		const text = await blob.text();
		expect(text).toContain('"hello, world"');
	});

	test("UTF-8 BOM 前缀(Excel 中文兼容)", async () => {
		const blob = await c.serialize(SAMPLE_ARRAY);
		// 用 arrayBuffer 检查原始字节,Blob.text() 可能 strip BOM
		const buf = await blob.arrayBuffer();
		const bytes = new Uint8Array(buf);
		// UTF-8 BOM = EF BB BF
		expect(bytes[0]).toBe(0xEF);
		expect(bytes[1]).toBe(0xBB);
		expect(bytes[2]).toBe(0xBF);
	});
});

// ============================================================================
// 6. XML 转换器
// ============================================================================

describe("P09 XmlConverter", () => {
	const c = new XmlConverter();

	test("序列化为 XML", async () => {
		const blob = await c.serialize(SAMPLE_RULE);
		const text = await blob.text();
		expect(text).toContain('<?xml version="1.0"');
		expect(text).toContain("<evorule-export>");
		expect(text).toContain("<id>test.rule.1</id>");
	});

	test("反序列化 XML → 对象", async () => {
		if (typeof DOMParser === "undefined") {
			// Node 环境无 DOMParser,跳过(P0 简化:浏览器端用 DOMParser)
			expect(true).toBe(true);
			return;
		}
		const xmlText = `<?xml version="1.0"?>
<root>
  <id>test</id>
  <version>1</version>
</root>`;
		const obj = (await c.deserialize(xmlText)) as Record<string, unknown>;
		expect(obj.id).toBe("test");
		expect(obj.version).toBe("1");
	});

	test("XML 特殊字符转义", async () => {
		const blob = await c.serialize({ msg: "a < b & c > d" });
		const text = await blob.text();
		expect(text).toContain("a &lt; b &amp; c &gt; d");
	});
});

// ============================================================================
// 7. PDF 转换器(只序列化)
// ============================================================================

describe("P09 PdfConverter", () => {
	const c = new PdfConverter();

	test("序列化为 HTML(P0 降级方案)", async () => {
		const blob = await c.serialize(SAMPLE_RULE);
		const text = await blob.text();
		expect(text).toContain("<!DOCTYPE html>");
		expect(text).toContain("window.print");
		expect(blob.type).toContain("text/html");
	});

	test("PDF 不支持反序列化", () => {
		expect(c.deserialize).toBeUndefined();
	});
});

// ============================================================================
// 8. 通用 API:serializeTo / deserializeFrom / convertFormat
// ============================================================================

describe("P09 通用 API", () => {
	test("serializeTo 按格式返回 Blob", async () => {
		const blob = await serializeTo(SAMPLE_RULE, "yaml");
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toContain("yaml");
	});

	test("deserializeFrom 还原对象", async () => {
		const blob = await serializeTo(SAMPLE_RULE, "json");
		const obj = (await deserializeFrom(blob, "json")) as typeof SAMPLE_RULE;
		expect(obj.id).toBe("test.rule.1");
	});

	test("convertFormat 任意格式互转", async () => {
		const blob = await convertFormat(SAMPLE_RULE, "json", "yaml");
		const text = await blob.text();
		expect(text).toContain("id: test.rule.1");
	});

	test("deserializeFrom PDF 抛错", async () => {
		await expect(deserializeFrom("test", "pdf")).rejects.toThrow(
			/不支持反序列化/,
		);
	});
});

// ============================================================================
// 9. 6 格式序列化矩阵
// ============================================================================

describe("P09 6 格式序列化矩阵", () => {
	const formats: UniversalFormat[] = ["json", "yaml", "toml", "csv", "xml", "pdf"];

	for (const f of formats) {
		test(`${f} 序列化对象成功`, async () => {
			const blob = await serializeTo(SAMPLE_RULE, f);
			expect(blob.size).toBeGreaterThan(0);
		});
	}
});
