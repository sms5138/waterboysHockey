const { run, which } = require('./exec');
const elevate = require('./elevate');

const RULE_NODE_BLOCK       = 'Waterboys: deny node outbound';
const RULE_NODE_LOOPBACK    = 'Waterboys: allow node loopback';
const RULE_CLOUDFLARED      = 'Waterboys: allow cloudflared outbound';
const RULE_CLOUDFLARED_LAN  = 'Waterboys: deny cloudflared LAN';

// RFC1918 + link-local for IPv4 + IPv6. Loopback is intentionally NOT in this
// list — cloudflared must reach our Node server on 127.0.0.1, and Windows
// Firewall doesn't filter loopback anyway.
const LAN_RANGES = '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,fc00::/7,fe80::/10';

// Apply outbound lockdown. All netsh calls run inside one elevated PowerShell
// session (one UAC prompt). Block rules win over allow rules at the same
// scope, so the LAN-deny rule carves the LAN out of cloudflared's allowed
// zone without affecting public-internet egress.
async function applyFirewallRules({ nodePath, cloudflaredPath, svcSid } = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'firewall changes only apply on Windows', steps: [] };
  }
  if (!nodePath) {
    const found = await which('node');
    if (!found) return { ok: false, error: 'node.exe not found on PATH', steps: [] };
    nodePath = found;
  }
  if (!cloudflaredPath) {
    const found = await which('cloudflared');
    if (!found) return { ok: false, error: 'cloudflared.exe not found on PATH', steps: [] };
    cloudflaredPath = found;
  }

  const userClause = svcSid ? [`user=O:${svcSid}`] : [];

  const calls = [
    // Idempotency: delete any prior rule with the same name. Expected to fail
    // on a clean install since the rule doesn't exist yet — allowFail.
    { label: `delete ${RULE_NODE_BLOCK}`,      cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NODE_BLOCK}`],      allowFail: true },
    { label: `delete ${RULE_NODE_LOOPBACK}`,   cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NODE_LOOPBACK}`],   allowFail: true },
    { label: `delete ${RULE_CLOUDFLARED}`,     cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_CLOUDFLARED}`],     allowFail: true },
    { label: `delete ${RULE_CLOUDFLARED_LAN}`, cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_CLOUDFLARED_LAN}`], allowFail: true },

    { label: `add ${RULE_NODE_BLOCK}`, cmd: 'netsh', args: [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${RULE_NODE_BLOCK}`,
      'dir=out', 'action=block',
      `program=${nodePath}`,
      ...userClause,
      'enable=yes', 'profile=any'
    ]},

    { label: `add ${RULE_NODE_LOOPBACK}`, cmd: 'netsh', args: [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${RULE_NODE_LOOPBACK}`,
      'dir=out', 'action=allow',
      `program=${nodePath}`,
      'remoteip=127.0.0.1,::1',
      'enable=yes', 'profile=any'
    ]},

    { label: `add ${RULE_CLOUDFLARED}`, cmd: 'netsh', args: [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${RULE_CLOUDFLARED}`,
      'dir=out', 'action=allow',
      `program=${cloudflaredPath}`,
      'enable=yes', 'profile=any'
    ]},

    { label: `add ${RULE_CLOUDFLARED_LAN}`, cmd: 'netsh', args: [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${RULE_CLOUDFLARED_LAN}`,
      'dir=out', 'action=block',
      `program=${cloudflaredPath}`,
      `remoteip=${LAN_RANGES}`,
      'enable=yes', 'profile=any'
    ]}
  ];

  return elevate.runElevated(calls);
}

async function removeFirewallRules() {
  if (process.platform !== 'win32') return { ok: true, steps: [] };
  // All four are allowFail — a missing rule is a no-op for our purposes.
  return elevate.runElevated([
    { label: `delete ${RULE_NODE_BLOCK}`,      cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NODE_BLOCK}`],      allowFail: true },
    { label: `delete ${RULE_NODE_LOOPBACK}`,   cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NODE_LOOPBACK}`],   allowFail: true },
    { label: `delete ${RULE_CLOUDFLARED}`,     cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_CLOUDFLARED}`],     allowFail: true },
    { label: `delete ${RULE_CLOUDFLARED_LAN}`, cmd: 'netsh', args: ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_CLOUDFLARED_LAN}`], allowFail: true }
  ]);
}

async function rulesPresent() {
  if (process.platform !== 'win32') {
    return { node: false, loopback: false, cloudflared: false, cloudflaredLan: false };
  }
  // show rule is read-only — no elevation needed.
  const exists = async (name) => {
    const r = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`]);
    return r.code === 0 && /Rule Name/i.test(r.stdout);
  };
  const [node, loopback, cloudflared, cloudflaredLan] = await Promise.all([
    exists(RULE_NODE_BLOCK),
    exists(RULE_NODE_LOOPBACK),
    exists(RULE_CLOUDFLARED),
    exists(RULE_CLOUDFLARED_LAN)
  ]);
  return { node, loopback, cloudflared, cloudflaredLan };
}

module.exports = {
  applyFirewallRules,
  removeFirewallRules,
  rulesPresent,
  RULE_NODE_BLOCK,
  RULE_NODE_LOOPBACK,
  RULE_CLOUDFLARED,
  RULE_CLOUDFLARED_LAN
};
