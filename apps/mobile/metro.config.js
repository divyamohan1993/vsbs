// Metro bundler config for the VSBS mobile app inside a pnpm monorepo.
//
// pnpm hoists dependencies to per-package node_modules with deep symlinks,
// so Metro must:
//   1. watch the workspace root (so changes to @vsbs/shared invalidate),
//   2. resolve modules from both the package's node_modules and the
//      workspace root's node_modules,
//   3. follow the SymlinksResolver path so it walks into ../../packages/shared.
//
// References: https://docs.expo.dev/guides/monorepos/

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
