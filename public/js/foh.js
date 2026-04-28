/* Front of House — three sections:
   - "Ready to run"        tickets the kitchen finished; server closes them out
   - "Recently cancelled"  tickets the kitchen 86'd, so the server can warn the table
   - "In the kitchen"      still cooking, shown read-only so FOH can manage tables */

const { Socket, fmt, escapeHtml, toast, registerTicker } = window.RestaurantOps;
const socket = new Socket();

const readyEl = document.getElementById('ready');
const flightEl = document.getElementById('inFlight');
const cancelledEl = document.getElementById('cancelled');
const cancelledHeading = document.getElementById('cancelledHeading');

// id -> { order, expiresAt }. Kept ~60s after a ticket is cancelled so the
// server can spot it before it auto-fades.
const CANCELLED_LINGER_MS = 60000;
const cancelledRecent = new Map();

function ticketHtml(o, { serverAction, cancelled = false } = {}) {
  const since = o.readyAt || o.startedAt || o.createdAt;
  const items = o.items.map((it) => `
    <li>
      <span class="qty">${it.quantity}×</span>
      <span class="item-name">${escapeHtml(it.name)}</span>
    </li>`).join('');

  const classes = ['ticket', `priority-${o.priority}`];
  if (cancelled) classes.push('ticket-cancelled');

  return `
    <article class="${classes.join(' ')}" data-id="${o.id}">
      <header class="ticket-header">
        <span class="ticket-id">${o.id}</span>
        <span class="ticket-timer" data-since="${since}">${fmt.elapsed(since)}</span>
      </header>
      <div class="ticket-meta">
        <span class="channel-badge ${o.channel}">${fmt.channelLabel(o.channel)}</span>
        <span class="ticket-customer">${fmt.customer(o)}</span>
      </div>
      <ul class="ticket-items">${items}</ul>
      ${o.notes ? `<div class="ticket-notes">⚠ ${escapeHtml(o.notes)}</div>` : ''}
      ${serverAction ? `
        <div class="ticket-actions">
          <button class="success" data-action="serve" data-id="${o.id}">Mark served</button>
        </div>` : ''}
    </article>`;
}

function render() {
  const orders = socket.allOrders();
  const ready  = orders.filter((o) => o.status === 'ready');
  const active = orders.filter((o) => o.status === 'new' || o.status === 'preparing');

  ready.sort((a, b) => new Date(a.readyAt || a.createdAt) - new Date(b.readyAt || b.createdAt));
  active.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  readyEl.innerHTML = ready.length === 0
    ? `<div class="empty-state"><h3>Nothing ready yet.</h3><p>Ready tickets show up here automatically.</p></div>`
    : ready.map((o) => ticketHtml(o, { serverAction: true })).join('');

  flightEl.innerHTML = active.length === 0
    ? `<div class="empty-state"><h3>Kitchen idle.</h3><p>No tickets in progress.</p></div>`
    : active.map((o) => ticketHtml(o, { serverAction: false })).join('');

  renderCancelled();

  readyEl.querySelectorAll('button[data-action="serve"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.send({ type: 'update_status', id: btn.dataset.id, status: 'served' });
    });
  });
}

function renderCancelled() {
  const now = Date.now();
  for (const [id, entry] of cancelledRecent) {
    if (entry.expiresAt <= now) cancelledRecent.delete(id);
  }
  const list = [...cancelledRecent.values()]
    .map((e) => e.order)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (list.length === 0) {
    cancelledHeading.style.display = 'none';
    cancelledEl.style.display = 'none';
    cancelledEl.innerHTML = '';
    return;
  }
  cancelledHeading.style.display = '';
  cancelledEl.style.display = '';
  cancelledEl.innerHTML = list.map((o) => ticketHtml(o, { cancelled: true })).join('');
}

socket.on('updated', (order) => {
  if (order.status !== 'cancelled') return;
  const wasKnown = cancelledRecent.has(order.id);
  cancelledRecent.set(order.id, {
    order,
    expiresAt: Date.now() + CANCELLED_LINGER_MS,
  });
  if (!wasKnown) {
    toast(`Cancelled: ${order.id}`, { error: true });
  }
  renderCancelled();
});

// Sweep expired cancellations once a second so they fade on their own even
// when nothing else is updating the page.
setInterval(renderCancelled, 1000);

registerTicker(() => {
  document.querySelectorAll('.ticket-timer[data-since]').forEach((el) => {
    el.textContent = fmt.elapsed(el.dataset.since);
  });
});

socket.on('sync', render);
