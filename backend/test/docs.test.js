const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('OpenAPI document covers all endpoints', async () => {
  const res = await request(app).get('/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.openapi.startsWith('3.'), true);
  for (const path of ['/api/v1/meta', '/api/v1/books', '/api/v1/books/{book}',
    '/api/v1/books/{book}/chapters/{chapter}',
    '/api/v1/books/{book}/chapters/{chapter}/sections/{index}',
    '/api/v1/sections/{id}', '/api/v1/parallel', '/api/v1/search',
    '/api/v1/references', '/health']) {
    assert.ok(res.body.paths[path], `missing ${path}`);
  }
});

test('Swagger UI is served', async () => {
  const res = await request(app).get('/docs/');
  assert.equal(res.status, 200);
  assert.match(res.text, /swagger-ui/i);
});
