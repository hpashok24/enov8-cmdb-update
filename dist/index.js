const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');

// Set once per run from insecure_skip_tls_verify and applied to every request.
let tlsOptions = {};

function getInput(name, required = false) {
  const v = process.env[`INPUT_${name.toUpperCase()}`] || '';

  if (required && !v.trim()) {
    throw new Error(`Missing input: ${name}`);
  }

  return v.trim();
}

// Enov8 only accepts the strings "True"/"False" — also accept JSON booleans and any-case strings.
function normalizeBool(value, defaultValue, fieldName) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  const s = String(value).trim().toLowerCase();

  if (s === 'true') return 'True';
  if (s === 'false') return 'False';

  throw new Error(`metadata.${fieldName} must be true or false, got: ${JSON.stringify(value)}`);
}

// Parses metadata and trims leading/trailing whitespace from every key and string value.
function parseMetadata(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid metadata JSON: ${e.message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadata must be a JSON object, e.g. {"System": "GDW"}');
  }

  const out = {};

  for (const [k, v] of Object.entries(parsed)) {
    out[k.trim()] = typeof v === 'string' ? v.trim() : v;
  }

  return out;
}

function request(method, urlStr, payload, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttp = url.protocol === 'http:';

    const options = {
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : (isHttp ? 80 : 443),
      path: url.pathname + url.search,
      headers,
      ...(isHttp ? {} : tlsOptions)
    };

    const req = (isHttp ? http : https).request(options, (res) => {
      let data = '';

      res.on('data', (d) => data += d);

      res.on('end', () => {
        let parsed;

        try {
          parsed = JSON.parse(data);
        } catch {}

        resolve({
          status: res.statusCode,
          body: data,
          parsed
        });
      });
    });

    req.on('error', reject);

    if (payload !== undefined) {
      req.write(payload, 'utf8');
    }

    req.end();
  });
}

// ✅ Name -> ECO ID lookup by endpoint, returns null (not throw) when nothing matches
async function tryResolveByName(baseUrl, headers, endpoint, nameField, name) {
  const url = `${baseUrl}/api/${endpoint}?${encodeURIComponent(nameField)}=${encodeURIComponent(name)}`;
  const res = await request('GET', url, undefined, headers);

  const records = Array.isArray(res.parsed) ? res.parsed : (res.parsed ? [res.parsed] : []);
  const match = records.find(r => r[nameField] === name) || records[0];

  return (match && match['System ID']) || null;
}

async function resolveByName(baseUrl, headers, endpoint, nameField, name) {
  const id = await tryResolveByName(baseUrl, headers, endpoint, nameField, name);

  if (!id) {
    throw new Error(`Could not resolve "${name}" via ${endpoint} lookup`);
  }

  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Governed updates: identity, user validation and System access
// ─────────────────────────────────────────────────────────────────────────────

// ✅ The GitHub username must equal the Enov8 User ID.
// Fixed in code on purpose: it is NOT a workflow input, so a workflow author cannot change how identity is mapped.
const GITHUB_USERNAME_FIELD = 'User ID';

function sameText(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function toRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && !(parsed.success === false)) return [parsed];
  return [];
}

// "A;B;C" -> ["A","B","C"]
function splitList(value) {
  return String(value ?? '').split(';').map(s => s.trim()).filter(Boolean);
}

// ✅ Exact-match lookup: the full record whose field equals value, or null. Never "the first record".
async function findRecord(baseUrl, headers, endpoint, field, value) {
  if (!value) return null;

  const url = `${baseUrl}/api/${endpoint}?${encodeURIComponent(field)}=${encodeURIComponent(value)}`;
  const res = await request('GET', url, undefined, headers);

  return toRecords(res.parsed).find(r => sameText(r[field], value)) || null;
}

// ✅ Identity comes from GitHub, never from the workflow file.
// GITHUB_TRIGGERING_ACTOR / GITHUB_ACTOR are set by the GitHub runner and cannot be overwritten by a workflow.
function getGitHubActor() {
  const actor = (process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR || '').trim();

  if (!actor) {
    throw new Error('❌ Could not determine the GitHub user who triggered this run (GITHUB_TRIGGERING_ACTOR / GITHUB_ACTOR not set) — request rejected');
  }

  if (/\[bot\]$/i.test(actor)) {
    throw new Error(`❌ This run was triggered by a bot account ("${actor}"). Governed updates must be triggered by a person mapped to an Enov8 user — request rejected`);
  }

  return actor;
}

// ✅ Map the GitHub user to an Enov8 user, then check that user is active
async function resolveEnov8User(baseUrl, headers, githubUser) {
  console.log(`🔐 GitHub user "${githubUser}" — looking up the mapped Enov8 user (${GITHUB_USERNAME_FIELD})`);

  const url = `${baseUrl}/api/User?${encodeURIComponent(GITHUB_USERNAME_FIELD)}=${encodeURIComponent(githubUser)}`;
  const res = await request('GET', url, undefined, headers);

  // GitHub usernames are case-insensitive
  let matches = toRecords(res.parsed).filter(r => sameText(r[GITHUB_USERNAME_FIELD], githubUser));

  // Enov8's filter may be case-sensitive — fall back to a case-insensitive match across all users
  if (matches.length === 0) {
    const all = await request('GET', `${baseUrl}/api/User`, undefined, headers);
    matches = toRecords(all.parsed).filter(r => sameText(r[GITHUB_USERNAME_FIELD], githubUser));
  }

  if (matches.length === 0) {
    throw new Error(`❌ GitHub user "${githubUser}" is not mapped to any Enov8 user (no user has ${GITHUB_USERNAME_FIELD} = "${githubUser}") — request rejected`);
  }

  if (matches.length > 1) {
    throw new Error(`❌ GitHub user "${githubUser}" is mapped to more than one Enov8 user (${matches.map(m => m['User ID']).join(', ')}) — request rejected until the mapping is fixed`);
  }

  const user = matches[0];
  const userId = user['User ID'];

  if (!userId) {
    throw new Error(`❌ The Enov8 user mapped to GitHub user "${githubUser}" has no User ID — request rejected`);
  }

  // Enov8 stores e.g. "ActiveUser" / "InactiveUser"
  const status = user['User Status'] ?? user['Status'];

  if (status && !/^active/i.test(String(status).trim())) {
    throw new Error(`❌ Enov8 user "${userId}" (GitHub "${githubUser}") is not active (User Status: ${status}) — request rejected`);
  }

  // "Login Access" must be "Yes" (otherwise awaiting approval or rejected)
  const loginAccess = user['Login Access'];

  if (loginAccess !== undefined && loginAccess !== null && loginAccess !== '' && !sameText(loginAccess, 'Yes')) {
    throw new Error(`❌ Enov8 user "${userId}" (GitHub "${githubUser}") does not have login access (Login Access: ${loginAccess}) — request rejected`);
  }

  console.log(`✅ GitHub user "${githubUser}" → Enov8 user "${userId}"${status ? ` (User Status: ${status})` : ''}`);

  return userId;
}

// ✅ Find a System: by Resource ID (APM ID) first, then by ECO ID or name — exact matches only
async function findSystem(baseUrl, headers, { systemRef, resourceId }) {
  if (resourceId) {
    const byResourceId = await findRecord(baseUrl, headers, 'System', 'Resource ID', resourceId);

    if (byResourceId) {
      console.log(`🔎 System found by Resource ID "${resourceId}": "${byResourceId['Resource Name']}"`);
      return byResourceId;
    }
  }

  if (!systemRef) return null;

  if (/^ECO-\d+$/i.test(systemRef)) {
    const byId = await findRecord(baseUrl, headers, 'System', 'System ID', systemRef);
    if (byId) return byId;
  }

  return findRecord(baseUrl, headers, 'System', 'Resource Name', systemRef);
}

// "AD0004 - Ashley Hosking" -> "AD0004"
function groupUserIds(groupUsers) {
  return splitList(groupUsers).map(entry => entry.split(' - ')[0].trim());
}

// ✅ The user has access when they are a member of (one of) the System's "Assigned To" group(s)
async function validateSystemAccess(baseUrl, headers, userId, system) {
  const systemName = system['Resource Name'];
  const assignedGroups = splitList(system['Assigned To']);

  console.log(`🔐 Checking access of "${userId}" to System "${systemName}" (Assigned To: ${assignedGroups.join(', ') || 'none'})`);

  if (assignedGroups.length === 0) {
    throw new Error(`❌ System "${systemName}" has no Assigned To group — user "${userId}" cannot be granted access`);
  }

  for (const groupName of assignedGroups) {
    const group = await findRecord(baseUrl, headers, 'Group', 'Contact Name', groupName);

    if (!group) {
      console.log(`⚠️ Assigned To group "${groupName}" not found — skipping`);
      continue;
    }

    if (group['Status'] && !sameText(group['Status'], 'Active')) {
      console.log(`⚠️ Group "${groupName}" is ${group['Status']} — skipping`);
      continue;
    }

    if (groupUserIds(group['Group Users']).some(id => sameText(id, userId))) {
      console.log(`✅ User "${userId}" is a member of "${groupName}" — access granted to System "${systemName}"`);
      return;
    }
  }

  throw new Error(`❌ User "${userId}" does not have access to System "${systemName}" (not a member of its Assigned To group: ${assignedGroups.join(', ')}) — request rejected`);
}

// ✅ Works out which System a System Instance / MicroService request touches, before anything is written.
async function resolveAssociatedSystem(baseUrl, headers, { resourceType, resourceName, systemInstance, metadata }) {
  const instanceName = resourceType === 'MicroService' ? systemInstance : resourceName;
  const instance = await findRecord(baseUrl, headers, 'SystemInstance', 'Resource Name', instanceName);

  if (instance) {
    // Update, or MicroService create on an existing instance — use the instance's own System
    const system = await findSystem(baseUrl, headers, { systemRef: instance['System'] });

    if (!system) {
      throw new Error(`❌ Could not find the System linked to System Instance "${instanceName}" (${instance['System'] || 'none'}) — cannot validate access`);
    }

    return { system };
  }

  // Instance does not exist yet — it will be created from metadata
  const system = await findSystem(baseUrl, headers, {
    systemRef: metadata['System'],
    resourceId: metadata['Resource ID']
  });

  if (system) {
    return { system };
  }

  return {
    system: null,
    reason: (metadata['System'] || metadata['Resource ID'])
      ? `System "${metadata['System'] || metadata['Resource ID']}" does not exist yet and will be created by this run`
      : 'no System is linked to this request'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// System ↔ System links (Upstream / Downstream)
// ─────────────────────────────────────────────────────────────────────────────

// ✅ Validates every Upstream / Downstream entry and resolves each Resource ID to a System ID.
// Runs BEFORE any write, so a bad entry never leaves a half-finished set of links.
// Upstream   X → SOURCE = main System, TARGET = X
// Downstream X → SOURCE = X,           TARGET = main System
async function planSystemLinks(baseUrl, headers, metadata, mainSystemId) {
  const plan = [];

  for (const direction of ['Upstream', 'Downstream']) {
    const entries = metadata[direction];

    if (entries === undefined || entries === null) continue;

    if (!Array.isArray(entries)) {
      throw new Error(`❌ metadata.${direction} must be a list, e.g. [{"Resource ID": "APM-1001", "ConnectionTechnology": "ESB"}]`);
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] || {};
      const label = `${direction}[${i}]`;
      const resourceId = String(entry['Resource ID'] ?? '').trim();
      const connectionType = String(entry['ConnectionTechnology'] ?? '').trim();

      if (!resourceId) {
        throw new Error(`❌ ${label}: "Resource ID" is required — request rejected`);
      }

      if (!connectionType) {
        throw new Error(`❌ ${label} (${resourceId}): "ConnectionTechnology" is required — request rejected`);
      }

      const linked = await findRecord(baseUrl, headers, 'System', 'Resource ID', resourceId);

      if (!linked || !linked['System ID']) {
        throw new Error(`❌ ${label}: no System found with Resource ID "${resourceId}" — request rejected`);
      }

      // A System cannot be linked to itself — checked here so nothing has been written yet
      const isSelf = (mainSystemId && linked['System ID'] === mainSystemId)
        || (metadata['Resource ID'] && sameText(resourceId, metadata['Resource ID']));

      if (isSelf) {
        throw new Error(`❌ ${label} (${resourceId}): a System cannot be linked to itself — request rejected`);
      }

      console.log(`🔎 ${label}: Resource ID "${resourceId}" → System "${linked['Resource Name']}" (${linked['System ID']})`);

      plan.push({ direction, label, resourceId, connectionType, linkedId: linked['System ID'], linkedName: linked['Resource Name'] });
    }
  }

  return plan;
}

// ✅ Creates the planned links against the main System; skips links that already exist
async function applySystemLinks(baseUrl, headers, plan, mainSystemId, mainSystemName) {
  if (plan.length === 0) return;

  const relUrl = `${baseUrl}/api/System_REL_System`;
  const done = new Set();

  for (const link of plan) {
    const sourceId = link.direction === 'Upstream' ? mainSystemId : link.linkedId;
    const targetId = link.direction === 'Upstream' ? link.linkedId : mainSystemId;
    const sourceName = link.direction === 'Upstream' ? mainSystemName : link.linkedName;
    const targetName = link.direction === 'Upstream' ? link.linkedName : mainSystemName;
    const key = `${sourceId}>${targetId}`;

    if (done.has(key)) {
      console.log(`ℹ️ ${link.label}: duplicate of an earlier entry — skipped`);
      continue;
    }

    done.add(key);

    // Already linked? (filter by SOURCE_ID, then match TARGET_ID exactly)
    const existingRes = await request('GET', `${relUrl}?SOURCE_ID=${encodeURIComponent(sourceId)}`, undefined, headers);
    const exists = toRecords(existingRes.parsed).some(r => sameText(r['SOURCE_ID'], sourceId) && sameText(r['TARGET_ID'], targetId));

    if (exists) {
      console.log(`ℹ️ ${link.label}: "${sourceName}" → "${targetName}" already linked — skipped`);
      continue;
    }

    // Relationship endpoints take a LIST of links — a bare object is read as one row per field
    const payload = JSON.stringify([{ 'SOURCE_ID': sourceId, 'TARGET_ID': targetId, 'Connection Type': link.connectionType }]);

    console.log(`📡 POST ${relUrl}`);
    console.log(`📦 Payload:\n${payload}`);

    const res = await request('POST', relUrl, payload, { ...headers, 'Content-Length': Buffer.byteLength(payload) });

    console.log(`📨 Response:\n${res.body}`);

    const results = res.parsed && Array.isArray(res.parsed.result) ? res.parsed.result : null;
    const ok = res.parsed && res.parsed.success === true && (!results || results.some(r => r.success === true));

    if (!ok) {
      throw new Error(`❌ Failed to link "${sourceName}" → "${targetName}" (${link.label}, Connection Type "${link.connectionType}"): ${res.body}`);
    }

    console.log(`✅ Linked "${sourceName}" → "${targetName}" (${link.connectionType})`);
  }
}

// ✅ Organisation is a single fixed record per tenant — no name needed
async function resolveOrganisationId(baseUrl, headers) {
  const url = `${baseUrl}/api/Organisation`;
  const res = await request('GET', url, undefined, headers);

  const org = Array.isArray(res.parsed) ? res.parsed[0] : res.parsed;

  if (!org || !org['System ID']) {
    throw new Error('Could not resolve Organisation via /api/Organisation lookup');
  }

  return org['System ID'];
}

// ✅ "Assigned To" is always the Group flagged for environment management — never supplied by name
async function resolveAssignedToId(baseUrl, headers) {
  const url = `${baseUrl}/api/Group`;
  const res = await request('GET', url, undefined, headers);

  const records = Array.isArray(res.parsed) ? res.parsed : (res.parsed ? [res.parsed] : []);
  const match = records.find(r => r['Env Management'] === true);

  if (!match || !match['System ID']) {
    throw new Error('Could not resolve Assigned To — no Group found with "Env Management": true');
  }

  return match['System ID'];
}

// ✅ Creates the System if it doesn't already exist (cascade from a System Instance create)
async function resolveOrCreateSystem(baseUrl, headers, systemName, businessUnitName, status, assignedToId, organisationId, systemType, systemCore, resourceId) {
  // ✅ Same exact lookup as the access check (Resource ID first, then name), so the System that was
  // checked is always the System that is used
  const existing = await findSystem(baseUrl, headers, { systemRef: systemName, resourceId });

  if (existing) {
    return existing['System ID'];
  }

  if (!systemName) {
    throw new Error(`metadata.System is required to create a new System (no System found with Resource ID "${resourceId}")`);
  }

  console.log(`⚠️ System "${systemName}" not found — creating it`);

  const core = normalizeBool(systemCore, 'False', 'Core');

  const businessUnitId = await resolveByName(baseUrl, headers, 'BusinessUnit', 'BusinessUnit Name', businessUnitName || 'Other');

  const payload = JSON.stringify({
    'Resource Name': systemName,
    'Resource ID': resourceId,
    'Status': status,
    'Business Unit': businessUnitId,
    'Assigned To': assignedToId,
    'Organisation': organisationId,
    'Type': systemType || 'Other',
    'Core': core
  });

  const systemUrl = `${baseUrl}/api/System`;

  console.log(`📡 POST ${systemUrl}`);
  console.log(`📦 Payload:\n${payload}`);

  const res = await request('POST', systemUrl, payload, {
    ...headers,
    'Content-Length': Buffer.byteLength(payload)
  });

  console.log(`📨 Response:\n${res.body}`);

  const created = res.parsed
    && Array.isArray(res.parsed.result)
    && res.parsed.result.find(r => r.success === true);

  if (!created) {
    // A parallel run may have created it between our lookup and our POST — reuse it instead of failing.
    const raced = await tryResolveByName(baseUrl, headers, 'System', 'Resource Name', systemName);

    if (raced) {
      console.log(`⚠️ System "${systemName}" was created by another run in the meantime — reusing it (${raced})`);
      return raced;
    }

    throw new Error(`❌ Failed to create System "${systemName}": ${res.body}`);
  }

  console.log(`✅ Created System "${systemName}" (${created['System ID']})`);

  return created['System ID'];
}

// ✅ Creates the System Instance if it doesn't already exist (cascade from a MicroService create).
// Returns the instance's name, not its ECO ID — Enov8 resolves SystemInstance by name on MicroService create.
async function resolveOrCreateSystemInstance(baseUrl, headers, instanceName, metadata, status, assignedToId, organisationId) {
  const existingId = await tryResolveByName(baseUrl, headers, 'SystemInstance', 'Resource Name', instanceName);

  if (existingId) {
    return instanceName;
  }

  console.log(`⚠️ System Instance "${instanceName}" not found — creating it`);

  const payloadObj = {
    'Resource Name': instanceName,
    'Status': status,
    'Assigned To': assignedToId,
    'Organisation': organisationId
  };

  if (metadata['Environment']) {
    payloadObj['Environment'] = await resolveByName(baseUrl, headers, 'Environment', 'Resource Name', metadata['Environment']);
  }

  if (metadata['System'] || metadata['Resource ID']) {
    payloadObj['System'] = await resolveOrCreateSystem(
      baseUrl, headers, metadata['System'], metadata['Business Unit'], status, assignedToId, organisationId,
      metadata['Type'], metadata['Core'],  metadata['Resource ID']
    );
  }

  const payload = JSON.stringify(payloadObj);
  const instanceUrl = `${baseUrl}/api/SystemInstance`;

  console.log(`📡 POST ${instanceUrl}`);
  console.log(`📦 Payload:\n${payload}`);

  const res = await request('POST', instanceUrl, payload, {
    ...headers,
    'Content-Length': Buffer.byteLength(payload)
  });

  console.log(`📨 Response:\n${res.body}`);

  const created = res.parsed
    && Array.isArray(res.parsed.result)
    && res.parsed.result.some(r => r.success === true);

  if (!created) {
    const raced = await tryResolveByName(baseUrl, headers, 'SystemInstance', 'Resource Name', instanceName);

    if (raced) {
      console.log(`⚠️ System Instance "${instanceName}" was created by another run in the meantime — reusing it`);
      return instanceName;
    }

    throw new Error(`❌ Failed to create System Instance "${instanceName}": ${res.body}`);
  }

  console.log(`✅ Created System Instance "${instanceName}"`);

  return instanceName;
}

// The Version the resource holds right now ('' if it doesn't exist or has none).
// Read-only and best effort: a failed lookup never fails the run.
async function getCurrentVersion(url, headers, resourceType, resourceName, systemInstance) {
  const isMicro = resourceType === 'MicroService';
  const nameField = isMicro ? 'MicroService Name' : 'Resource Name';
  const norm = (s) => String(s === undefined || s === null ? '' : s).trim().toLowerCase();

  let query = `${encodeURIComponent(nameField)}=${encodeURIComponent(resourceName)}`;

  if (isMicro) {
    query += `&SystemInstance=${encodeURIComponent(systemInstance)}`;
  }

  try {
    const res = await request('GET', `${url}?${query}`, undefined, headers);
    const records = Array.isArray(res.parsed) ? res.parsed : (res.parsed ? [res.parsed] : []);

    // A MicroService name is only unique within its System Instance, so match both.
    const match = records.find(r => norm(r[nameField]) === norm(resourceName)
      && (!isMicro || norm(r['SystemInstance']) === norm(systemInstance)));

    const v = match ? match['Version'] : '';

    return v === null || v === undefined ? '' : String(v);
  } catch (e) {
    console.log(`⚠️ Could not read the previous version: ${e.message}`);
    return '';
  }
}

// The record's ECO ID: on create/update it's in result[], on a no-op update only in "value passed".
function extractResourceId(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';

  const fromResult = Array.isArray(parsed.result) ? parsed.result.find(r => r && r['System ID']) : null;

  if (fromResult) return fromResult['System ID'];

  const passed = Array.isArray(parsed['value passed']) ? parsed['value passed'][0] : null;

  return (passed && passed['System ID']) || '';
}

// Output values must stay on one line, or a stray newline could inject extra outputs.
const oneLine = (v) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ');

function writeOutput(res, created, previousVersion) {
  if (!process.env.GITHUB_OUTPUT) return;

  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `result=${JSON.stringify(res.parsed || res.body)}\n` +
    `created=${created ? 'true' : 'false'}\n` +
    `resource-id=${oneLine(extractResourceId(res.parsed))}\n` +
    `previous-version=${oneLine(previousVersion)}\n`
  );
}

async function run() {
  try {

    const baseUrl = getInput('enov8_url', true).replace(/\/+$/, '');

    let parsedBaseUrl;

    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new Error('enov8_url is not a valid URL — expected https://<host>[:port]/ecosystem');
    }

    if (parsedBaseUrl.protocol !== 'https:' && parsedBaseUrl.protocol !== 'http:') {
      throw new Error('enov8_url must start with https:// (or http:// on a trusted internal network)');
    }

    if (parsedBaseUrl.protocol === 'http:') {
      console.warn('⚠️ enov8_url uses plain http:// — the App ID and App Key are sent unencrypted. Use this only on a trusted internal network.');
    }

    if (getInput('insecure_skip_tls_verify').toLowerCase() === 'true') {
      tlsOptions = { rejectUnauthorized: false };
      console.warn('⚠️ insecure_skip_tls_verify is enabled — TLS certificate verification is DISABLED. Only use this for on-prem Enov8 instances with self-signed certificates.');
    }

    const resourceName = getInput('resourceName', true);
    const resourceType = getInput('resourceType', true);

    const version = getInput('version', true);

    const appId = getInput('app_id', true);
    const appKey = getInput('app_key', true);

    // ✅ Required only for MicroService
    const systemInstance = getInput('systemInstance');

    // ✅ Used to create the resource when it doesn't exist yet, and read up front for the access check and System links
    const metadataRaw = getInput('metadata');

    // ✅ Gate for the create fallback — a not-found resource is only ever created when this is 'true'
    const autocreate = getInput('autocreate').toLowerCase() === 'true';

    // ✅ Endpoint mappings
    const endpointMap = {
      'Environment Instance': 'SystemInstance',
      'System Component': 'SystemComponent',
      'System Interface': 'SystemInterface',
      'MicroService': 'MicroService'
    };

    const apiPath = endpointMap[resourceType];

    if (!apiPath) {
      throw new Error(`Invalid resourceType: ${resourceType}`);
    }

    // ✅ Validation for MicroService
    if (resourceType === 'MicroService' && !systemInstance) {
      throw new Error('systemInstance is required when resourceType is MicroService');
    }

    const url = `${baseUrl}/api/${apiPath}`;

    const headers = {
      'Content-Type': 'text/plain',
      'user-id': appId,
      'app-id': appId,
      'app-key': appKey
    };

    // ✅ Metadata is parsed up front: the access check and System links need it before any write
    const metadataEarly = metadataRaw ? parseMetadata(metadataRaw) : {};

    // ✅ Governed 1: identity comes from GitHub and must map to an active Enov8 user (all resource types)
    const githubUser = getGitHubActor();
    const userId = await resolveEnov8User(baseUrl, headers, githubUser);

    // ✅ Governed 2: System access (System Instance and MicroService, create and update) — before any write
    let associatedSystem = null;

    if (resourceType === 'Environment Instance' || resourceType === 'MicroService') {
      const { system, reason } = await resolveAssociatedSystem(baseUrl, headers, {
        resourceType, resourceName, systemInstance, metadata: metadataEarly
      });

      associatedSystem = system;

      if (system) {
        await validateSystemAccess(baseUrl, headers, userId, system);
      } else {
        console.log(`ℹ️ System access check not applicable — ${reason}`);
      }
    }

    // ✅ System ↔ System links — validated and resolved before any write
    const wantsLinks = metadataEarly['Upstream'] !== undefined || metadataEarly['Downstream'] !== undefined;
    let linkPlan = [];

    if (wantsLinks) {
      if (resourceType !== 'Environment Instance' && resourceType !== 'MicroService') {
        throw new Error(`❌ Upstream / Downstream links are only supported for Environment Instance and MicroService (got "${resourceType}")`);
      }

      if (!associatedSystem && !metadataEarly['System'] && !metadataEarly['Resource ID']) {
        throw new Error('❌ Upstream / Downstream links need a System: set metadata.System or metadata.Resource ID');
      }

      linkPlan = await planSystemLinks(baseUrl, headers, metadataEarly, associatedSystem && associatedSystem['System ID']);
    }

    // Links are attached to the associated System; a System created by this run is looked up after the create
    const linkSystems = async () => {
      if (linkPlan.length === 0) return;

      const main = associatedSystem || await findSystem(baseUrl, headers, {
        systemRef: metadataEarly['System'],
        resourceId: metadataEarly['Resource ID']
      });

      if (!main || !main['System ID']) {
        throw new Error('❌ Could not find the System to attach Upstream / Downstream links to');
      }

      await applySystemLinks(baseUrl, headers, linkPlan, main['System ID'], main['Resource Name']);
    };

    // ✅ Remember what the resource holds now, so later steps can see what this run replaced
    const previousVersion = await getCurrentVersion(url, headers, resourceType, resourceName, systemInstance);

    console.log(`ℹ️ Current version in Enov8: ${previousVersion || '(none)'}`);

    // ✅ Try update first
    const updatePayloadObj = {};

    if (resourceType === 'MicroService') {
      updatePayloadObj['MicroService Name'] = resourceName;
      updatePayloadObj['SystemInstance'] = systemInstance;
    } else {
      updatePayloadObj['Resource Name'] = resourceName;
    }

    if (version) {
      updatePayloadObj['Version'] = version;
    }

    const updatePayload = JSON.stringify(updatePayloadObj);

    console.log(`📡 PUT ${url}`);
    console.log(`📦 Payload:\n${updatePayload}`);

    const updateRes = await request('PUT', url, updatePayload, {
      ...headers,
      'Content-Length': Buffer.byteLength(updatePayload)
    });

    console.log(`📨 Response:\n${updateRes.body}`);

    if (updateRes.parsed && updateRes.parsed.total_updated > 0) {
      console.log('✅ Enov8 CMDB updated successfully');
      await linkSystems();
      writeOutput(updateRes, false, previousVersion);
      return;
    }

    if (updateRes.parsed && updateRes.parsed.success === true) {
      console.log('⚠️ No update applied (already up-to-date or invalid field)');
      await linkSystems();
      writeOutput(updateRes, false, previousVersion);
      return;
    }

    // ✅ Update didn't match an existing resource — only create when autocreate is enabled
    if (!autocreate) {
      throw new Error(`❌ API Error: ${updateRes.body}`);
    }

    if (!metadataRaw) {
      throw new Error(`metadata is required to create "${resourceName}" when autocreate is true`);
    }

    console.log(`⚠️ No existing "${resourceName}" found — attempting to create it using metadata`);

    const metadata = parseMetadata(metadataRaw);

    const status = metadata['Status'] || 'InOperation';

    const organisationId = await resolveOrganisationId(baseUrl, headers);
    const assignedToId = await resolveAssignedToId(baseUrl, headers);

    let createPayloadObj;

    if (resourceType === 'MicroService') {
      // ✅ MicroService needs no Assigned To/Organisation of its own — just a valid SystemInstance name,
      // cascade-created (System Instance -> System) via the same metadata used elsewhere.
      const resolvedInstanceName = await resolveOrCreateSystemInstance(
        baseUrl, headers, systemInstance, metadata, status, assignedToId, organisationId
      );

      createPayloadObj = {
        'MicroService Name': resourceName,
        'Status': status,
        'SystemInstance': resolvedInstanceName
      };
    } else if (resourceType === 'System Component') {
      // ✅ No System/Environment dependency at all — just its own Type (a separate, tenant-specific
      // ComponentType picklist — no safe default, so it's required) and Monitored flag.
      const componentType = metadata['Type'];

      if (!componentType) {
        throw new Error(`metadata.Type is required to create "${resourceName}" (must be a value already configured in your Enov8 tenant's Component Type picklist, e.g. Server, Database, Module, Integration)`);
      }

      createPayloadObj = {
        'Resource Name': resourceName,
        'Status': status,
        'Type': componentType,
        'Monitored': normalizeBool(metadata['Monitored'], 'False', 'Monitored'),
        'Assigned To': assignedToId,
        'Organisation': organisationId
      };
    } else {
      createPayloadObj = {
        'Resource Name': resourceName,
        'Status': status,
        'Assigned To': assignedToId,
        'Organisation': organisationId
      };

      if (metadata['Environment']) {
        createPayloadObj['Environment'] = await resolveByName(baseUrl, headers, 'Environment', 'Resource Name', metadata['Environment']);
      }

      if (metadata['System'] || metadata['Resource ID']) {
        createPayloadObj['System'] = await resolveOrCreateSystem(
          baseUrl, headers, metadata['System'], metadata['Business Unit'], status, assignedToId, organisationId,
          metadata['Type'], metadata['Core'], metadata['Resource ID']
        );
      }
    }

    if (version) {
      createPayloadObj['Version'] = version;
    }

    const createPayload = JSON.stringify(createPayloadObj);

    console.log(`📡 POST ${url}`);
    console.log(`📦 Payload:\n${createPayload}`);

    const createRes = await request('POST', url, createPayload, {
      ...headers,
      'Content-Length': Buffer.byteLength(createPayload)
    });

    console.log(`📨 Response:\n${createRes.body}`);

    const created = createRes.parsed
      && Array.isArray(createRes.parsed.result)
      && createRes.parsed.result.some(r => r.success === true);

    if (!created) {
      throw new Error(`❌ API Error: ${createRes.body}`);
    }

    console.log('✅ Enov8 CMDB resource created successfully');
    await linkSystems();
    writeOutput(createRes, true, '');

  } catch (err) {

    console.error(err.message);
    process.exit(1);

  }
}

run();
