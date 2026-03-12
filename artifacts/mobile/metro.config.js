const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const workspaceRoot = path.resolve(__dirname, "../..");
config.watchFolders = [workspaceRoot];

config.resolver = config.resolver ?? {};
// Block socket.io, engine.io, and ALL transient _tmp_N directories any package might create
config.resolver.blockList = [
  /node_modules\/.pnpm\/socket\.io@[^/]+\/node_modules\/socket\.io\/.*/,
  /node_modules\/.pnpm\/engine\.io@[^/]+\/node_modules\/engine\.io\/.*/,
  // Matches packagename_tmp_N with or without trailing slash/path
  /_tmp_\d+($|\/.*)/,
];

// Also configure the watcher to ignore these ephemeral directories
const originalWatcher = config.watcher ?? {};
config.watcher = {
  ...originalWatcher,
  watchman: {
    ...(originalWatcher.watchman ?? {}),
    deferStates: [],
  },
  // Exclude node_modules subdirectories matching the tmp pattern from being watched
  healthCheck: {
    enabled: false,
  },
};

module.exports = config;
