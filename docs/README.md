# Restaurant Order Flow Optimizer

![Node.js](https://img.shields.io/badge/node-%3E%3D18-3ddc84?logo=node.js&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-ff7a3d)
![Built with](https://img.shields.io/badge/built%20with-Express%20%2B%20ws-4c9fff)

> *Note: This repository is a cleaned-up portfolio rebuild of an internal tool I originally developed at El Senor de Los Tacos in 2024.*

A real-time order dashboard for a multi-channel restaurant operation.
Built with Node.js, Express, and WebSockets to keep the kitchen and the
front of house in sub-second sync across **dine-in**, **online**, and
**takeaway** tickets.

![Order Flow Optimizer — kitchen display and manager dashboard](docs/screenshot.gif)

---

## Why

In a busy restaurant, miscommunication between FOH and the kitchen is
expensive as tickets get lost, hot plates sit under the heat lamp, and
servers don't know what's ready. This project centralizes every order
into one live feed with three views:

- **Kitchen Display (KDS)** - sorts tickets by priority, highlights
  late ones in red, and lets the line advance them with one tap.
- **Front of House** - shows what's ready to run and what's still
  cooking, so servers can set table expectations.
- **Manager** - live counts, channel mix, average ticket resolution
  time, and the full log of what's moved through the line.

Plus an **Order Entry** screen that simulates the POS feeding tickets
into the stream.

---

## Architecture

```
┌────────────────────┐          WebSocket broadcast
│  Order Entry page  │  ───┐   ┌──────────────────────────┐
├────────────────────┤     │   │                          │
│  Kitchen Display   │  ───┼──▶│  Express + ws server     │
├────────────────────┤     │   │  (server.js)             │
│  Front of House    │  ───┤   │                          │
├────────────────────┤     │   │  ● in-memory order store │
│  Manager Dashboard │  ───┘   │  ● REST mirror at /api   │
└────────────────────┘         │  ● priority re-rank tick │
                               └──────────────────────────┘
```

- **Transport:** WebSocket (`ws` library) for push, REST for integrations.
- **Storage:** in-memory `Map` - swap for Redis/Postgres without
  touching the UI.
- **Priority:** derived on every read from elapsed time vs. the ticket's
  estimated prep. Re-broadcast every 15 s so cards tick into *high* and
  *critical* even when nothing else is happening.

---

## Running locally

Requires Node.js 18 or newer.

```bash
cd restaurant-order-flow-optimizer
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

For the full experience, open each dashboard in its own tab or window
so you can see the WebSocket sync in action:

- `/` - landing page with navigation
- `/order-entry.html` - create tickets
- `/kitchen.html` - kitchen display
- `/foh.html` - front of house
- `/manager.html` - live metrics

Click **Fill sample** on the Order Entry page a few times, then watch
the tickets appear on every other screen instantly.

---

## REST API

All WebSocket events are mirrored over REST, which makes it easy to
drop in third-party POS integrations or run smoke tests with `curl`.

| Method | Path                | Purpose                              |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/api/orders`       | List orders (filter by channel/status) |
| POST   | `/api/orders`       | Create a new order                   |
| PATCH  | `/api/orders/:id`   | Update an order's status             |
| GET    | `/api/stats`        | Live aggregate stats for the manager view |

Example:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "takeaway",
    "customerName": "Maria G.",
    "items": [
      { "name": "Al pastor tacos", "quantity": 3, "prepTimeMinutes": 8 }
    ]
  }'
```

---

## File layout

```
restaurant-order-flow-optimizer/
├── package.json
├── server.js              Express + WebSocket server, order store, priority logic
├── README.md
└── public/
    ├── index.html         Landing page
    ├── order-entry.html   Order creation form
    ├── kitchen.html       Kitchen display system (KDS)
    ├── foh.html           Front-of-house status board
    ├── manager.html       Live metrics and ticket log
    ├── styles.css         Shared dark-theme KDS styles
    └── js/
        ├── shared.js      WebSocket client + formatters
        ├── order-entry.js
        ├── kitchen.js
        ├── foh.js
        └── manager.js
```

---

## What's next

Ideas for when this moves from a portfolio project to something you'd
actually deploy:

- Persist orders in Postgres or Redis so a server restart doesn't wipe
  the line.
- Auth: a simple JWT layer so only kitchen/FOH/manager roles can take
  specific actions (this is the shape of the `Menu Management API`
  project already).
- Print-to-kitchen-ticket via ESC/POS.
- Prep-time learning: adjust each item's estimated prep time based on
  how long it actually took over the last N tickets.

---

Built by Omar Rifaie - [github.com/omarrifaie](https://github.com/omarrifaie) · [linkedin.com/in/omar-rifaie-](https://linkedin.com/in/omar-rifaie-)
