/**
 * Shared WebSocket client for every dashboard page.
 * Handles auto-reconnect, snapshot hydration, and message routing so each
 * page only has to implement a handful of event callbacks.
 */

(function () {
  const MAX_BACKOFF = 5000;
  const MAX_QUEUE = 50;

  class OrderSocket {
    constructor() {
      this.listeners = {};
      this.orders = new Map(); // id -> decorated order
      this.ws = null;
      this.reconnectDelay = 500;
      this.outbox = [];
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

    /**
     * Send a message to the server.
     *
     * If the socket isn't OPEN yet (initial handshake or mid-reconnect), the
     * message is buffered in an in-memory outbox and flushed on the next
     * 'open' event. The buffer is capped at MAX_QUEUE entries; once full, the
     * oldest message is dropped with a console warning so a long disconnect
     * can't grow the queue without bound.
     */
    send(message) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
        return;
      }
      if (this.outbox.length >= MAX_QUEUE) {
        const dropped = this.outbox.shift();
        console.warn('OrderSocket outbox full; dropping oldest message', dropped);
      }
      this.outbox.push(message);
    }

    _flushOutbox() {
      while (this.outbox.length && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const msg = this.outbox.shift();
        this.ws.send(JSON.stringify(msg));
      }
    }

    _connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws`;
      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => {
        this.reconnectDelay = 500;
        this._renderConnection('live');
        this._flushOutbox();
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
        // Forward any envelope-level correlation id alongside the order so a
        // submitter can match an ack to the request it just sent.
        if (msg.clientRequestId) msg.order.clientRequestId = msg.clientRequestId;
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
    /**
     * Returns a trusted HTML fragment describing the customer for a ticket
     * (table number, customer name, or em-dash placeholder).
     *
     * Contract: the return value is *trusted HTML*. Any user-controlled input
     * (e.g. customerName) is already escaped here, but the wrapper markup is
     * intentionally HTML — so this MUST only be assigned via `innerHTML` in
     * contexts where the surrounding markup is fully under our control. Do
     * not concatenate the result into attributes, URLs, or otherwise treat it
     * as plain text.
     *
     * @param {{channel: string, tableNumber?: string|number, customerName?: string}} order
     * @returns {string} HTML fragment safe for innerHTML use
     */
    customer(order) {
      if (order.channel === 'dine-in' && order.tableNumber) {
        return `Table <strong>${escapeHtml(order.tableNumber)}</strong>`;
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
