const https = require('https');
const { URL } = require('url');
const fs = require('fs');

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

    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers
    };

    const req = https.request(options, (res) => {
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

// ✅ Name -> ECO ID lookups for the metadata block (create-only path)
const METADATA_LOOKUPS = {
  'System': { endpoint: 'System', nameField: 'Resource Name' },
  'Environment': { endpoint: 'Environment', nameField: 'Resource Name' },
  'Assigned To': { endpoint: 'Group', nameField: 'Contact Name' }
};

async function resolveEcoId(baseUrl, headers, field, name) {
  const lookup = METADATA_LOOKUPS[field];

  if (!lookup) {
    throw new Error(`No lookup configured for metadata field: ${field}`);
  }

  const url = `${baseUrl}/api/${lookup.endpoint}?${encodeURIComponent(lookup.nameField)}=${encodeURIComponent(name)}`;
  const res = await request('GET', url, undefined, headers);

  const records = Array.isArray(res.parsed) ? res.parsed : (res.parsed ? [res.parsed] : []);
  const match = records.find(r => r[lookup.nameField] === name) || records[0];

  if (!match || !match['System ID']) {
    throw new Error(`Could not resolve "${field}" name "${name}" via ${lookup.endpoint} lookup`);
  }

  return match['System ID'];
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

function writeOutput(res) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `result=${JSON.stringify(res.parsed || res.body)}\n`
  );
}

async function run() {
  try {

    const baseUrl = getInput('enov8_url', true).replace(/\/+$/, '');
    const resourceName = getInput('resourceName', true);
    const resourceType = getInput('resourceType', true);

    const version = getInput('version');

    const appId = getInput('app_id', true);
    const appKey = getInput('app_key', true);

    // ✅ Required only for MicroService
    const systemInstance = getInput('systemInstance');

    // ✅ Only used when the resource doesn't exist yet — resolved to ECO IDs and used to create it
    const metadataRaw = getInput('metadata');

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
      writeOutput(updateRes);
      return;
    }

    if (updateRes.parsed && updateRes.parsed.success === true) {
      console.log('⚠️ No update applied (already up-to-date or invalid field)');
      writeOutput(updateRes);
      return;
    }

    // ✅ Update didn't match an existing resource — fall back to create when metadata is supplied
    if (!metadataRaw) {
      throw new Error(`❌ API Error: ${updateRes.body}`);
    }

    console.log(`⚠️ No existing "${resourceName}" found — attempting to create it using metadata`);

    let metadata;

    try {
      metadata = JSON.parse(metadataRaw);
    } catch (e) {
      throw new Error(`Invalid metadata JSON: ${e.message}`);
    }

    const status = metadata['Status'];

    if (!status) {
      throw new Error(`metadata.Status is required to create "${resourceName}" (Enov8 rejects create without a Status)`);
    }

    const createPayloadObj = {
      'Resource Name': resourceName,
      'Status': status
    };

    if (version) {
      createPayloadObj['Version'] = version;
    }

    for (const [field, name] of Object.entries(metadata)) {
      if (field === 'Status' || !name) continue;
      createPayloadObj[field] = await resolveEcoId(baseUrl, headers, field, name);
    }

    createPayloadObj['Organisation'] = await resolveOrganisationId(baseUrl, headers);

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
    writeOutput(createRes);

  } catch (err) {

    console.error(err.message);
    process.exit(1);

  }
}

run();
