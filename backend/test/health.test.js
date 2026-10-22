const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /health returns ok', async () => {
  const res = await request(createApp(null)).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok', service: 'bible-commentary-fr-tadros' });
});

test('unknown route returns JSON 404', async () => {
  const res = await request(createApp(null)).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
