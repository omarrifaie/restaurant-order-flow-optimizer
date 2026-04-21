/* Manager Dashboard — live stats from /api/stats plus a recent-ticket log
   driven by the WebSocket stream. */

const { Socket, fmt, escapeHtml, registerTicker } = window.RestaurantOps;
const socket = new Socket();

const statsEl     = document.getElementById('stats');
const logEl       = document.getElementById('log');
const channelMix  = document.getElementById('channelMix');
const statusMix   = document.getElementById('statusMix');

const CHANNEL_COLORS = {
  'dine-in':  'var(--channel-dine)',
  online:     'var(--channel-online)',
  takeaway:   'var(--channel-take)',
};
const STATUS_COLORS = {
  new:        'var(--accent-cool)',
  preparing:  'var(--accent-warn)',
  ready:      'var(--accent-ok)',
  served:     'var(--text-muted)',
  cancelled:  'var(--accent-hot)',
};

async function refreshStats() {
  try {
    const res = await fetch('/api/stats');
    const s = await res.json();

    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="label">Active</div>
        <div class="value ${s.active > 10 ? 'warn' : ''}">${s.active}</div>
        <div class="sub">in queue or cooking</div>
      </div>
      <div class="stat-card">
        <div class="label">Late</div>
        <div class="value ${s.late > 0 ? 'hot' : 'ok'}">${s.late}</div>
        <div class="sub">past estimated prep</div>
      </div>
      <div class="stat-card">
        <div class="label">Total today</div>
        <div class="value">${s.total}</div>
        <div class="sub">all channels</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg resolution</div>
        <div class="value ok">${formatSec(s.avgResolutionSec)}</div>
        <div class="sub">create → served</div>
      </div>`;

    renderBars(channelMix, s.byChannel, CHANNEL_COLORS);
    renderBars(statusMix, s.byStatus, STATUS_COLORS);
  } catch (err) {
    console.error('stats failed', err);
  }
}

function renderBars(host, counts, colors) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  host.innerHTML = entries.map(([k, v]) => `
    <div class="channel-bar">
      <span class="name">${k.replace('-', ' ')}</span>
      <div class="track">
        <div class="fill" style="width: ${(v / max) * 100}%; background: ${colors[k] || 'var(--accent)'}"></div>
      </div>
      <span class="count">${v}</span>
    </div>`).join('');
}

function formatSec(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

function renderLog() {
  const all = socket.allOrders();
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const recent = all.slice(0, 40);

  if (recent.length === 0) {
    logEl.innerHTML = `<div class="empty-state"><h3>No tickets yet.</h3></div>`;
    return;
  }

  logEl.innerHTML = recent.map(logRowHtml).join('');
}

function logRowHtml(o) {
  const since = o.servedAt || o.readyAt || o.startedAt || o.createdAt;
  const statusColor = STATUS_COLORS[o.status] || 'var(--text-muted)';
  return `
    <div style="display:grid; grid-template-columns: 90px 110px 1fr 90px 70px; gap: 10px; align-items: center; padding: 10px 12px; background: var(--bg-elev-2); border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 13px;">
      <span style="font-family: var(--font-mono); font-weight: 700;">${o.id}</span>
      <span class="channel-badge ${o.channel === 'dine-in' ? '' : o.channel}">${fmt.channelLabel(o.channel)}</span>
      <span style="color: var(--text-muted);">
        ${fmt.customer(o)} ·
        <span style="color: var(--text-dim);">${o.items.length} item${o.items.length === 1 ? '' : 's'}</span>
      </span>
      <span style="font-family: var(--font-mono); font-weight: 600; color: ${statusColor}; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em;">
        ${o.status}
      </span>
      <span class="ticket-timer" data-since="${since}" style="text-align: right;">
        ${fmt.elapsed(since)}
      </span>
    </div>`;
}

registerTicker(() => {
  document.querySelectorAll('.ticket-timer[data-since]').forEach((el) => {
    el.textContent = fmt.elapsed(el.dataset.since);
  });
});

socket.on('sync', () => {
  renderLog();
  refreshStats();
});

// Also refresh stats on a slow interval as a safety net.
setInterval(refreshStats, 5000);
refreshStats();
