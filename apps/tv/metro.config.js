const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : config.resolver?.blockList
        ? [config.resolver.blockList]
        : []),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]\\.t3[/\\\\].*`),
  ],
};

// pnpm shares packages such as expo-secure-store with apps/mobile, and their
// `expo` link reaches mobile's expo and its upstream react-native. Resolve
// these from this app (or its expo) so only react-native-tvos is bundled.
const PINNED = [
  "react-native",
  "react",
  "expo",
  "expo-modules-core",
  "expo-asset",
  "expo-constants",
  "expo-file-system",
  "expo-font",
  "expo-keep-awake",
];
const anchors = [
  path.join(__dirname, "index.ts"),
  path.join(fs.realpathSync(path.join(__dirname, "node_modules", "expo")), "package.json"),
];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = PINNED.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
  if (pinned) {
    for (const originModulePath of anchors) {
      try {
        return context.resolveRequest({ ...context, originModulePath }, moduleName, platform);
      } catch {}
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
