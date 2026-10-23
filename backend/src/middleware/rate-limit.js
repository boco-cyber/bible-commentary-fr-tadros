const { rateLimit } = require('express-rate-limit');

function createRateLimiter(limit) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.set('Retry-After', '60');
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    },
  });
}

module.exports = { createRateLimiter };
