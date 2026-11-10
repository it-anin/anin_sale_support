/** Shared connection settings and SELECT-only guard for the shop's MSSQL Agents. */
export function readEnvValue(text, name) {
  const m = String(text ?? '').match(new RegExp(`^\\s*${name}\\s*=(.*)$`, 'm'));
  if (!m) return null;
  let value = m[1].trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
    value = value.slice(1, -1);
  }
  return value || null;
}

export function buildMssqlConfig(env) {
  const instanceName = env('MSSQL_INSTANCE');
  const port = Number.parseInt(env('MSSQL_PORT') ?? '', 10);
  const tdsVersion = env('MSSQL_TDS_VERSION');
  const config = {
    server: env('MSSQL_SERVER'),
    database: env('MSSQL_DATABASE'),
    user: env('MSSQL_USER'),
    password: env('MSSQL_PASSWORD'),
    connectionTimeout: 15_000,
    requestTimeout: 20_000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 60_000 },
    options: {
      encrypt: String(env('MSSQL_ENCRYPT') ?? 'true').toLowerCase() !== 'false',
      trustServerCertificate: true,
      appName: 'anin-pending-docs-agent',
    },
  };
  if (instanceName) config.options.instanceName = instanceName;
  else if (Number.isFinite(port)) config.port = port;
  if (tdsVersion) config.options.tdsVersion = tdsVersion;
  return config;
}

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BACKUP|RESTORE|DBCC|SHUTDOWN|KILL)\b/i;

export function assertReadOnlySql(text) {
  const code = String(text ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
  if (!/^\s*SELECT\b/i.test(code)) {
    throw new Error('🚨 ส่งได้เฉพาะคำสั่ง SELECT — MSSQL ของ ProMaxx ห้ามเขียนเด็ดขาด');
  }
  if (code.includes(';')) {
    throw new Error('🚨 ห้ามมีหลายคำสั่งใน SQL เดียว (พบเครื่องหมาย ;)');
  }
  const found = code.match(WRITE_KEYWORDS);
  if (found) {
    throw new Error(`🚨 พบคำสั่ง ${found[1].toUpperCase()} — MSSQL ของ ProMaxx ห้ามเขียน/สร้างอะไรเด็ดขาด`);
  }
  return text;
}
