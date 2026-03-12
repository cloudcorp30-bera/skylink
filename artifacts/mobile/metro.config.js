const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const workspaceRoot = path.resolve(__dirname, "../..");
config.watchFolders = [workspaceRoot];

config.resolver = config.resolver ?? {};
// Block transient _tmp_N directories that package installs may create
config.resolver.blockList = [
  /_tmp_\d+($|\/.*)/,
];

const originalWatcher = config.watcher ?? {};
config.watcher = {
  ...originalWatcher,
  watchman: {
    ...(originalWatcher.watchman ?? {}),
    deferStates: [],
  },
  healthCheck: {
    enabled: false,
  },
};

module.exports = config;
