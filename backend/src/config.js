const path = require('node:path');

module.exports = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'commentary.sqlite'),
  corsOrigins: process.env.CORS_ORIGINS || '*',
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 120),
  siteName: process.env.SITE_NAME || 'Bible Commentary — Fr. Tadros Malaty',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://commentary.copticfaith.org',
};
