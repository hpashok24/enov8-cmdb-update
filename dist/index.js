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

function request(urlStr, payload, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);

    const options = {
      method: 'PUT',
      hostname: url.hostname,
      path: url.pathname,
      headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => data += d);

      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch {}

        resolve({
          status: res.statusCode,
          body: data,
          parsed
        });
      });
    });

    req.on('error', reject);

    // ✅ IMPORTANT: send raw string like Python
    req.write(payload, 'utf8');
    req.end();
  });
}

async function run() {
  try {
    const baseUrl = getInput('enov8_url', true).replace(/\/+$/, '');
    const resourceName = getInput('resourceName', true);
    const resourceType = getInput('resourceType', true);

    const version = getInput('version');
    const status = getInput('status');

    const appId = getInput('app_id', true);
    const appKey = getInput('app_key', true);

    // ✅ Your environment mapping
    const endpointMap = {
      'Environment Instance': 'SystemInstance',
      'System Component': 'SystemComponent',
      'System Interface': 'SystemInterface',
    };

    const apiPath = endpointMap[resourceType];
    if (!apiPath) {
      throw new Error(`Invalid resourceType: ${resourceType}`);
    }

    const url = `${baseUrl}/api/${apiPath}`;

    // ✅ STRICT payload (NO System ID)
    const payloadObj = {
      "Resource Name": resourceName
    };

    if (status) payloadObj["Status"] = status;
    if (version) payloadObj["Version"] = version;

    const payload = JSON.stringify(payloadObj);

    console.log(`📡 PUT ${url}`);
    console.log(`📦 Payload:\n${payload}`);

    // ✅ IMPORTANT FIX: add Content-Length
    const headers = {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(payload),
      'user-id': appId,
      'app-id': appId,
      'app-key': appKey
    };

    const res = await request(url, payload, headers);

    console.log(`📨 Response:\n${res.body}`);

    // ✅ Smart handling
    if (res.parsed && res.parsed.total_updated > 0) {
      console.log('✅ Enov8 CMDB updated successfully');
    } else if (res.parsed && res.parsed.success === true) {
      console.log('⚠️ No update (already up-to-date or invalid field)');
    } else {
      throw new Error(`❌ API Error: ${res.body}`);
    }

    fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${res.body}\n`);

  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

run();
