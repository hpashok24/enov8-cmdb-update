// Self-contained GitHub Action (no dependencies)

const https = require('https');
const { URL } = require('url');
const fs = require('fs');

function getInput(name, { required = false, defaultValue = '' } = {}) {
  const v = process.env[`INPUT_${name.toUpperCase()}`] || '';
  if (required && !v.trim()) {
    fail(`Input required and not supplied: ${name}`);
  }
  return v.trim() || defaultValue;
}

function parseBool(v, d = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function info(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
  throw new Error(msg);
}

// ✅ Default mapping (your environment uses SystemInstance)
const endpointMap = {
  'Environment Instance': 'SystemInstance',
  'System Component': 'SystemComponent',
  'System Interface': 'SystemInterface',
};

function httpRequest(urlStr, { method = 'PUT', headers = {}, body = null, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);

    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
    };

    const req = https.request(opts, (res) => {
      const chunks = [];

      res.on('data', (d) => chunks.push(d));

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }

        // ✅ Enov8 returns success=true even with HTTP 400
        if (parsed && parsed.success === true) {
          return resolve(parsed);
        }

        return reject(new Error(`HTTP ${res.statusCode} - ${raw}`));
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`))
    );

    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  try {
    const resourceType = getInput('resourceType', { required: true });
    const resourceName = getInput('resourceName', { required: true });

    const version = getInput('version');
    const status = getInput('status');

    const appId = getInput('app_id', { required: true });
    const appKey = getInput('app_key', { required: true });

    const baseUrl = getInput('enov8_url', { required: true }).replace(/\/+$/, '');

    // ✅ Optional override (important for portability)
    const overrideApiPath = getInput('apiPath');

    const apiPath = overrideApiPath || endpointMap[resourceType];

    if (!apiPath) {
      fail(`Unsupported resourceType: ${resourceType}. Allowed: ${Object.keys(endpointMap).join(' | ')}`);
    }

    const insecure = parseBool(getInput('insecure_skip_tls_verify', { defaultValue: 'false' }));

    if (insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      info('⚠️ TLS verification disabled');
    }

    const url = `${baseUrl}/api/${apiPath}`;

    const payload = {
      'Resource Name': resourceName,
    };

    if (version) payload.Version = version;
    if (status) payload.Status = status;

    info(`📡 PUT ${url}`);
    info(`📦 Payload:\n${JSON.stringify(payload, null, 2)}`);

    const headers = {
      'user-id': appId,
      'app-id': appId,
      'app-key': appKey,
    };

    const result = await httpRequest(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });

    // ✅ Better UX handling
    if (result.total_updated === 0) {
      info('⚠️ No changes applied (already up-to-date or invalid field)');
    } else {
      info('✅ Enov8 CMDB updated successfully.');
    }

    // ✅ Modern GitHub output
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${JSON.stringify(result)}\n`);

  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

run();
