import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_TREE_VERSION = 'target-tree-0.1.0';
export const TARGET_RELEASES = ['r1', 'r2'];
export const DEFAULT_CREATED_AT = '2026-09-13T00:00:00.000Z';

const CLIENTS = ['clash', 'loon'];
const SOURCE_CLIENT_PATHS = {
  clash: 'source/clients/clash',
  loon: 'source/clients/loon',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashEntries(entries) {
  return sha256(canonical(entries));
}

function safePath(value) {
  const path = String(value || '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) {
    throw new Error(`unsafe path: ${path}`);
  }
  return path;
}

function readJson(root, path) {
  const safe = safePath(path);
  return JSON.parse(readFileSync(join(root, safe), 'utf8'));
}

function writeJson(root, path, value) {
  const safe = safePath(path);
  const output = join(root, safe);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
}

function walkFiles(root, prefix = '') {
  if (!existsSync(root)) return [];
  const names = readdirSync(root).sort();
  const files = [];
  for (const name of names) {
    const full = join(root, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walkFiles(full, relativePath));
    else if (stat.isFile()) files.push(relativePath);
  }
  return files;
}

function copyTree(source, destination) {
  for (const path of walkFiles(source)) {
    const output = join(destination, path);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(join(source, path), output);
  }
}

function fileInventory(root, paths) {
  return paths.sort().map((path) => {
    const content = readFileSync(join(root, path));
    return { path, sha256: sha256(content), bytes: content.length };
  });
}

function inventoryHash(files) {
  return sha256(files.map((file) => `${file.path}\0${file.sha256}\0${file.bytes}`).join('\n'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(values, label) {
  assert(new Set(values).size === values.length, `${label} contains duplicate IDs`);
}

function loadServices(root) {
  const rulesetsRoot = join(root, 'source/rulesets');
  const serviceIds = readdirSync(rulesetsRoot).filter((name) => statSync(join(rulesetsRoot, name)).isDirectory()).sort();
  return serviceIds.map((serviceId) => ({
    serviceId,
    definition: readJson(root, `source/rulesets/${serviceId}/definition.json`),
    entries: readJson(root, `source/rulesets/${serviceId}/entries.json`),
    patches: readJson(root, `source/rulesets/${serviceId}/patches.json`),
    upstreamLock: readJson(root, `source/rulesets/${serviceId}/upstream-lock.json`),
  }));
}

function loadSourceModel(root) {
  const common = {
    groups: readJson(root, 'source/common/groups.json'),
    rules: readJson(root, 'source/common/rules.json'),
    settings: readJson(root, 'source/common/settings.json'),
    order: readJson(root, 'source/common/order.json'),
  };
  const clients = Object.fromEntries(CLIENTS.map((client) => [client, {
    order: readJson(root, `${SOURCE_CLIENT_PATHS[client]}/order.json`),
    overrides: readJson(root, `${SOURCE_CLIENT_PATHS[client]}/overrides.json`),
  }]));
  const services = loadServices(root);
  return { common, clients, services };
}

export function materializeEntries(service) {
  const entries = service.entries.entries.map((entry) => ({ ...entry, presentIn: [...entry.presentIn] }));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const patch of service.patches.patches) {
    if (patch.op === 'add') {
      assert(!byId.has(patch.entry.id), `${service.serviceId}: add patch duplicates ${patch.entry.id}`);
      byId.set(patch.entry.id, { ...patch.entry, presentIn: [...patch.entry.presentIn] });
    } else if (patch.op === 'delete') {
      assert(byId.has(patch.entryId), `${service.serviceId}: delete patch misses ${patch.entryId}`);
      byId.delete(patch.entryId);
    } else if (patch.op === 'replace') {
      const old = byId.get(patch.entryId);
      assert(old, `${service.serviceId}: replace patch misses ${patch.entryId}`);
      if (patch.expectedValue) assert(old.value === patch.expectedValue, `${service.serviceId}: replace precondition failed for ${patch.entryId}`);
      assert(patch.entry.id === patch.entryId, `${service.serviceId}: replace changes stable entry ID`);
      byId.set(patch.entryId, { ...patch.entry, presentIn: [...patch.entry.presentIn] });
    } else {
      throw new Error(`${service.serviceId}: unsupported patch operation ${patch.op}`);
    }
  }
  return [...byId.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function validateSourceModel(model) {
  const { common, clients, services } = model;
  assert(services.length >= 2, 'target tree requires at least two services');
  assert(CLIENTS.every((client) => clients[client]), 'target tree requires clash and loon client sources');
  const groups = common.groups.groups;
  const rules = common.rules.rules;
  unique(groups.map((group) => group.id), 'common groups');
  unique(rules.map((rule) => rule.id), 'common rules');
  const groupIds = new Set(groups.map((group) => group.id));
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const serviceIds = new Set(services.map((service) => service.serviceId));
  assert(groups.length >= 4, 'common groups must include policy, automatic and direct groups');
  assert(rules.at(-1)?.id === 'rule-final', 'common rules must end with rule-final');
  for (const group of groups) {
    assert(CLIENTS.every((client) => group.presentIn.includes(client)), `${group.id} is not present in both clients`);
    for (const member of group.members) assert(groupIds.has(member), `${group.id} refers to missing group ${member}`);
  }
  for (const rule of rules) {
    assert(CLIENTS.every((client) => rule.presentIn.includes(client)), `${rule.id} is not present in both clients`);
    assert(groupIds.has(rule.policyGroupId), `${rule.id} refers to missing policy group`);
    if (rule.kind === 'ruleset-ref') assert(serviceIds.has(rule.rulesetId), `${rule.id} refers to missing service`);
  }
  assert(common.order.ruleSequence.at(-1) === 'rule-final', 'common rule sequence must keep fallback last');
  for (const client of CLIENTS) {
    const { order, overrides } = clients[client];
    assert(order.client === client, `${client} order has wrong client ID`);
    assert(overrides.client === client, `${client} overrides has wrong client ID`);
    unique(order.ruleSequence, `${client} ruleSequence`);
    unique(order.groupOrder, `${client} groupOrder`);
    assert(order.ruleSequence.at(-1) === 'rule-final', `${client} rule sequence must keep fallback last`);
    assert(order.ruleSequence.length === rules.length && order.ruleSequence.every((id) => ruleIds.has(id)), `${client} rule sequence does not cover common rules`);
    assert(order.groupOrder.length === groups.length && order.groupOrder.every((id) => groupIds.has(id)), `${client} group order does not cover common groups`);
    for (const group of groups.filter((item) => item.members.length > 0)) {
      const members = order.memberOrder[group.id];
      assert(Array.isArray(members), `${client} member order misses ${group.id}`);
      unique(members, `${client} memberOrder.${group.id}`);
      assert(members.length === group.members.length && members.every((id) => group.members.includes(id)), `${client} member order is not a permutation for ${group.id}`);
    }
    for (const [ruleId, tags] of Object.entries(overrides.tagOverrides)) {
      assert(ruleIds.has(ruleId), `${client} tag override refers to missing rule ${ruleId}`);
      assert(Array.isArray(tags) && tags.length > 0, `${client} tag override is empty for ${ruleId}`);
    }
    for (const [ruleId, groupId] of Object.entries(overrides.policyBindings)) {
      assert(ruleIds.has(ruleId), `${client} binding refers to missing rule ${ruleId}`);
      assert(groupIds.has(groupId), `${client} binding refers to missing group ${groupId}`);
    }
  }
  assert(JSON.stringify(clients.clash.order.ruleSequence) !== JSON.stringify(clients.loon.order.ruleSequence), 'clash and loon rule sequences must differ');
  assert(JSON.stringify(clients.clash.order.groupOrder) !== JSON.stringify(clients.loon.order.groupOrder), 'clash and loon group orders must differ');
  assert(JSON.stringify(clients.clash.order.memberOrder) !== JSON.stringify(clients.loon.order.memberOrder), 'clash and loon member orders must differ');
  assert(JSON.stringify(clients.clash.overrides.tagOverrides) !== JSON.stringify(clients.loon.overrides.tagOverrides), 'clash and loon tag overrides must differ');
  for (const service of services) {
    assert(service.definition.serviceId === service.serviceId, `${service.serviceId}: definition ID mismatch`);
    assert(service.entries.serviceId === service.serviceId, `${service.serviceId}: entries ID mismatch`);
    assert(service.patches.serviceId === service.serviceId, `${service.serviceId}: patches ID mismatch`);
    assert(service.upstreamLock.serviceId === service.serviceId, `${service.serviceId}: upstream lock ID mismatch`);
    assert(service.definition.supportedClients.length === CLIENTS.length && CLIENTS.every((client) => service.definition.supportedClients.includes(client)), `${service.serviceId}: supported client mismatch`);
    unique(service.entries.entries.map((entry) => entry.id), `${service.serviceId} base entries`);
    const baseHash = hashEntries(service.entries.entries);
    assert(service.upstreamLock.algorithm === 'sha256', `${service.serviceId}: unsupported upstream hash algorithm`);
    assert(/^[a-f0-9]{64}$/.test(service.upstreamLock.entriesHash), `${service.serviceId}: upstream lock hash is missing`);
    assert(service.upstreamLock.entriesHash === baseHash, `${service.serviceId}: upstream lock hash does not match base entries`);
    const finalEntries = materializeEntries(service);
    unique(finalEntries.map((entry) => entry.id), `${service.serviceId} final entries`);
    for (const entry of finalEntries) {
      assert(entry.policyGroupId === rules.find((rule) => rule.rulesetId === service.serviceId)?.policyGroupId, `${service.serviceId}: entry policy binding mismatch`);
      assert(CLIENTS.every((client) => entry.presentIn.includes(client)), `${service.serviceId}: entry is not present in both clients`);
    }
  }
  return model;
}

function buildSourceManifest(root, model) {
  const paths = walkFiles(join(root, 'source')).filter((path) => path !== 'manifest.json').map((path) => `source/${path}`);
  const files = fileInventory(root, paths);
  const base = {
    manifestVersion: 1,
    sourceSchemaVersion: 1,
    sourceModelVersion: 1,
    generatorVersion: TARGET_TREE_VERSION,
    enabledTargets: CLIENTS,
    serviceIds: model.services.map((service) => service.serviceId),
    files,
    sourceHash: inventoryHash(files),
    bindings: {
      common: 'source/common',
      clients: Object.fromEntries(CLIENTS.map((client) => [client, SOURCE_CLIENT_PATHS[client]])),
      rulesets: 'source/rulesets',
    },
  };
  return { ...base, manifestHash: sha256(canonical(base)) };
}

function ruleForService(model, serviceId) {
  return model.common.rules.rules.find((rule) => rule.rulesetId === serviceId);
}

function renderClash(model, client, serviceId) {
  const rule = ruleForService(model, serviceId);
  const lines = ['# Generated by RelayDeck Proxy target-tree', 'payload:'];
  const service = model.services.find((item) => item.serviceId === serviceId);
  const tags = model.clients[client].overrides.tagOverrides[rule.id] || rule.tags;
  lines.push(`  # tags: ${tags.join(',')}`);
  for (const entry of materializeEntries(service).filter((item) => item.presentIn.includes(client))) {
    lines.push(`  - DOMAIN-SUFFIX,${entry.value},${model.clients[client].overrides.policyBindings[rule.id] || entry.policyGroupId}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderLoon(model, client, serviceId) {
  const rule = ruleForService(model, serviceId);
  const lines = ['# Generated by RelayDeck Proxy target-tree'];
  const service = model.services.find((item) => item.serviceId === serviceId);
  const tags = model.clients[client].overrides.tagOverrides[rule.id] || rule.tags;
  lines.push(`# tags: ${tags.join(',')}`);
  for (const entry of materializeEntries(service).filter((item) => item.presentIn.includes(client))) {
    lines.push(`DOMAIN-SUFFIX,${entry.value},${model.clients[client].overrides.policyBindings[rule.id] || entry.policyGroupId}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderRules(model, root) {
  for (const service of model.services) {
    const rule = ruleForService(model, service.serviceId);
    assert(rule, `${service.serviceId}: no common rule binding`);
    const clashPath = join(root, `rules/${service.serviceId}/Clash.yaml`);
    const loonPath = join(root, `rules/${service.serviceId}/Loon.lsr`);
    mkdirSync(dirname(clashPath), { recursive: true });
    writeFileSync(clashPath, renderClash(model, 'clash', service.serviceId));
    writeFileSync(loonPath, renderLoon(model, 'loon', service.serviceId));
  }
}

function renderConfigs(model, releaseRoot) {
  const configLines = [
    '# Generated no-node public configuration. Private providers are bound by RelayDeck at runtime.',
    'mode: rule',
    'proxy-groups:',
  ];
  for (const group of model.clients.clash.order.groupOrder) {
    const definition = model.common.groups.groups.find((item) => item.id === group);
    if (definition.type === 'builtin') continue;
    const members = model.clients.clash.order.memberOrder[group] || definition.members;
    const outputMembers = members.map((member) => member === 'builtin-direct' ? 'DIRECT' : member);
    configLines.push(`  - name: ${group}`, `    type: ${definition.type}`, `    proxies: [${outputMembers.map((member) => `"${member}"`).join(', ')}]`);
  }
  configLines.push('rules:');
  for (const ruleId of model.clients.clash.order.ruleSequence) {
    const rule = model.common.rules.rules.find((item) => item.id === ruleId);
    if (rule.kind === 'builtin') configLines.push('  - MATCH,DIRECT');
    else configLines.push(`  - RULE-SET,${rule.rulesetId},${model.clients.clash.overrides.policyBindings[rule.id]}`);
  }
  const clashConfigPath = join(releaseRoot, 'configs/clash/config.yaml');
  mkdirSync(dirname(clashConfigPath), { recursive: true });
  writeFileSync(clashConfigPath, `${configLines.join('\n')}\n`);

  const loonLines = [
    '# Generated no-node public configuration. Private providers are bound by RelayDeck at runtime.',
    '[General]',
    'bypass-system = true',
    '',
    '[Proxy Group]',
  ];
  for (const group of model.clients.loon.order.groupOrder) {
    const definition = model.common.groups.groups.find((item) => item.id === group);
    if (definition.type === 'builtin') continue;
    const members = model.clients.loon.order.memberOrder[group] || definition.members;
    loonLines.push(`${group} = ${definition.type},${members.map((member) => member === 'builtin-direct' ? 'DIRECT' : member).join(',')}`);
  }
  loonLines.push('', '[Rule]');
  for (const ruleId of model.clients.loon.order.ruleSequence) {
    const rule = model.common.rules.rules.find((item) => item.id === ruleId);
    if (rule.kind === 'builtin') loonLines.push('FINAL,DIRECT');
    else loonLines.push(`RULE-SET,${rule.rulesetId},${model.clients.loon.overrides.policyBindings[rule.id]}`);
  }
  const loonConfigPath = join(releaseRoot, 'configs/loon/profile.lcf');
  mkdirSync(dirname(loonConfigPath), { recursive: true });
  writeFileSync(loonConfigPath, `${loonLines.join('\n')}\n`);
}

function renderAssetCatalog(root) {
  const path = 'assets/common/icons/public-routing-groups.svg';
  const content = readFileSync(join(root, path));
  writeJson(root, 'assets/catalog.json', {
    schemaVersion: 1,
    assets: [{
      id: 'icon.public-routing-groups',
      type: 'icon',
      client: 'shared',
      path,
      format: 'svg',
      public: true,
      sha256: sha256(content),
      status: 'active',
    }],
  });
}

function renderRuleCatalog(model, root) {
  const services = model.services.map((service) => {
    const baseEntries = service.entries.entries;
    const finalEntries = materializeEntries(service);
    const clients = Object.fromEntries(CLIENTS.map((client) => {
      const path = `rules/${service.serviceId}/${client === 'clash' ? 'Clash.yaml' : 'Loon.lsr'}`;
      const content = readFileSync(join(root, path));
      return [client, {
        enabled: true,
        format: client === 'clash' ? 'clash-yaml-payload' : 'loon-lsr',
        path,
        sha256: sha256(content),
        entryCount: finalEntries.filter((entry) => entry.presentIn.includes(client)).length,
      }];
    }));
    return {
      id: service.serviceId,
      displayName: service.definition.displayName,
      category: service.definition.category,
      description: service.definition.description,
      sources: [{ url: service.upstreamLock.sourceUrl, selector: service.upstreamLock.sourceSelector, lockedAt: service.upstreamLock.lockedAt, entriesHash: service.upstreamLock.entriesHash, license: service.definition.license }],
      clientsSupported: service.definition.supportedClients,
      clientsDisabled: ['quantumult-x'],
      clientsUnsupported: [],
      format: service.definition.format,
      behavior: service.definition.behavior,
      clients,
      baseEntryCount: baseEntries.length,
      finalEntryCount: finalEntries.length,
      patchCount: service.patches.patches.length,
    };
  });
  writeJson(root, 'rules/catalog.json', {
    schemaVersion: 1,
    generatedBy: TARGET_TREE_VERSION,
    enabledTargets: CLIENTS,
    services,
  });
}

function buildReleaseManifest(root, releaseId, sourceManifest, model, releaseRoot) {
  const paths = walkFiles(releaseRoot).filter((path) => path !== 'manifest.json').filter((path) => /^(source|configs|rules|assets)\//.test(path));
  const files = fileInventory(releaseRoot, paths);
  const base = {
    manifestVersion: 1,
    releaseId,
    version: releaseId,
    generatorVersion: TARGET_TREE_VERSION,
    createdAt: DEFAULT_CREATED_AT,
    sourceHash: sourceManifest.sourceHash,
    sourceManifestHash: sha256(readFileSync(join(releaseRoot, 'source/manifest.json'))),
    enabledTargets: CLIENTS,
    services: model.services.map((service) => service.serviceId),
    files,
    bindings: {
      sourceManifest: 'source/manifest.json',
      rulesCatalog: 'rules/catalog.json',
      configs: { clash: 'configs/clash/config.yaml', loon: 'configs/loon/profile.lcf' },
    },
    dependencies: model.services.map((service) => ({
      serviceId: service.serviceId,
      upstreamLock: `source/rulesets/${service.serviceId}/upstream-lock.json`,
      entriesHash: service.upstreamLock.entriesHash,
      sourceUrl: service.upstreamLock.sourceUrl,
      selector: service.upstreamLock.sourceSelector,
    })),
  };
  return { ...base, manifestHash: sha256(canonical(base)) };
}

export function buildTargetRelease({ root = ROOT, releaseId = 'r2' } = {}) {
  assert(/^r[0-9]+$/.test(releaseId), 'target release ID must look like r1 or r2');
  const model = validateSourceModel(loadSourceModel(root));
  const sourceManifest = buildSourceManifest(root, model);
  writeJson(root, 'source/manifest.json', sourceManifest);
  renderRules(model, root);
  renderAssetCatalog(root);
  renderRuleCatalog(model, root);
  const releaseRoot = join(root, 'releases', releaseId);
  rmSync(releaseRoot, { recursive: true, force: true });
  copyTree(join(root, 'source'), join(releaseRoot, 'source'));
  copyTree(join(root, 'rules'), join(releaseRoot, 'rules'));
  copyTree(join(root, 'assets'), join(releaseRoot, 'assets'));
  renderConfigs(model, releaseRoot);
  const manifest = buildReleaseManifest(root, releaseId, sourceManifest, model, releaseRoot);
  writeJson(releaseRoot, 'manifest.json', manifest);
  return { releaseId, sourceHash: sourceManifest.sourceHash, manifestHash: manifest.manifestHash, fileCount: manifest.files.length, services: model.services.map((service) => service.serviceId) };
}

export function loadTargetModel(root = ROOT) {
  return validateSourceModel(loadSourceModel(root));
}

function validateRelease(root, releaseId) {
  const releaseRoot = join(root, 'releases', releaseId);
  const manifest = readJson(releaseRoot, 'manifest.json');
  assert(manifest.releaseId === releaseId && manifest.version === releaseId, `${releaseId}: manifest identity mismatch`);
  const actualPaths = walkFiles(releaseRoot).filter((path) => path !== 'manifest.json').filter((path) => /^(source|configs|rules|assets)\//.test(path));
  const actual = new Map(fileInventory(releaseRoot, actualPaths).map((file) => [file.path, file]));
  assert(manifest.files.length === actual.size, `${releaseId}: manifest file count mismatch`);
  for (const file of manifest.files) {
    safePath(file.path);
    const observed = actual.get(file.path);
    assert(observed, `${releaseId}: manifest points to missing ${file.path}`);
    assert(observed.sha256 === file.sha256 && observed.bytes === file.bytes, `${releaseId}: hash mismatch for ${file.path}`);
    actual.delete(file.path);
  }
  assert(actual.size === 0, `${releaseId}: unregistered release files exist`);
  const sourceManifest = readJson(releaseRoot, 'source/manifest.json');
  assert(sourceManifest.sourceHash === manifest.sourceHash, `${releaseId}: source hash binding mismatch`);
  assert(sha256(readFileSync(join(releaseRoot, 'source/manifest.json'))) === manifest.sourceManifestHash, `${releaseId}: source manifest hash mismatch`);
  for (const required of ['configs/clash/config.yaml', 'configs/loon/profile.lcf', 'rules/catalog.json', 'assets/common/icons/public-routing-groups.svg']) {
    assert(existsSync(join(releaseRoot, required)), `${releaseId}: missing required ${required}`);
  }
  return manifest;
}

export function validateTargetTree({ root = ROOT, releases = TARGET_RELEASES } = {}) {
  const model = validateSourceModel(loadSourceModel(root));
  const sourceManifest = readJson(root, 'source/manifest.json');
  assert(sourceManifest.generatorVersion === TARGET_TREE_VERSION, 'source manifest generator version mismatch');
  for (const releaseId of releases) validateRelease(root, releaseId);
  return { sourceHash: sourceManifest.sourceHash, services: model.services.map((service) => service.serviceId), releases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const validate = process.argv.includes('--validate');
  const releaseIndex = process.argv.indexOf('--release');
  const releaseId = releaseIndex >= 0 ? process.argv[releaseIndex + 1] : 'r2';
  const result = validate ? validateTargetTree() : buildTargetRelease({ releaseId });
  console.log(JSON.stringify(result, null, 2));
}
