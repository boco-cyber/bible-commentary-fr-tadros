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
  for (const path of ['/api/v1/navigation', '/api/v1/resolve', '/api/v1/scripture/search', '/api/v1/meta', '/api/v1/books', '/api/v1/books/{book}',
    '/api/v1/books/{book}/chapters/{chapter}',
    '/api/v1/books/{book}/chapters/{chapter}/scripture',
    '/api/v1/books/{book}/chapters/{chapter}/study',
    '/api/v1/books/{book}/chapters/{chapter}/verses/{verse}/commentary',
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

test('catalog revalidates corrected source data and meta is cached for an hour', async () => {
  for (const path of ['/api/v1/meta', '/api/v1/books', '/api/v1/books/genesis',
    '/api/v1/books/genesis/chapters/1']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], path === '/api/v1/meta' ? 'public, max-age=3600' : 'public, max-age=0, must-revalidate');
  }
});

test('parallel responses have representation-specific ETags and honor If-None-Match', async () => {
  const url = '/api/v1/parallel?book=genesis&chapter=1&index=1';
  const first = await request(app).get(url);
  assert.equal(first.status, 200);
  assert.ok(first.headers.etag);
  assert.match(first.headers['cache-control'], /must-revalidate/);

  const cached = await request(app).get(url).set('If-None-Match', first.headers.etag);
  assert.equal(cached.status, 304);

  const markdown = await request(app).get(`${url}&format=markdown`);
  assert.equal(markdown.status, 200);
  assert.notEqual(markdown.headers.etag, first.headers.etag);
});

test('OpenAPI documents rate limiting on content routes', async () => {
  const res = await request(app).get('/openapi.json');
  for (const path of ['/api/v1/search', '/api/v1/sections/{id}',
    '/api/v1/books/{book}/chapters/{chapter}/scripture',
    '/api/v1/books/{book}/chapters/{chapter}/study',
    '/api/v1/books/{book}/chapters/{chapter}/verses/{verse}/commentary',
    '/api/v1/books/{book}/chapters/{chapter}/sections/{index}', '/api/v1/parallel']) {
    assert.ok(res.body.paths[path].get.responses['429'], `missing 429 for ${path}`);
  }
});
