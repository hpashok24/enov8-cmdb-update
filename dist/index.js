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
  const existingId = await tryResolveByName(baseUrl, headers, 'System', 'Resource Name', systemName);

  if (existingId) {
    return existingId;
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

  if (metadata['System']) {
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

    // ✅ Only used when the resource doesn't exist yet — resolved to ECO IDs and used to create it
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
      writeOutput(updateRes, false, previousVersion);
      return;
    }

    if (updateRes.parsed && updateRes.parsed.success === true) {
      console.log('⚠️ No update applied (already up-to-date or invalid field)');
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

      if (metadata['System']) {
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
    writeOutput(createRes, true, '');

  } catch (err) {

    console.error(err.message);
    process.exit(1);

  }
}

run();
