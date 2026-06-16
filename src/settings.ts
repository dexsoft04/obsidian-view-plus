export type DoubleClickBehavior = "off" | "plain-double-click" | "alt-double-click";

export interface ViewPlusSettings {
	doubleClickBehavior: DoubleClickBehavior;
	maxTextFileSizeMb: number;
	enableCompoundTextPatterns: boolean;
	enableExtensionlessTextSniff: boolean;
}

export const DEFAULT_SETTINGS: ViewPlusSettings = {
	doubleClickBehavior: "alt-double-click",
	maxTextFileSizeMb: 5,
	enableCompoundTextPatterns: true,
	enableExtensionlessTextSniff: true,
};
