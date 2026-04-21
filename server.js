/**
 * Restaurant Order Flow Optimizer
 * -----------------------------------------------------------------------------
 * Express HTTP server + WebSocket broadcast layer.
 *
 * HTTP:   serves the static dashboard pages (order entry, kitchen, FOH, manager)
 *         and a small REST API for orders and stats.
 * WS:     pushes sub-second updates to every connected dashboard whenever an
 *         order is created, moved through its lifecycle, or resolved.
 *
 * Storage is intentionally in-memory. Swapping this for Redis or Postgres would
 * be a one-file change (see `orderStore` below) without touching the UI layer.
 * -----------------------------------------------------------------------------
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// Data model
// -----------------------------------------------------------------------------
//
// An order flows through this lifecycle:
//   new  ->  preparing  ->  ready  ->  served
//                    \->  cancelled
//
// Priority is derived (not stored) from elapsed time vs. estimated prep time:
//   normal   — on track
//   high     — within 20% of estimate (warning)
//   critical — exceeded estimate (late)
//
// The three channels on the resume (dine-in, online, takeaway) are first-class
// so each dashboard can filter cleanly.

const CHANNELS = ['dine-in', 'online', 'takeaway'];
const STATUSES = ['new', 'preparing', 'ready', 'served', 'cancelled'];

let orderCounter = 0;
const orders = new Map(); // id -> order

function nextOrderId() {
  orderCounter += 1;
  return `ORD-${String(orderCounter).padStart(4, '0')}`;
}

function computePriority(order) {
  if (order.status !== 'preparing' && order.status !== 'new') return 'normal';
  const start = new Date(order.startedAt || order.createdAt).getTime();
  const elapsedMin = (Date.now() - start) / 60000;
  const estimate = order.estimatedPrepTime || 10;
  if (elapsedMin >= estimate) return 'critical';
  if (elapsedMin >= estimate * 0.8) return 'high';
  return 'normal';
}

function decorate(order) {
  return { ...order, priority: computePriority(order) };
}

function createOrder(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) throw new Error('Order must contain at least one item.');
  if (!CHANNELS.includes(payload.channel)) throw new Error(`Invalid channel.`);

  // Kitchen items mostly cook in parallel, so the ticket is "done" when the
  // slowest item is done. A small surcharge is added for each extra item to
  // model the station being busy (plating, assembly).
  const maxPrep = Math.max(...items.map((it) => Number(it.prepTimeMinutes) || 5));
  const extraLoad = Math.max(0, items.length - 1) * 0.5;
  const estimatedPrepTime = Math.max(1, Math.round(maxPrep + extraLoad));

  const order = {
    id: nextOrderId(),
    channel: payload.channel,
    tableNumber: payload.tableNumber || null,
    customerName: payload.customerName || null,
    items: items.map((it) => ({
      name: String(it.name || '').trim(),
      quantity: Number(it.quantity) || 1,
      prepTimeMinutes: Number(it.prepTimeMinutes) || 5,
      notes: it.notes || '',
    })),
    notes: payload.notes || '',
    status: 'new',
    createdAt: new Date().toISOString(),
    startedAt: null,
    readyAt: null,
    servedAt: null,
    estimatedPrepTime,
  };
  orders.set(order.id, order);
  return order;
}

function updateOrderStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error('Invalid status.');
  const order = orders.get(id);
  if (!order) throw new Error(`Order ${id} not found.`);

  order.status = status;
  const now = new Date().toISOString();
  if (status === 'preparing' && !order.startedAt) order.startedAt = now;
  if (status === 'ready' && !order.readyAt) order.readyAt = now;
  if (status === 'served' && !order.servedAt) order.servedAt = now;
  return order;
}

// -----------------------------------------------------------------------------
// Priority sort used by kitchen + FOH views.
//   1. critical first, then high, then normal
//   2. within a tier, oldest first
// -----------------------------------------------------------------------------
function sortByPriority(list) {
  const rank = { critical: 0, high: 1, normal: 2 };
  return [...list].sort((a, b) => {
    const pa = computePriority(a);
    const pb = computePriority(b);
    if (rank[pa] !== rank[pb]) return rank[pa] - rank[pb];
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

// -----------------------------------------------------------------------------
// WebSocket broadcast
// -----------------------------------------------------------------------------
function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (socket) => {
  // Send a snapshot so the dashboard can render immediately, without waiting
  // for a REST round-trip.
  socket.send(
    JSON.stringify({
      type: 'snapshot',
      orders: sortByPriority([...orders.values()]).map(decorate),
    }),
  );

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    try {
      if (msg.type === 'create_order') {
        const order = createOrder(msg.payload);
        broadcast({ type: 'order_created', order: decorate(order) });
      } else if (msg.type === 'update_status') {
        const order = updateOrderStatus(msg.id, msg.status);
        broadcast({ type: 'order_updated', order: decorate(order) });
      } else if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
      }
    } catch (err) {
      socket.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
});

// Re-broadcast priority every 15 seconds so cards tick into "high" / "critical"
// on every dashboard even if no one has touched an order. This is what makes
// the view feel live during a slow stretch.
setInterval(() => {
  if (orders.size === 0 || wss.clients.size === 0) return;
  const active = [...orders.values()].filter(
    (o) => o.status === 'new' || o.status === 'preparing',
  );
  if (active.length === 0) return;
  broadcast({
    type: 'priority_tick',
    orders: active.map(decorate),
  });
}, 15000);

// -----------------------------------------------------------------------------
// REST API (parallel to WebSockets — useful for integrations and curl-testing)
// -----------------------------------------------------------------------------
app.get('/api/orders', (req, res) => {
  const { channel, status } = req.query;
  let list = [...orders.values()];
  if (channel) list = list.filter((o) => o.channel === channel);
  if (status) list = list.filter((o) => o.status === status);
  res.json(sortByPriority(list).map(decorate));
});

app.post('/api/orders', (req, res) => {
  try {
    const order = createOrder(req.body);
    broadcast({ type: 'order_created', order: decorate(order) });
    res.status(201).json(decorate(order));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/orders/:id', (req, res) => {
  try {
    const order = updateOrderStatus(req.params.id, req.body.status);
    broadcast({ type: 'order_updated', order: decorate(order) });
    res.json(decorate(order));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  const list = [...orders.values()];
  const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let resolvedMs = 0;
  let resolvedCount = 0;

  for (const o of list) {
    byChannel[o.channel] += 1;
    byStatus[o.status] += 1;
    if (o.servedAt) {
      resolvedMs += new Date(o.servedAt) - new Date(o.createdAt);
      resolvedCount += 1;
    }
  }

  const avgResolutionSec = resolvedCount ? Math.round(resolvedMs / resolvedCount / 1000) : 0;
  const active = list.filter((o) => o.status === 'new' || o.status === 'preparing');
  const late = active.filter((o) => computePriority(o) === 'critical').length;

  res.json({
    total: list.length,
    active: active.length,
    late,
    byChannel,
    byStatus,
    avgResolutionSec,
  });
});

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`\n  Restaurant Order Flow Optimizer`);
  console.log(`  -------------------------------`);
  console.log(`  HTTP      http://localhost:${PORT}`);
  console.log(`  WebSocket ws://localhost:${PORT}/ws\n`);
  console.log(`  Open these in separate tabs to see the flow:`);
  console.log(`    /order-entry.html   create new orders (any channel)`);
  console.log(`    /kitchen.html       kitchen display system (KDS)`);
  console.log(`    /foh.html           front-of-house status board`);
  console.log(`    /manager.html       live metrics + full order log\n`);
});
