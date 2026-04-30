import { App, Notice, TFile } from "obsidian";
import { closeSync, openSync, readSync } from "fs";
import { join } from "path";
import type { ViewPlusSettings } from "./settings";

export type FileKind = "text" | "media" | "external";

export interface FileClassification {
	kind: FileKind;
	textOpenEligible: boolean;
	matchedRule?: string;
}

interface CachedClassification {
	cacheKey: string;
	result: FileClassification;
}

const IMAGE_EXTS = new Set(["avif", "ico", "tiff", "tif"]);
const AUDIO_EXTS = new Set(["aac", "opus"]);
const VIDEO_EXTS = new Set(["mov", "avi", "mkv", "wmv", "m4v"]);
const OFFICE_EXTS = new Set(["doc", "docx", "xls", "xlsx"]);
const REGISTERED_TEXT_EXTENSIONS = [
	"js", "mjs", "cjs", "ts", "jsx", "tsx",
	"py", "rb", "php", "go", "rs",
	"c", "h", "cpp", "hpp", "java", "kt", "swift",
	"json", "jsonl", "ndjson", "yaml", "yml", "toml",
	"ini", "cfg", "conf", "properties", "env",
	"gitignore", "gitconfig", "gitattributes", "editorconfig",
	"dockerignore", "lock",
	"css", "scss", "sass", "less",
	"html", "htm", "xml",
	"sh", "bash", "zsh", "fish", "ps1",
	"sql", "csv", "tsv",
	"txt", "log", "diff", "patch",
] as const;
const REGISTERED_TEXT_EXTENSION_SET = new Set<string>(REGISTERED_TEXT_EXTENSIONS);
const TEXT_FILE_NAMES = new Set([
	"go.mod",
	".rules",
	".codexpolicy",
	".gitignore",
	".gitconfig",
	".gitattributes",
	".editorconfig",
	".dockerignore",
]);
const COMPOUND_TEXT_SUFFIXES = [".env.example"];
const EXTENSIONLESS_TEXT_FILE_NAMES = new Set([
	"license",
	"notice",
	"readme",
	"changelog",
	"dockerfile",
	"makefile",
	"justfile",
	"procfile",
]);
const TEXT_SNIFF_SAMPLE_BYTES = 4096;

export const MEDIA_EXTENSIONS = [...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS];
export const TEXT_EXTENSIONS = [...REGISTERED_TEXT_EXTENSIONS];

export function isNonMarkdownFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() !== "md";
}

export function isAutoTextFile(file: TFile): boolean {
	return REGISTERED_TEXT_EXTENSION_SET.has(file.extension.toLowerCase());
}

export function shouldOfferOpenInViewPlusText(
	file: TFile,
	classification: FileClassification
): boolean {
	return classification.kind === "text" && classification.textOpenEligible && !isAutoTextFile(file);
}

export function getMaxTextFileSizeBytes(settings: ViewPlusSettings): number {
	return Math.max(settings.maxTextFileSizeMb, 0.5) * 1024 * 1024;
}

export function formatBytesAsMb(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1);
}

export class ViewPlusFileClassifier {
	private readonly cache = new Map<string, CachedClassification>();

	constructor(
		private readonly app: App,
		private readonly getSettings: () => ViewPlusSettings
	) {}

	clear(): void {
		this.cache.clear();
	}

	invalidate(path: string): void {
		this.cache.delete(path);
	}

	peek(file: TFile): FileClassification {
		const settings = this.getSettings();
		const cacheKey = this.createCacheKey(file, settings);
		const cached = this.cache.get(file.path);
		if (cached?.cacheKey === cacheKey) {
			return cached.result;
		}

		const baseResult = getBaseClassification(file, settings);
		if (!needsExtensionlessTextSniff(file, settings, baseResult)) {
			return baseResult;
		}

		const sniffedResult = sniffExtensionlessTextFileSync(this.app, file);
		if (sniffedResult) {
			this.cache.set(file.path, { cacheKey, result: sniffedResult });
			return sniffedResult;
		}

		return baseResult;
	}

	async classify(file: TFile): Promise<FileClassification> {
		const settings = this.getSettings();
		const cacheKey = this.createCacheKey(file, settings);
		const cached = this.cache.get(file.path);
		if (cached?.cacheKey === cacheKey) {
			return cached.result;
		}

		const currentResult = this.peek(file);
		const refreshedCache = this.cache.get(file.path);
		if (refreshedCache?.cacheKey === cacheKey) {
			return refreshedCache.result;
		}

		if (!needsExtensionlessTextSniff(file, settings, currentResult)) {
			this.cache.set(file.path, { cacheKey, result: currentResult });
			return currentResult;
		}

		const sniffedResult = await sniffExtensionlessTextFile(this.app, file);
		this.cache.set(file.path, { cacheKey, result: sniffedResult });
		return sniffedResult;
	}

	private createCacheKey(file: TFile, settings: ViewPlusSettings): string {
		return [
			file.stat.mtime,
			file.stat.size,
			settings.maxTextFileSizeMb,
			settings.enableCompoundTextPatterns,
			settings.enableExtensionlessTextSniff,
		].join(":");
	}
}

export function openWithSystemApp(app: App, file: TFile): void {
	const absPath = getAbsoluteFilePath(app, file);
	if (!absPath) {
		new Notice("View Plus: system app opening is only available on desktop.");
		return;
	}

	// @ts-ignore electron is available in the Obsidian desktop environment
	const { shell } = require("electron");
	shell.openPath(absPath).then((error: string) => {
		if (!error) return;
		console.error("View Plus: openPath failed", error);
		new Notice(`View Plus: could not open file - ${error}`);
	});
}

export function revealInSystemExplorer(app: App, file: TFile): void {
	const absPath = getAbsoluteFilePath(app, file);
	if (!absPath) {
		new Notice("View Plus: reveal is only available on desktop.");
		return;
	}

	try {
		// @ts-ignore electron is available in the Obsidian desktop environment
		const { shell } = require("electron");
		shell.showItemInFolder(absPath);
	} catch (error) {
		console.error("View Plus: showItemInFolder failed", error);
		new Notice("View Plus: could not reveal this file in the system explorer.");
	}
}

export function copyVaultRelativePath(file: TFile): void {
	copyText(file.path, "View Plus: copied vault-relative path.");
}

export function copyAbsolutePath(app: App, file: TFile): void {
	const absPath = getAbsoluteFilePath(app, file);
	if (!absPath) {
		new Notice("View Plus: absolute path copying is only available on desktop.");
		return;
	}
	copyText(absPath, "View Plus: copied absolute path.");
}

export function getAbsoluteFilePath(app: App, file: TFile): string | null {
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	if (typeof adapter.getBasePath !== "function") {
		return null;
	}
	return join(adapter.getBasePath(), file.path);
}

function copyText(text: string, successMessage: string): void {
	try {
		// @ts-ignore electron is available in the Obsidian desktop environment
		const { clipboard } = require("electron");
		clipboard.writeText(text);
		new Notice(successMessage);
	} catch (error) {
		console.error("View Plus: clipboard write failed", error);
		new Notice("View Plus: could not copy to the clipboard.");
	}
}

function getBaseClassification(file: TFile, settings: ViewPlusSettings): FileClassification {
	const extension = file.extension.toLowerCase();
	const name = file.name.toLowerCase();

	if (IMAGE_EXTS.has(extension) || AUDIO_EXTS.has(extension) || VIDEO_EXTS.has(extension)) {
		return {
			kind: "media",
			textOpenEligible: false,
			matchedRule: `media-extension:${extension}`,
		};
	}

	if (REGISTERED_TEXT_EXTENSION_SET.has(extension)) {
		return {
			kind: "text",
			textOpenEligible: true,
			matchedRule: `text-extension:${extension}`,
		};
	}

	if (settings.enableCompoundTextPatterns) {
		if (TEXT_FILE_NAMES.has(name)) {
			return {
				kind: "text",
				textOpenEligible: true,
				matchedRule: `filename:${name}`,
			};
		}
		for (const suffix of COMPOUND_TEXT_SUFFIXES) {
			if (name.endsWith(suffix)) {
				return {
					kind: "text",
					textOpenEligible: true,
					matchedRule: `compound-suffix:${suffix}`,
				};
			}
		}
	}

	if (OFFICE_EXTS.has(extension)) {
		return {
			kind: "external",
			textOpenEligible: false,
			matchedRule: `office-extension:${extension}`,
		};
	}

	return {
		kind: "external",
		textOpenEligible: false,
		matchedRule: extension ? `default-extension:${extension}` : "default:no-extension",
		};
}

function needsExtensionlessTextSniff(
	file: TFile,
	settings: ViewPlusSettings,
	classification: FileClassification
): boolean {
	if (classification.kind !== "external") return false;
	if (!settings.enableExtensionlessTextSniff) return false;
	if (file.extension.length > 0) return false;
	if (file.stat.size === 0) return true;
	if (file.stat.size > getMaxTextFileSizeBytes(settings)) return false;
	return true;
}

async function sniffExtensionlessTextFile(
	app: App,
	file: TFile
): Promise<FileClassification> {
	const hintedResult = getExtensionlessHintClassification(file);
	if (hintedResult) {
		return hintedResult;
	}

	try {
		const content = await app.vault.readBinary(file);
		if (looksLikeText(new Uint8Array(content))) {
			return {
				kind: "text",
				textOpenEligible: true,
				matchedRule: "extensionless-sniff",
			};
		}
	} catch (error) {
		console.error("View Plus: extensionless sniff failed", {
			path: file.path,
			error,
		});
	}

	return {
		kind: "external",
		textOpenEligible: false,
		matchedRule: "extensionless-nontext",
	};
}

function sniffExtensionlessTextFileSync(app: App, file: TFile): FileClassification | null {
	const hintedResult = getExtensionlessHintClassification(file);
	if (hintedResult) {
		return hintedResult;
	}

	const absPath = getAbsoluteFilePath(app, file);
	if (!absPath) {
		return null;
	}

	try {
		const content = readSampleFromDiskSync(absPath, TEXT_SNIFF_SAMPLE_BYTES);
		if (looksLikeText(content)) {
			return {
				kind: "text",
				textOpenEligible: true,
				matchedRule: "extensionless-sniff",
			};
		}
	} catch (error) {
		console.error("View Plus: synchronous extensionless sniff failed", {
			path: file.path,
			error,
		});
		return null;
	}

	return {
		kind: "external",
		textOpenEligible: false,
		matchedRule: "extensionless-nontext",
	};
}

function getExtensionlessHintClassification(file: TFile): FileClassification | null {
	const name = file.name.toLowerCase();
	if (EXTENSIONLESS_TEXT_FILE_NAMES.has(name)) {
		return {
			kind: "text",
			textOpenEligible: true,
			matchedRule: `extensionless-name:${name}`,
		};
	}
	return null;
}

function readSampleFromDiskSync(path: string, bytesToRead: number): Uint8Array {
	const descriptor = openSync(path, "r");
	try {
		const buffer = Buffer.allocUnsafe(bytesToRead);
		const bytesRead = readSync(descriptor, buffer, 0, bytesToRead, 0);
		return new Uint8Array(buffer.subarray(0, bytesRead));
	} finally {
		closeSync(descriptor);
	}
}

function looksLikeText(bytes: Uint8Array): boolean {
	if (bytes.length === 0) return true;

	const sampleLength = Math.min(bytes.length, 4096);
	let suspiciousBytes = 0;
	for (let index = 0; index < sampleLength; index += 1) {
		const value = bytes[index];
		if (value === 0) {
			return false;
		}
		const isControlCharacter = value < 32 && value !== 9 && value !== 10 && value !== 13;
		if (isControlCharacter || value === 127) {
			suspiciousBytes += 1;
		}
	}

	return suspiciousBytes / sampleLength < 0.02;
}
