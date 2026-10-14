import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function launchAgent({ node, script, host, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.iphone-native-mirror</string>
<key>ProgramArguments</key><array><string>${escape(node)}</string><string>${escape(script)}</string></array>
<key>EnvironmentVariables</key><dict>
<key>IPHONE_HOST</key><string>${escape(host)}</string>
<key>MIRROR_NAME</key><string>iPhone</string>
<key>MIRROR_HOST_LABEL</key><string>iphone-native-mirror</string>
<key>MIRROR_DEVICE_ID</key><string>02:49:50:48:4f:53</string>
<key>MIRROR_LOCAL_ONLY</key><string>1</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${escape(log)}</string>
<key>StandardErrorPath</key><string>${escape(log)}</string>
</dict></plist>\n`;
}

export function install({ dryRun = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS is required');
  const configPath = path.join(homedir(), 'Library/Application Support/iphone-native-mirror/config.json');
  const saved = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const host = process.env.IPHONE_HOST || saved.host;
  if (!host) throw new Error('Set IPHONE_HOST to the iPhone address for the first install');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const log = path.join(homedir(), 'Library/Logs/iphone-native-mirror.log');
  const destination = path.join(homedir(), 'Library/LaunchAgents/local.iphone-native-mirror.plist');
  const xml = launchAgent({ node: process.execPath, script: path.join(root, 'src/bridge.js'), host, log });
  if (dryRun) return { destination, xml };
  for (const args of [['-S', root, '-B', path.join(root, 'build'), '-DMIRROR_INTERNAL_MDNS=ON'], ['--build', path.join(root, 'build'), '-j', '4']]) {
    const result = spawnSync('cmake', args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Build failed; install cmake, libplist, pkgconf and openssl@3 with Homebrew');
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  mkdirSync(path.dirname(log), { recursive: true });
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ host }, null, 2) + '\n', { mode: 0o600 });
  const domain = `gui/${process.getuid()}`;
  spawnSync('/bin/launchctl', ['bootout', domain, destination], { stdio: 'ignore' });
  writeFileSync(destination, xml, { mode: 0o600 });
  const result = spawnSync('/bin/launchctl', ['bootstrap', domain, destination], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Service registration failed: ${result.stderr}`);
  console.log('Installed. Open OpenDisplay on the iPhone, then select iPhone in macOS Screen Mirroring.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // npm's global lifecycle installs the login service; local development does not.
  if (process.argv.includes('--dry-run')) console.log(JSON.stringify(install({ dryRun: true }), null, 2));
  else if (process.env.npm_config_global === 'true' || process.argv.includes('--install')) install();
}
