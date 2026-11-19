export default () => ({
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://postgres:@localhost:5432/pos_erp_dev?schema=public',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    ttl: parseInt(process.env.CACHE_TTL || '300000', 10),
  },
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      'salamatinnovation-backend-super-secret-jwt-key-2026',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from:
      process.env.SMTP_FROM ||
      '"Salamat POS & ERP" <no-reply@salamatinnovation.com>',
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    consolePort: parseInt(process.env.MINIO_CONSOLE_PORT || '9001', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    region: process.env.MINIO_REGION || undefined,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET_NAME || 'salamat-pos-erp',
  },
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'Salamat POS & ERP',
    rpID: process.env.WEBAUTHN_RP_ID || 'localhost',
    origin: (
      process.env.WEBAUTHN_ORIGIN ||
      'http://localhost:3000,http://localhost:5173'
    )
      .split(',')
      .map((o) => o.trim()),
  },
});
