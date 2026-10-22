const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getInput(name, required = false) {
  const v = process.env[`INPUT_${name.toUpperCase()}`] || '';

  if (required && !v.trim()) {
    throw new Error(`Missing input: ${name}`);
  }

  return v.trim();
}

function request(method, urlStr, payload, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'http:' ? http : https;

    const options = {
      method,
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      headers
    };

    const req = lib.request(options, (res) => {
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

function sameText(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function toRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && !('success' in parsed && parsed.success === false)) return [parsed];
  return [];
}

// ✅ Exact-match lookup: returns the full record whose field equals value, or null.
// Never falls back to "the first record" — a wrong match must never pass validation.
async function findRecord(baseUrl, headers, endpoint, field, value) {
  if (!value) return null;

  const url = `${baseUrl}/api/${endpoint}?${encodeURIComponent(field)}=${encodeURIComponent(value)}`;
  const res = await request('GET', url, undefined, headers);

  return toRecords(res.parsed).find(r => sameText(r[field], value)) || null;
}

async function resolveByName(baseUrl, headers, endpoint, field, value) {
  const record = await findRecord(baseUrl, headers, endpoint, field, value);

  if (!record || !record['System ID']) {
    throw new Error(`Could not resolve "${value}" via ${endpoint} lookup`);
  }

  return record['System ID'];
}

// "A;B;C" -> ["A","B","C"]
function splitList(value) {
  return String(value ?? '').split(';').map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// User validation & access control
// ─────────────────────────────────────────────────────────────────────────────

// ✅ The user must exist in Enov8 and must not be inactive / awaiting approval
async function validateUser(baseUrl, headers, userId) {
  console.log(`🔐 Validating user "${userId}"`);

  const user = await findRecord(baseUrl, headers, 'User', 'User ID', userId);

  if (!user) {
    throw new Error(`❌ User "${userId}" does not exist in the Enov8 Ecosystem — request rejected`);
  }

  // Enov8 stores e.g. "ActiveUser" / "InactiveUser"
  const status = user['User Status'] ?? user['Status'];

  if (status && !/^active/i.test(String(status).trim())) {
    throw new Error(`❌ User "${userId}" is not active in the Enov8 Ecosystem (User Status: ${status}) — request rejected`);
  }

  // "Login Access" must be "Yes" (otherwise awaiting approval or rejected)
  const loginAccess = user['Login Access'];

  if (loginAccess !== undefined && loginAccess !== null && loginAccess !== '' && !sameText(loginAccess, 'Yes')) {
    throw new Error(`❌ User "${userId}" does not have login access in the Enov8 Ecosystem (Login Access: ${loginAccess}) — request rejected`);
  }

  console.log(`✅ User "${userId}" exists${status ? ` (User Status: ${status})` : ''}`);

  return user;
}

// ✅ Find a System: by Resource ID (APM ID) first, then by ECO ID or name
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
// Returns { system } when it exists, or { system: null, reason } when there is nothing to check yet.
async function resolveAssociatedSystem(baseUrl, headers, { resourceType, resourceName, systemInstance, metadata }) {
  const instanceName = resourceType === 'MicroService' ? systemInstance : resourceName;
  const instance = await findRecord(baseUrl, headers, 'SystemInstance', 'Resource Name', instanceName);

  if (instance) {
    // Update, or MicroService create on an existing instance — use the instance's own System
    const system = await findSystem(baseUrl, headers, { systemRef: instance['System'] });

    if (!system) {
      throw new Error(`❌ Could not find the System linked to System Instance "${instanceName}" (${instance['System'] || 'none'}) — cannot validate access`);
    }

    return { system, instanceExists: true };
  }

  // Instance does not exist yet — it will be created from metadata
  const system = await findSystem(baseUrl, headers, {
    systemRef: metadata && metadata['System'],
    resourceId: metadata && metadata['Resource ID']
  });

  if (system) {
    return { system, instanceExists: false };
  }

  return {
    system: null,
    instanceExists: false,
    reason: (metadata && (metadata['System'] || metadata['Resource ID']))
      ? `System "${metadata['System'] || metadata['Resource ID']}" does not exist yet and will be created by this run`
      : 'no System is linked to this request'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create helpers (cascade)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOrganisationId(baseUrl, headers) {
  const res = await request('GET', `${baseUrl}/api/Organisation`, undefined, headers);
  const org = Array.isArray(res.parsed) ? res.parsed[0] : res.parsed;

  if (!org || !org['System ID']) {
    throw new Error('Could not resolve Organisation via /api/Organisation lookup');
  }

  return org['System ID'];
}

async function resolveAssignedToId(baseUrl, headers) {
  const res = await request('GET', `${baseUrl}/api/Group`, undefined, headers);
  const match = toRecords(res.parsed).find(r => r['Env Management'] === true);

  if (!match || !match['System ID']) {
    throw new Error('Could not resolve Assigned To — no Group found with "Env Management": true');
  }

  return match['System ID'];
}

async function postAndCheck(url, payloadObj, headers, label) {
  const payload = JSON.stringify(payloadObj);

  console.log(`📡 POST ${url}`);
  console.log(`📦 Payload:\n${payload}`);

  const res = await request('POST', url, payload, {
    ...headers,
    'Content-Length': Buffer.byteLength(payload)
  });

  console.log(`📨 Response:\n${res.body}`);

  const created = res.parsed
    && Array.isArray(res.parsed.result)
    && res.parsed.result.find(r => r.success === true);

  if (!created) {
    throw new Error(`❌ Failed to create ${label}: ${res.body}`);
  }

  return { res, created };
}

// ✅ Uses the existing System (found by Resource ID, then name) or creates it
async function resolveOrCreateSystem(baseUrl, headers, metadata, status, assignedToId, organisationId) {
  const existing = await findSystem(baseUrl, headers, {
    systemRef: metadata['System'],
    resourceId: metadata['Resource ID']
  });

  if (existing) {
    return existing['System ID'];
  }

  const systemName = metadata['System'];

  if (!systemName) {
    throw new Error(`metadata.System is required to create a new System (no System found with Resource ID "${metadata['Resource ID']}")`);
  }

  console.log(`⚠️ System "${systemName}" not found — creating it`);

  const businessUnitId = await resolveByName(baseUrl, headers, 'BusinessUnit', 'BusinessUnit Name', metadata['Business Unit'] || 'Other');

  const { created } = await postAndCheck(`${baseUrl}/api/System`, {
    'Resource Name': systemName,
    'Resource ID': metadata['Resource ID'],
    'Status': status,
    'Business Unit': businessUnitId,
    'Assigned To': assignedToId,
    'Organisation': organisationId,
    'Type': metadata['Type'] || 'Other',
    'Core': metadata['Core'] || 'False'
  }, headers, `System "${systemName}"`);

  console.log(`✅ Created System "${systemName}" (${created['System ID']})`);

  return created['System ID'];
}

async function resolveOrCreateSystemInstance(baseUrl, headers, instanceName, metadata, status, assignedToId, organisationId) {
  const existing = await findRecord(baseUrl, headers, 'SystemInstance', 'Resource Name', instanceName);

  if (existing) {
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
    payloadObj['System'] = await resolveOrCreateSystem(baseUrl, headers, metadata, status, assignedToId, organisationId);
  }

  await postAndCheck(`${baseUrl}/api/SystemInstance`, payloadObj, headers, `System Instance "${instanceName}"`);

  console.log(`✅ Created System Instance "${instanceName}"`);

  return instanceName;
}

function writeOutput(res) {
  if (!process.env.GITHUB_OUTPUT) return;

  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `result=${JSON.stringify(res.parsed || res.body)}\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  try {
    const baseUrl = getInput('enov8_url', true).replace(/\/+$/, '');
    const appId = getInput('app_id', true);
    const appKey = getInput('app_key', true);

    // ✅ Mandatory User ID
    const userId = getInput('userid', true);

    const resourceType = getInput('resourceType', true);
    const resourceName = getInput('resourceName', true);
    const version = getInput('version', true);
    const systemInstance = getInput('systemInstance');
    const metadataRaw = getInput('metadata');
    const autocreate = getInput('autocreate').toLowerCase() === 'true';

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

    if (resourceType === 'MicroService' && !systemInstance) {
      throw new Error('systemInstance is required when resourceType is MicroService');
    }

    let metadata = {};

    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch (e) {
        throw new Error(`Invalid metadata JSON: ${e.message}`);
      }
    }

    const headers = {
      'Content-Type': 'text/plain',
      'user-id': appId,
      'app-id': appId,
      'app-key': appKey
    };

    // ✅ 1. User must exist (all resource types)
    await validateUser(baseUrl, headers, userId);

    // ✅ 2. System access check (System Instance and MicroService, create and update) — before any write
    if (resourceType === 'Environment Instance' || resourceType === 'MicroService') {
      const { system, reason } = await resolveAssociatedSystem(baseUrl, headers, {
        resourceType, resourceName, systemInstance, metadata
      });

      if (system) {
        await validateSystemAccess(baseUrl, headers, userId, system);
      } else {
        console.log(`ℹ️ System access check not applicable — ${reason}`);
      }
    }

    // ✅ 3. Update (unchanged behaviour)
    const url = `${baseUrl}/api/${apiPath}`;
    const updatePayloadObj = {};

    if (resourceType === 'MicroService') {
      updatePayloadObj['MicroService Name'] = resourceName;
      updatePayloadObj['SystemInstance'] = systemInstance;
    } else {
      updatePayloadObj['Resource Name'] = resourceName;
    }

    updatePayloadObj['Version'] = version;

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
      writeOutput(updateRes);
      return;
    }

    if (updateRes.parsed && updateRes.parsed.success === true) {
      console.log('⚠️ No update applied (already up-to-date or invalid field)');
      writeOutput(updateRes);
      return;
    }

    // ✅ 4. Create (only when autocreate is enabled)
    if (!autocreate) {
      throw new Error(`❌ API Error: ${updateRes.body}`);
    }

    if (!metadataRaw) {
      throw new Error(`metadata is required to create "${resourceName}" when autocreate is true`);
    }

    console.log(`⚠️ No existing "${resourceName}" found — attempting to create it using metadata`);

    const status = metadata['Status'] || 'InOperation';
    const organisationId = await resolveOrganisationId(baseUrl, headers);
    const assignedToId = await resolveAssignedToId(baseUrl, headers);

    let createPayloadObj;

    if (resourceType === 'MicroService') {
      const resolvedInstanceName = await resolveOrCreateSystemInstance(
        baseUrl, headers, systemInstance, metadata, status, assignedToId, organisationId
      );

      createPayloadObj = {
        'MicroService Name': resourceName,
        'Status': status,
        'SystemInstance': resolvedInstanceName
      };
    } else if (resourceType === 'System Component') {
      const componentType = metadata['Type'];

      if (!componentType) {
        throw new Error(`metadata.Type is required to create "${resourceName}" (must be a value already configured in your Enov8 tenant's Component Type picklist, e.g. Server, Database, Module, Integration)`);
      }

      createPayloadObj = {
        'Resource Name': resourceName,
        'Status': status,
        'Type': componentType,
        'Monitored': metadata['Monitored'] || 'False',
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
        createPayloadObj['System'] = await resolveOrCreateSystem(baseUrl, headers, metadata, status, assignedToId, organisationId);
      }
    }

    createPayloadObj['Version'] = version;

    const { res: createRes } = await postAndCheck(url, createPayloadObj, headers, `"${resourceName}"`);

    console.log('✅ Enov8 CMDB resource created successfully');
    writeOutput(createRes);

  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

run();
