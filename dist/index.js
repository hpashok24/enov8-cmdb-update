\
// Self-contained GitHub Action entry (no dependencies).
// Reads inputs via environment variables (INPUT_<NAME>), performs HTTPS PUT to Enov8 CMDB.

const https = require('https');
const { URL } = require('url');

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

// Endpoint map: ResourceType -> API path
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
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) return resolve(parsed);
        return reject(new Error(`HTTP ${status} - ${raw}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  try {
    const resourceType = getInput('resourceType', { required: true });
    const resourceName = getInput('resourceName', { required: true });

    const includeVersion = parseBool(getInput('includeVersion', { defaultValue: 'false' }));
    const includeStatus  = parseBool(getInput('includeStatus', { defaultValue: 'false' }));

    const version = getInput('version', { required: includeVersion });
    const status  = getInput('status', { required: includeStatus });

    const appId   = getInput('app_id', { required: true });
    const appKey  = getInput('app_key', { required: true });
    const baseUrl = getInput('enov8_url', { required: true }).replace(/\/+$/, '');

    const insecure = parseBool(getInput('insecure_skip_tls_verify', { defaultValue: 'false' }));
    if (insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      info('Warning: TLS verification disabled (insecure_skip_tls_verify=true)');
    }

    const apiPath = endpointMap[resourceType];
    if (!apiPath) fail(`Unsupported resourceType: ${resourceType}. Allowed: ${Object.keys(endpointMap).join(' | ')}`);

    const url = `${baseUrl}/api/${apiPath}`;
    const payload = { 'Resource Name': resourceName };
    if (version) payload.Version = version;
    if (status)  payload.Status  = status;

    info(`📡 PUT ${url}`);
    info(`📦 Payload:\n${JSON.stringify(payload, null, 2)}`);

    const headers = {
      'user-id': appId,
      'app-id': appId,
      'app-key': appKey,
    };

    const result = await httpRequest(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
    info('✅ Enov8 CMDB updated successfully.');
    // legacy set-output for compatibility with older workflows
    console.log(`::set-output name=result::${JSON.stringify(result)}`);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

run();
