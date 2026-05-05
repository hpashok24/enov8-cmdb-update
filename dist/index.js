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
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', reject);

    // 🔥 IMPORTANT: just send string (no tricks)
    req.write(payload);
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

    // 🔥 your env uses SystemInstance
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

    // ✅ Keep payload simple (like Python)
    const payloadObj = {
      "Resource Name": resourceName
    };

    if (status) payloadObj["Status"] = status;
    if (version) payloadObj["Version"] = version;

    const payload = JSON.stringify(payloadObj);

    console.log(`📡 PUT ${url}`);
    console.log(`📦 Payload:\n${payload}`);

    const headers = {
      'Content-Type': 'text/plain',
      'user-id': appId,
      'app-id': appId,
      'app-key': appKey
    };

    const res = await request(url, payload, headers);

    console.log(`📨 Response:\n${res.body}`);

    let parsed;
    try { parsed = JSON.parse(res.body); } catch {}

    if (parsed && parsed.total_updated > 0) {
      console.log('✅ Updated successfully');
    } else {
      console.log('⚠️ No update (check values)');
    }

    fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${res.body}\n`);

  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

run();
