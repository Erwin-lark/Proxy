import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  ROOT,
  canonical,
  loadTargetModel,
  materializeEntries,
  validateTargetTree,
} from '../tools/target-tree.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function filesUnder(root, prefix = '') {
  return readdirSync(root).sort().flatMap((name) => {
    const full = join(root, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? filesUnder(full, relative) : [relative];
  });
}

test('target source has two services, two client trees and three independent order areas', () => {
  const model = loadTargetModel(ROOT);
  assert.deepEqual(model.services.map((service) => service.serviceId), ['ai-messaging-speed-test', 'hong-kong-banks']);
  assert.deepEqual(Object.keys(model.clients), ['clash', 'loon']);
  assert.notDeepEqual(model.clients.clash.order.ruleSequence, model.clients.loon.order.ruleSequence);
  assert.notDeepEqual(model.clients.clash.order.groupOrder, model.clients.loon.order.groupOrder);
  assert.notDeepEqual(model.clients.clash.order.memberOrder, model.clients.loon.order.memberOrder);
  assert.notDeepEqual(model.clients.clash.overrides.tagOverrides, model.clients.loon.overrides.tagOverrides);
  assert.equal(model.clients.clash.order.ruleSequence.at(-1), 'rule-final');
  assert.equal(model.clients.loon.order.ruleSequence.at(-1), 'rule-final');
  assert.deepEqual(model.clients.clash.overrides.policyBindings, model.clients.loon.overrides.policyBindings);
});

test('each service has a locked base, an applied patch set and both generated formats', () => {
  const model = loadTargetModel(ROOT);
  const catalog = readJson(join(ROOT, 'rules/catalog.json'));
  assert.deepEqual(catalog.services.map((service) => service.id), model.services.map((service) => service.serviceId));
  for (const service of model.services) {
    const finalEntries = materializeEntries(service);
    assert.match(service.upstreamLock.entriesHash, /^[a-f0-9]{64}$/);
    assert.equal(service.upstreamLock.entriesHash, sha256(canonical(service.entries.entries)));
    assert.equal(finalEntries.length, service.serviceId === 'hong-kong-banks' ? 4 : 5);
    assert.equal(finalEntries.some((entry) => entry.id === 'hk-bank-citibank'), false);
    const clash = readFileSync(join(ROOT, `rules/${service.serviceId}/Clash.yaml`), 'utf8');
    const loon = readFileSync(join(ROOT, `rules/${service.serviceId}/Loon.lsr`), 'utf8');
    assert.match(clash, /DOMAIN-SUFFIX,/);
    assert.match(loon, /DOMAIN-SUFFIX,/);
    const catalogService = catalog.services.find((item) => item.id === service.serviceId);
    assert.equal(catalogService.baseEntryCount, service.entries.entries.length);
    assert.equal(catalogService.finalEntryCount, finalEntries.length);
    assert.deepEqual(catalogService.clientsSupported, ['clash', 'loon']);
    assert.deepEqual(catalogService.clientsDisabled, ['quantumult-x']);
    assert.deepEqual(catalogService.clientsUnsupported, []);
    assert.match(catalogService.sources[0].license, /Internal-authored/);
    assert.equal(catalogService.format, 'domain-suffix');
    assert.match(catalogService.behavior, /policy group/);
    assert.equal(catalogService.clients.clash.enabled, true);
    assert.equal(catalogService.clients.loon.enabled, true);
  }
  assert.match(readFileSync(join(ROOT, 'rules/hong-kong-banks/Clash.yaml'), 'utf8'), /hsbcnet\.com/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'rules/hong-kong-banks/Clash.yaml'), 'utf8'), /citibank/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'rules/ai-messaging-speed-test/Clash.yaml'), 'utf8'), /hsbc\.com\.hk/);
});

test('R1 and R2 are importable release snapshots and R1 remains byte-stable', () => {
  const validation = validateTargetTree({ root: ROOT });
  assert.deepEqual(validation.releases, ['r1', 'r2']);
  const r1Root = join(ROOT, 'releases/r1');
  const r2Root = join(ROOT, 'releases/r2');
  const r1Manifest = readJson(join(r1Root, 'manifest.json'));
  const r2Manifest = readJson(join(r2Root, 'manifest.json'));
  assert.notEqual(r1Manifest.sourceHash, r2Manifest.sourceHash);
  assert.notEqual(r1Manifest.manifestHash, r2Manifest.manifestHash);
  const r1 = loadTargetModel(r1Root);
  const r2 = loadTargetModel(r2Root);
  const importRoot = mkdtempSync(join(tmpdir(), 'proxy-target-tree-'));
  try {
    cpSync(join(r1Root, 'source'), join(importRoot, 'source'), { recursive: true });
    const importedR1 = loadTargetModel(importRoot);
    assert.deepEqual(importedR1.clients.clash.order, r1.clients.clash.order);
    assert.deepEqual(importedR1.clients.loon.overrides, r1.clients.loon.overrides);
  } finally {
    rmSync(importRoot, { recursive: true, force: true });
  }
  assert.deepEqual(r1.clients.clash.order.groupOrder, ['group-global-tools', 'group-hk-finance', 'group-auto', 'builtin-direct']);
  assert.deepEqual(r2.clients.clash.order.groupOrder, ['group-global-tools', 'group-auto', 'group-hk-finance', 'builtin-direct']);
  assert.deepEqual(r1.clients.clash.overrides.tagOverrides['rule-ai-messaging-speed-test'], ['ai', 'optional-clash']);
  assert.deepEqual(r2.clients.clash.overrides.tagOverrides['rule-ai-messaging-speed-test'], ['ai', 'preferred-clash']);
  for (const file of r1Manifest.files) {
    const content = readFileSync(join(r1Root, file.path));
    assert.equal(content.length, file.bytes, `R1 byte count changed: ${file.path}`);
    assert.equal(sha256(content), file.sha256, `R1 bytes changed: ${file.path}`);
  }
  for (const releaseId of ['r1', 'r2']) {
    for (const path of filesUnder(join(ROOT, 'releases', releaseId))) {
      assert.ok(statSync(join(ROOT, 'releases', releaseId, path)).size > 0, `${releaseId}/${path} is empty`);
    }
  }
});

test('generated outputs follow client order and contain no private node material', () => {
  const r1Clash = readFileSync(join(ROOT, 'releases/r1/configs/clash/config.yaml'), 'utf8');
  const r1Loon = readFileSync(join(ROOT, 'releases/r1/configs/loon/profile.lcf'), 'utf8');
  assert.ok(r1Clash.indexOf('RULE-SET,ai-messaging-speed-test') < r1Clash.indexOf('RULE-SET,hong-kong-banks'));
  assert.ok(r1Loon.indexOf('RULE-SET,hong-kong-banks') < r1Loon.indexOf('RULE-SET,ai-messaging-speed-test'));
  assert.match(r1Clash.trim(), /- MATCH,DIRECT$/);
  assert.match(r1Loon.trim(), /FINAL,DIRECT$/);
  assert.equal(existsSync(join(ROOT, 'rules/ai-messaging-speed-test/QuantumultX.list')), false);
  const forbidden = /(?:vmess|vless|trojan|ss:\/\/|(?:https?|socks5):\/\/[^\s]*@|(?:password|token|secret|api[_-]?key)\s*[:=])/i;
  for (const releaseId of ['r1', 'r2']) {
    for (const area of ['configs', 'rules', 'assets']) {
      for (const path of filesUnder(join(ROOT, 'releases', releaseId, area))) {
        const content = readFileSync(join(ROOT, 'releases', releaseId, area, path), 'utf8');
        assert.doesNotMatch(content, forbidden, `${releaseId}/${area}/${path} contains private material`);
      }
    }
  }
});
