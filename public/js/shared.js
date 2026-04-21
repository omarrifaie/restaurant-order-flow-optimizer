/**
 * Shared WebSocket client for every dashboard page.
 * Handles auto-reconnect, snapshot hydration, and message routing so each
 * page only has to implement a handful of event callbacks.
 */

(function () {
  const MAX_BACKOFF = 5000;

  class OrderSocket {
    constructor() {
      this.listeners = {};
      this.orders = new Map(); // id -> decorated order
      this.ws = null;
      this.reconnectDelay = 500;
      this._connect();
      this._renderConnection('connecting');
    }

    on(event, cb) {
      (this.listeners[event] = this.listeners[event] || []).push(cb);
      return this;
    }

    emit(event, data) {
      (this.listeners[event] || []).forEach((cb) => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }

    send(message) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      } else {
        console.warn('WebSocket not open; queueing not implemented.');
      }
    }

    _connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws`;
      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => {
        this.reconnectDelay = 500;
        this._renderConnection('live');
      });

      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this._route(msg);
      });

      this.ws.addEventListener('close', () => {
        this._renderConnection('offline');
        setTimeout(() => this._connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(MAX_BACKOFF, this.reconnectDelay * 1.7);
      });

      this.ws.addEventListener('error', () => {
        try { this.ws.close(); } catch {}
      });
    }

    _route(msg) {
      if (msg.type === 'snapshot') {
        this.orders.clear();
        for (const o of msg.orders) this.orders.set(o.id, o);
        this.emit('sync');
      } else if (msg.type === 'order_created') {
        this.orders.set(msg.order.id, msg.order);
        this.emit('sync');
        this.emit('created', msg.order);
      } else if (msg.type === 'order_updated') {
        this.orders.set(msg.order.id, msg.order);
        this.emit('sync');
        this.emit('updated', msg.order);
      } else if (msg.type === 'priority_tick') {
        for (const o of msg.orders) this.orders.set(o.id, o);
        this.emit('sync');
      } else if (msg.type === 'error') {
        this.emit('serverError', msg.message);
      }
    }

    _renderConnection(state) {
      const el = document.querySelector('.connection');
      if (!el) return;
      el.classList.toggle('offline', state === 'offline');
      const label = el.querySelector('.state');
      if (label) {
        label.textContent =
          state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
      }
    }

    allOrders() {
      return [...this.orders.values()];
    }
  }

  // --- formatting helpers --------------------------------------------------
  const fmt = {
    elapsed(isoFrom) {
      const start = new Date(isoFrom).getTime();
      const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    },
    channelLabel(ch) {
      return ({ 'dine-in': 'DINE-IN', online: 'ONLINE', takeaway: 'TAKEAWAY' })[ch] || ch;
    },
    customer(order) {
      if (order.channel === 'dine-in' && order.tableNumber) {
        return `Table <strong>${order.tableNumber}</strong>`;
      }
      if (order.customerName) return `<strong>${escapeHtml(order.customerName)}</strong>`;
      return '<span style="color: var(--text-dim)">—</span>';
    },
    statusLabel(s) {
      return s.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    },
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function toast(msg, { error = false } = {}) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('error', error);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // Re-render elapsed timers every second so the ticket header stays live even
  // between server-pushed updates. Each page registers a tick callback.
  const tickers = new Set();
  setInterval(() => tickers.forEach((fn) => { try { fn(); } catch {} }), 1000);

  window.RestaurantOps = {
    Socket: OrderSocket,
    fmt,
    escapeHtml,
    toast,
    registerTicker: (fn) => tickers.add(fn),
  };
})();
