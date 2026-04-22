# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04

### Added
- Express + WebSocket server with in-memory order store.
- REST API mirror at `/api/orders` and `/api/stats` for integrations.
- Four dashboards:
  - **Order Entry** — create tickets across dine-in, online, and takeaway channels.
  - **Kitchen Display** — priority-sorted ticket queue, one-tap status advance.
  - **Front of House** — ready-to-run and in-flight sections for servers.
  - **Manager** — live stats, channel/status mix, and recent ticket log.
- Priority engine that re-ranks tickets based on elapsed vs. estimated prep time,
  with a 15-second server-side tick so cards escalate to *high* and *critical*
  even during idle stretches.
- Auto-reconnecting WebSocket client with exponential backoff.
