export function validateEnvironment(config: Record<string, unknown>) {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing: string[] = [];

  for (const key of required) {
    if (!config[key] && !process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[CONFIG] Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return config;
}
