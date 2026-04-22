/**
 * Smoke tests for the REST API.
 *
 * These don't cover the WebSocket layer — that would need a client harness.
 * The goal here is a fast sanity check that the public HTTP surface behaves
 * the way the dashboards expect it to.
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('../server');

test('GET /api/stats returns the expected shape', async () => {
  const res = await request(app).get('/api/stats');
  assert.equal(res.status, 200);
  assert.ok('total' in res.body);
  assert.ok('active' in res.body);
  assert.ok('late' in res.body);
  assert.ok('byChannel' in res.body);
  assert.ok('byStatus' in res.body);
  assert.ok('avgResolutionSec' in res.body);
});

test('POST /api/orders creates a ticket and returns it with priority', async () => {
  const res = await request(app)
    .post('/api/orders')
    .send({
      channel: 'takeaway',
      customerName: 'Test Customer',
      items: [{ name: 'Al pastor tacos', quantity: 2, prepTimeMinutes: 6 }],
    });

  assert.equal(res.status, 201);
  assert.match(res.body.id, /^ORD-\d{4}$/);
  assert.equal(res.body.status, 'new');
  assert.equal(res.body.channel, 'takeaway');
  assert.equal(res.body.items.length, 1);
  assert.ok(['normal', 'high', 'critical'].includes(res.body.priority));
});

test('POST /api/orders rejects an empty item list', async () => {
  const res = await request(app)
    .post('/api/orders')
    .send({ channel: 'dine-in', tableNumber: '7', items: [] });

  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test('POST /api/orders rejects an invalid channel', async () => {
  const res = await request(app)
    .post('/api/orders')
    .send({
      channel: 'drive-thru', // not a real channel
      items: [{ name: 'Thing', quantity: 1, prepTimeMinutes: 5 }],
    });

  assert.equal(res.status, 400);
});

test('PATCH /api/orders/:id advances an order through its lifecycle', async () => {
  const created = await request(app)
    .post('/api/orders')
    .send({
      channel: 'dine-in',
      tableNumber: '3',
      items: [{ name: 'Carne asada burrito', quantity: 1, prepTimeMinutes: 8 }],
    });
  const id = created.body.id;

  const preparing = await request(app).patch(`/api/orders/${id}`).send({ status: 'preparing' });
  assert.equal(preparing.status, 200);
  assert.equal(preparing.body.status, 'preparing');
  assert.ok(preparing.body.startedAt);

  const ready = await request(app).patch(`/api/orders/${id}`).send({ status: 'ready' });
  assert.equal(ready.body.status, 'ready');
  assert.ok(ready.body.readyAt);

  const served = await request(app).patch(`/api/orders/${id}`).send({ status: 'served' });
  assert.equal(served.body.status, 'served');
  assert.ok(served.body.servedAt);
});

test('GET /api/orders filters by channel', async () => {
  // Create one order per channel so the filter has something to exclude.
  await request(app).post('/api/orders').send({
    channel: 'online',
    customerName: 'Filter Test',
    items: [{ name: 'Horchata', quantity: 1, prepTimeMinutes: 2 }],
  });

  const res = await request(app).get('/api/orders?channel=online');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.every((o) => o.channel === 'online'));
});

// Close the underlying HTTP server so `node --test` exits cleanly instead of
// hanging on an open WebSocket listener.
test.after(() => {
  const { server } = require('../server');
  server.close();
});
