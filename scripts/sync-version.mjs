#!/usr/bin/env node
// 读取 package.json 当前版本，同步到 .claude-plugin 下的配置文件，并自动提交
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 读取 package.json 里最新版本号（已由 npm version 更新）
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

// 写入 JSON 文件，保持 2 空格缩进和末尾换行
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

// 同步 .claude-plugin/plugin.json
const pluginPath = join(root, '.claude-plugin/plugin.json');
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
plugin.version = version;
writeJson(pluginPath, plugin);

// 同步 .claude-plugin/marketplace.json 中 easy-harness 插件的版本
const marketPath = join(root, '.claude-plugin/marketplace.json');
const market = JSON.parse(readFileSync(marketPath, 'utf8'));
for (const p of market.plugins ?? []) {
  if (p.name === 'easy-harness') p.version = version;
}
writeJson(marketPath, market);

console.log(`Synced version ${version} -> plugin.json, marketplace.json`);

// 自动提交版本相关的 4 个文件
const files = [
  'package.json',
  'package-lock.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
];
execSync(`git add ${files.join(' ')}`, { cwd: root, stdio: 'inherit' });
execSync(`git commit -m "chore: 更新版本至 ${version}"`, { cwd: root, stdio: 'inherit' });
console.log(`Committed: chore: 更新版本至 ${version}`);
