/* Kitchen Display — shows every "new" and "preparing" ticket, sorted by priority.
   One tap advances a ticket:   new -> preparing -> ready. */

const { Socket, fmt, escapeHtml, registerTicker } = window.RestaurantOps;
const socket = new Socket();

const ticketsEl = document.getElementById('tickets');
const filtersEl = document.getElementById('channelFilters');
let channelFilter = 'all';

filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  filtersEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  channelFilter = btn.dataset.channel;
  render();
});

function priorityRank(p) {
  return { critical: 0, high: 1, normal: 2 }[p] ?? 3;
}

function render() {
  const active = socket.allOrders().filter((o) => o.status === 'new' || o.status === 'preparing');
  const filtered = channelFilter === 'all'
    ? active
    : active.filter((o) => o.channel === channelFilter);

  filtered.sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  if (filtered.length === 0) {
    ticketsEl.innerHTML = `
      <div class="empty-state">
        <h3>Line is clear.</h3>
        <p>New tickets will appear here the second they're entered.</p>
      </div>`;
    return;
  }

  ticketsEl.innerHTML = filtered.map(ticketHtml).join('');
  bindActions();
}

function ticketHtml(o) {
  const since = o.status === 'preparing' && o.startedAt ? o.startedAt : o.createdAt;
  const items = o.items.map((it) => `
    <li>
      <span class="qty">${it.quantity}×</span>
      <span class="item-name">
        ${escapeHtml(it.name)}
        ${it.notes ? `<span class="item-note">${escapeHtml(it.notes)}</span>` : ''}
      </span>
    </li>`).join('');

  const advanceBtn = o.status === 'new'
    ? `<button class="primary" data-action="start" data-id="${o.id}">Start cooking</button>`
    : `<button class="success" data-action="ready" data-id="${o.id}">Mark ready</button>`;

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
      <div class="ticket-actions">
        ${advanceBtn}
        <button class="danger" data-action="cancel" data-id="${o.id}">Cancel</button>
      </div>
    </article>`;
}

function bindActions() {
  ticketsEl.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const status = action === 'start' ? 'preparing'
                   : action === 'ready' ? 'ready'
                   : action === 'cancel' ? 'cancelled'
                   : null;
      if (status) socket.send({ type: 'update_status', id, status });
    });
  });
}

// Tick timers every second — keeps elapsed display live without spamming the
// server. Priority upgrades still ride on the 15s server tick.
registerTicker(() => {
  document.querySelectorAll('.ticket-timer[data-since]').forEach((el) => {
    el.textContent = fmt.elapsed(el.dataset.since);
  });
});

socket.on('sync', render);
