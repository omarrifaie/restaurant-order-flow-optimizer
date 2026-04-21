/* Front of House — two sections:
   - "Ready to run"   tickets the kitchen finished; server closes them out
   - "In the kitchen" still cooking, shown read-only so FOH can manage tables */

const { Socket, fmt, escapeHtml, registerTicker } = window.RestaurantOps;
const socket = new Socket();

const readyEl = document.getElementById('ready');
const flightEl = document.getElementById('inFlight');

function ticketHtml(o, { serverAction }) {
  const since = o.readyAt || o.startedAt || o.createdAt;
  const items = o.items.map((it) => `
    <li>
      <span class="qty">${it.quantity}×</span>
      <span class="item-name">${escapeHtml(it.name)}</span>
    </li>`).join('');

  return `
    <article class="ticket priority-${o.priority}" data-id="${o.id}">
      <header class="ticket-header">
        <span class="ticket-id">${o.id}</span>
        <span class="ticket-timer" data-since="${since}">${fmt.elapsed(since)}</span>
      </header>
      <div class="ticket-meta">
        <span class="channel-badge ${o.channel === 'dine-in' ? '' : o.channel}">${fmt.channelLabel(o.channel)}</span>
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

  readyEl.querySelectorAll('button[data-action="serve"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.send({ type: 'update_status', id: btn.dataset.id, status: 'served' });
    });
  });
}

registerTicker(() => {
  document.querySelectorAll('.ticket-timer[data-since]').forEach((el) => {
    el.textContent = fmt.elapsed(el.dataset.since);
  });
});

socket.on('sync', render);
