const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const workspaceRoot = path.resolve(__dirname, "../..");
config.watchFolders = [workspaceRoot];

config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  /node_modules\/.pnpm\/socket\.io@[^/]+\/node_modules\/socket\.io\/.*/,
  /node_modules\/.pnpm\/engine\.io@[^/]+\/node_modules\/engine\.io\/.*/,
  /node_modules\/.pnpm\/css-line-break@[^/]+\/node_modules\/css-line-break_tmp[^/]*\/.*/,
  /node_modules\/.*_tmp_\d+\/.*/,
];

module.exports = config;
