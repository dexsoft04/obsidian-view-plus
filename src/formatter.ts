import type { TFile } from "obsidian";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { format } from "prettier";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import * as htmlPlugin from "prettier/plugins/html";
import * as postcssPlugin from "prettier/plugins/postcss";
import * as typescriptPlugin from "prettier/plugins/typescript";
import * as yamlPlugin from "prettier/plugins/yaml";
import { promisify } from "util";

const { Taplo } = require("@taplo/lib") as {
	Taplo: {
		initialize(): Promise<{
			format(content: string): Promise<string>;
		}>;
	};
};

interface FormatSupport {
	parser: string;
	plugins: unknown[];
}

const JSON_LINE_EXTENSIONS = new Set(["jsonl", "ndjson"]);
const ENV_FILE_NAMES = new Set([".env"]);
const SUPPORTED_FORMATTERS = new Map<string, FormatSupport>([
	["json", { parser: "json", plugins: [babelPlugin, estreePlugin] }],
	["yaml", { parser: "yaml", plugins: [yamlPlugin] }],
	["yml", { parser: "yaml", plugins: [yamlPlugin] }],
	["js", { parser: "babel", plugins: [babelPlugin, estreePlugin] }],
	["mjs", { parser: "babel", plugins: [babelPlugin, estreePlugin] }],
	["cjs", { parser: "babel", plugins: [babelPlugin, estreePlugin] }],
	["jsx", { parser: "babel", plugins: [babelPlugin, estreePlugin] }],
	["ts", { parser: "typescript", plugins: [typescriptPlugin, estreePlugin] }],
	["tsx", { parser: "typescript", plugins: [typescriptPlugin, estreePlugin] }],
	["css", { parser: "css", plugins: [postcssPlugin] }],
	["scss", { parser: "scss", plugins: [postcssPlugin] }],
	["less", { parser: "less", plugins: [postcssPlugin] }],
	["html", { parser: "html", plugins: [htmlPlugin] }],
	["htm", { parser: "html", plugins: [htmlPlugin] }],
]);
const execFileAsync = promisify(execFile);
let taploInstancePromise:
	| Promise<{
			format(content: string): Promise<string>;
	  }>
	| null = null;

export function canFormatWithViewPlus(file: TFile | null): boolean {
	if (!file) return false;
	return (
		file.extension.toLowerCase() === "toml" ||
		JSON_LINE_EXTENSIONS.has(file.extension.toLowerCase()) ||
		SUPPORTED_FORMATTERS.has(file.extension.toLowerCase()) ||
		isEnvLikeFile(file) ||
		isGoModFile(file)
	);
}

export async function formatWithViewPlus(file: TFile, content: string): Promise<string> {
	const extension = file.extension.toLowerCase();
	if (isEnvLikeFile(file)) {
		return formatEnvLike(content);
	}
	if (extension === "toml") {
		return formatToml(content);
	}
	if (isGoModFile(file)) {
		return formatGoMod(content);
	}
	if (JSON_LINE_EXTENSIONS.has(extension)) {
		return formatJsonLines(content);
	}

	const support = SUPPORTED_FORMATTERS.get(extension);
	if (!support) {
		throw new Error(`Unsupported format type: ${extension || "<no-extension>"}`);
	}

	return format(content, {
		parser: support.parser,
		plugins: support.plugins as never[],
	});
}

async function formatJsonLines(content: string): Promise<string> {
	const lines = content.split(/\r?\n/);
	const formattedLines = await Promise.all(
		lines.map(async (line) => {
			if (line.trim().length === 0) {
				return "";
			}
			return format(line, {
				parser: "json",
				plugins: [babelPlugin, estreePlugin] as never[],
			}).then((result) => result.trimEnd());
		})
	);
	return `${formattedLines.join("\n")}\n`;
}

function isEnvLikeFile(file: TFile): boolean {
	const name = file.name.toLowerCase();
	const extension = file.extension.toLowerCase();
	return extension === "env" || ENV_FILE_NAMES.has(name) || name.startsWith(".env.");
}

function isGoModFile(file: TFile): boolean {
	return file.name.toLowerCase() === "go.mod";
}

function formatEnvLike(content: string): string {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const formattedLines = lines.map((line) => {
		if (line.trim().length === 0) return "";
		if (line.trimStart().startsWith("#")) return line.trimEnd();

		const match = line.match(/^(\s*export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
		if (!match) {
			return line.trimEnd();
		}

		const exportPrefix = match[1] ? "export " : "";
		const key = match[2];
		const value = match[3].replace(/\s+$/u, "");
		return `${exportPrefix}${key}=${value}`;
	});

	return `${formattedLines.join("\n").replace(/\n+$/u, "")}\n`;
}

async function formatToml(content: string): Promise<string> {
	const taplo = await getTaploInstance();
	return taplo.format(content);
}

async function formatGoMod(content: string): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), "view-plus-go-mod-"));
	const filePath = join(tempDir, "go.mod");

	try {
		await writeFile(filePath, content, "utf8");
		await execFileAsync("go", ["mod", "edit", "-fmt", filePath]);
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (isCommandNotFound(error)) {
			throw new Error("Go is required to format go.mod files.");
		}
		throw error;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

function isCommandNotFound(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getTaploInstance(): Promise<{
	format(content: string): Promise<string>;
}> {
	if (!taploInstancePromise) {
		taploInstancePromise = Taplo.initialize();
	}
	return taploInstancePromise;
}
