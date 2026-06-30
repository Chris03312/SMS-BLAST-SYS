# SRMC SMS Blast System

**Capstone Project Document**

---

**Version:** 2.3  
**Organization:** SRMC Credit Collection Services  
**Platform:** Web Server + Android Gateway  
**Last Updated:** July 2026

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction](#2-introduction)
3. [Objectives](#3-objectives)
4. [System Architecture](#4-system-architecture)
5. [Technology Stack](#5-technology-stack)
6. [System Features](#6-system-features)
7. [System Design](#7-system-design)
   - 7.1 [Component Interaction Diagram](#71-component-interaction-diagram)
   - 7.2 [Database Schema](#72-database-schema)
   - 7.3 [API Endpoints](#73-api-endpoints)
   - 7.4 [User Roles & Access Matrix](#74-user-roles--access-matrix)
8. [Communication Protocol](#8-communication-protocol)
   - 8.1 [Pull Mode (Remote Gateways)](#81-pull-mode-remote-gateways)
   - 8.2 [Push Mode (LAN Gateways)](#82-push-mode-lan-gateways)
   - 8.3 [Dual SIM Round-Robin](#83-dual-sim-round-robin)
9. [Deployment Guide](#9-deployment-guide)
   - 9.1 [Docker Deployment](#91-docker-deployment)
   - 9.2 [Local Development](#92-local-development)
   - 9.3 [Android Gateway Setup](#93-android-gateway-setup)
10. [Security](#10-security)
11. [Known Limitations](#11-known-limitations)
12. [Conclusion](#12-conclusion)

---

## 1. Abstract

The SRMC SMS Blast System is a full-stack bulk SMS broadcasting platform designed for credit collection agencies operating in the Philippines. The system addresses the limitations of traditional SMS gateways (GSM modems, hardware gateways) by repurposing standard Android smartphones as SMS gateways.

Each Android phone runs a custom app (SRMCGateway) that intercepts incoming SMS, sends outgoing SMS via the phone's dual SIM slots, and communicates with a central web server. The system supports two operational modes — **push** (LAN, local WiFi) and **pull** (remote, cellular network) — making it viable for field operations where phones are distributed across multiple locations with no fixed infrastructure.

The platform includes a web-based admin dashboard for managing agents, gateways, templates, broadcasts, and analytics, along with a role-based access control system (Super Admin, Admin, Agent).

---

## 2. Introduction

### Background

Credit collection agencies in the Philippines rely heavily on SMS notifications to reach debtors. Traditional approaches use:

- **GSM modems** — expensive, limited to a single SIM, requires a computer per modem
- **Third-party SMS APIs** — per-message costs add up quickly at scale
- **Shortcodes** — expensive to maintain, regulatory overhead

The SRMC system takes a different approach: use standard Android phones as the SMS hardware. Every Android phone has built-in SMS capabilities, dual SIM support, and is far cheaper than dedicated GSM hardware.

### Problem Statement

1. **Connectivity** — Android phones on cellular networks have no public IP, making it impossible for a central server to push messages to them directly.
2. **Dual SIM utilization** — Most collection phones have two SIMs (Globe + Smart, or prepaid combos) but no easy way to load-balance across them.
3. **Delivery tracking** — Knowing whether an SMS was actually delivered (vs. just "sent") is critical for collections workflows.
4. **Scalability** — The system must support multiple agents, each with their own phone, all reporting to a single central server.

### Proposed Solution

A two-component system:

- **SRMCPlatform**: Node.js web server with a React admin dashboard, SQLite database, and WebSocket-based real-time updates.
- **SRMCGateway**: Android app installed on each phone that acts as the SMS transceiver.

The two communicate via a pull-based protocol — the phone asks the server for work every 5 seconds, eliminating the need for the phone to have a public IP.

---

## 3. Objectives

### General Objective

To design and develop a scalable SMS broadcast system that uses Android smartphones as gateways, enabling cost-effective, trackable bulk SMS sending for credit collection operations.

### Specific Objectives

1. **Build a web-based admin platform** allowing Super Admins to manage agents, campaigns, templates, gateways, and monitor broadcasts in real-time.
2. **Develop an Android gateway app** that can send SMS through both SIM slots, receive inbound SMS and forward them to the server, and report delivery status.
3. **Implement a pull-based outbound protocol** so phones on mobile networks (no public IP) can still receive and send queued messages.
4. **Provide real-time analytics** including sent/failed counts, delivery rates, per-gateway performance, and historical trends.
5. **Implement role-based access control** with Super Admin, Admin, and Agent roles.

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SRMCPlatform (Server)                        │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Express.js  │  │  WebSocket   │  │    Broadcast Engine        │  │
│  │  API Server  │◄─┤  (ws)        │  │    (message dispatching)   │  │
│  │  Port 3001   │  │  Realtime    │  │                           │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────────┘  │
│         │                 │                       │                  │
│  ┌──────▼─────────────────▼───────────────────────▼───────────────┐  │
│  │                    SQLite Database (sql.js)                    │  │
│  │  users · gateways · broadcasts · messages · inbound · stats   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              React Frontend (Vite build)                      │   │
│  │  Admin Dashboard · Agent Dashboard · Login · Settings        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Optional: Ngrok Tunnel (for remote inbound SMS forwarding)  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
              │                           ▲
              │ HTTP/HTTPS                 │ HTTP/HTTPS
              ▼                           │
┌─────────────────────────┐    ┌──────────────────────────────┐
│   SRMCGateway (Android) │    │  SRMCGateway (Android)       │
│   Phone A (Remote)      │    │  Phone B (LAN)               │
│                         │    │                              │
│  ┌───────────────────┐  │    │  ┌───────────────────┐       │
│  │ OutboundPoller    │  │    │  │ NanoHTTPD Server  │       │
│  │ (Pulls msgs every │──┼────┼──┤ (Push mode,       │◄──────┼──┐
│  │  5 seconds)       │  │    │  │  Port 8088)       │       │  │
│  └───────────────────┘  │    │  └───────────────────┘       │  │
│  ┌───────────────────┐  │    │  ┌───────────────────┐       │  │
│  │ InboundSmsReceiver│──┼────┼──┤ FlashSmsSender    │       │  │
│  │ (Forwards SMS to  │  │    │  │ (Dual SIM SMS     │       │  │
│  │  server webhook)  │  │    │  │  via reflection)  │       │  │
│  └───────────────────┘  │    │  └───────────────────┘       │  │
│  ┌───────────────────┐  │    │                              │  │
│  │ FlashSmsSender    │  │    └──────────────────────────────┘  │
│  │ (Dual SIM SMS     │  │                                      │
│  │  via reflection)  │  │                                      │
│  └───────────────────┘  │                                      │
└─────────────────────────┘                                      │
                                                                  │
┌─────────────────────────────────────────────────────────────────┘
│  Optional: Central Monitoring Server (Port 4000)
│  Aggregates stats from multiple remote SRMCPlatform installations
└──────────────────────────────────────────────────────────────────
```

---

## 5. Technology Stack

### SRMCPlatform (Server)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 18+ | Server-side JavaScript runtime |
| **Web Framework** | Express.js | HTTP API server |
| **Database** | SQLite via sql.js | Embedded WASM-based SQLite (zero native deps) |
| **Realtime** | ws (WebSocket) | Live broadcast progress, gateway status updates |
| **Frontend** | React 18 + Vite | Admin and Agent dashboards |
| **CSS** | Custom design tokens | Themed UI components |
| **Auth** | JWT (jsonwebtoken) + bcryptjs | Token-based authentication |
| **Docker** | Multi-stage Dockerfile + Docker Compose | Containerized deployment |
| **Reverse Proxy** | Nginx (Docker) | SSL termination, static file serving |

### SRMCGateway (Android)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Language** | Java 11 | Android application logic |
| **Min SDK** | API 21 (Android 5.0) | Broad device compatibility |
| **Target SDK** | API 34 (Android 14) | Latest features and security |
| **HTTP Server** | NanoHTTPD | Embedded lightweight server for push mode |
| **JSON** | Gson | JSON parsing |
| **SMS** | Android SmsManager + Reflection | Flash SMS (Class 0) via hidden `sendRawPdu` |
| **Foreground Service** | GatewayService | Persistent background operation |

---

## 6. System Features

### Web Platform

| Feature | Description | Roles |
|---------|-------------|-------|
| **Dashboard** | Overview of sent/failed messages, active gateways, daily stats | Admin, Agent |
| **Broadcast Composer** | Send bulk SMS with recipient list, gateway selection, delay config, turbo mode | Agent |
| **Campaign Management** | Group broadcasts under campaigns with status tracking | Admin |
| **SMS Templates** | Reusable message templates with variable support | Admin, Agent |
| **Gateway Management** | View/Add/Edit/Delete gateway devices, monitor online status | Admin |
| **Inbound Messages** | View incoming SMS replies with auto-flagging (STOP → opt-out) | Admin, Agent |
| **Analytics** | Historical charts by day/week/month/year, per-user/per-gateway breakdown. Export as multi-sheet Excel (.xlsx) with sheets: Period Breakdown, By Campaign, By Agent, By Gateway — gateway sheet includes both SIM numbers | Admin |
| **Activity Log** | Full audit trail of all system actions | Admin, Agent |
| **Agent/Admin Management** | Create and manage user accounts with role assignment | Super Admin |
| **Settings** | Sending window, daily caps, ngrok tunnel, timezone, concurrent limits | Admin |

### Android Gateway

| Feature | Description |
|---------|-------------|
| **Outbound SMS** | Send regular SMS via both SIM slots with round-robin load balancing |
| **Flash SMS** | Class 0 flash messages (popup, not saved) via hidden Android `sendRawPdu` API |
| **Inbound SMS Interception** | Forward all incoming SMS to the server via webhook |
| **Pull-based Outbound** | Poll server every 5 seconds for queued messages to send |
| **Delivery Reporting** | Report carrier delivery status back to the server |
| **Heartbeat** | Notify server of online status every 60 seconds |
| **Dual SIM Detection** | Auto-detect both SIM slots and alternate between them |
| **Foreground Service** | Runs persistently even when app is closed or phone is locked |
| **Auto-restart** | Restarts gateway service when app is swiped away |
| **Embedded HTTP Server** | Local server for push-mode operation on LAN |
| **Webhook Test** | Test inbound SMS forwarding directly from the phone UI |

---

## 7. System Design

### 7.1 Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          INTERACTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LOGIN FLOW                                                             │
│  ──────────                                                             │
│  Phone                    Server                                         │
│    │                        │                                            │
│    │── POST /api/auth/gateway/login ──►  │  Authenticate (username + pw) │
│    │◄── { user, inboundToken } ─────────│  Returns JWT token (30d)      │
│    │── GET  /api/config ────────────────►│  Fetch webhook URL            │
│    │◄── { INBOUND_WEBHOOK_URL } ────────│  Gets ngrok or LAN URL        │
│    │── POST /api/auth/gateway/online ──►│  Register as pull gateway     │
│    │◄── { success } ───────────────────│  Auto-creates gateway record   │
│                                                                         │
│  OUTBOUND FLOW (Pull Mode - repeats every ~5 seconds)                   │
│  ───────────────────────────────────────                                │
│  Phone                    Server                                         │
│    │                        │                                            │
│    │── GET /api/gateway/outbound?max=10 ──►│  Claim pending messages     │
│    │◄── { messages: [{id,to,message}] } ──│  Marks as 'sending'         │
│    │                                       │  (120s ACK timeout)        │
│    │  ┌──────────────────────┐             │                            │
│    │  │ Phone sends via SMS  │             │                            │
│    │  │ (SIM1 or SIM2)      │             │                            │
│    │  └──────────────────────┘             │                            │
│    │                                       │                            │
│    │── POST /api/gateway/outbound/ack ──►  │  Report send results       │
│    │── { results: [{id,status,sim_slot}] } │  Updates broadcast progress │
│    │◄── { acked: N } ─────────────────────│  Triggers onMessageAcked() │
│                                                                         │
│  INBOUND FLOW                                                           │
│  ────────────                                                           │
│  Phone                    Server                                         │
│    │                        │                                            │
│    │  SMS arrives from network                                          │
│    │  ┌──────────────────────┐                                          │
│    │  │ InboundSmsReceiver   │                                          │
│    │  │ intercepts SMS      │                                          │
│    │  └──────────────────────┘                                          │
│    │── POST /api/webhook/inbound ────────►│  Forward inbound SMS        │
│    │── { sender, message }               │  Auto-flag: STOP/YES/*     │
│    │── Authorization: Bearer <token>     │  Link to agent via lookup   │
│    │◄── { messageRecord } ───────────────│  Broadcast via WebSocket    │
│    │                        │            │  Store in inbound table     │
│                                                                         │
│  HEARTBEAT FLOW (Every 60 seconds)                                      │
│  ──────────────────────────────                                          │
│  Phone                    Server                                         │
│    │                        │                                            │
│    │── POST /api/auth/gateway/heartbeat ──►│  Keep gateway marked online │
│    │── { userId, sim_carrier }            │  Update SIM carrier info    │
│    │◄── { inbound_webhook_url } ──────────│  Return latest webhook URL │
│                                                                         │
│  DELIVERY REPORT FLOW (Carrier callback)                                │
│  ────────────────────────────────────────                                │
│  Phone                    Server                                         │
│    │                        │                                            │
│    │── POST /api/gateway/delivery-report ──►│  Carrier delivery status   │
│    │── { message_id, status, error }       │  Track delivery_fails      │
│    │◄── { success } ──────────────────────│  Alert on no-load SIMs     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Database Schema

The system uses a single SQLite database (`srmc.db`) with the following tables:

#### `users`
Stores all user accounts (agents, admins, super admins).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `username` | TEXT UNIQUE | Login username |
| `password_hash` | TEXT | bcrypt hash |
| `display_name` | TEXT | Human-readable name |
| `role` | TEXT | `super_admin`, `admin`, or `agent` |
| `active` | INTEGER | 1 = active, 0 = inactive |
| `created_at` | TEXT | ISO timestamp |

#### `gateways`
Stores Android phone gateway instances.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Gateway ID (same as user ID for self-registered) |
| `name` | TEXT | Display name |
| `url` | TEXT | HTTP URL (empty for pull gateways) |
| `token` | TEXT | API bearer token for push auth |
| `sim_carrier` | TEXT | SIM 1 carrier name (e.g. "Globe") |
| `sim2_carrier` | TEXT | SIM 2 carrier name (e.g. "Smart") |
| `status` | TEXT | `online`, `offline`, `slow`, `unknown` |
| `last_beat` | TEXT | Last heartbeat timestamp |
| `last_online` | TEXT | Last online timestamp |
| `last_poll` | TEXT | Last outbound poll timestamp |
| `device_info` | TEXT | Android model + OS version |
| `mode` | TEXT | `push` (LAN) or `pull` (remote) |
| `number` | TEXT | SIM 1 phone number |
| `number2` | TEXT | SIM 2 phone number |
| `sent_today` | INTEGER | Messages sent today |
| `consecutive_fails` | INTEGER | Consecutive send failures |
| `delivery_fails` | INTEGER | Consecutive delivery failures |
| `turbo_enabled` | INTEGER | Turbo mode allowed |
| `active` | INTEGER | 1 = active, 0 = disabled |
| `created_at` | TEXT | ISO timestamp |

#### `messages`
Individual SMS message records (one per recipient).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `broadcast_id` | TEXT | FK to broadcasts |
| `to_number` | TEXT | Recipient phone number |
| `message` | TEXT | SMS body |
| `status` | TEXT | `queued`, `pending`, `sending`, `sent`, `failed`, `delivered` |
| `error` | TEXT | Error message if failed |
| `gateway_id` | TEXT | FK to gateways |
| `sent_at` | TEXT | When the message was sent |
| `created_at` | TEXT | When the message was created |

#### `broadcasts`
Bulk send operations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `agent_id` | TEXT | FK to users (who created) |
| `campaign_id` | TEXT | FK to campaigns |
| `template_id` | TEXT | FK to templates |
| `message` | TEXT | SMS body |
| `recipients` | TEXT | JSON array of phone numbers |
| `gateway_ids` | TEXT | JSON array of gateway IDs |
| `distribution` | TEXT | `round-robin` or distribution mode |
| `total` | INTEGER | Total recipients |
| `sent` | INTEGER | Sent count |
| `failed` | INTEGER | Failed count |
| `status` | TEXT | `pending`, `sending`, `paused`, `done`, `cancelled`, `failed` |
| `delay_ms` | INTEGER | Delay between messages |
| `started_at` | TEXT | When broadcast started |
| `completed_at` | TEXT | When broadcast completed |
| `created_at` | TEXT | ISO timestamp |

#### `inbound`
SMS messages received from external senders (replies).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `from_number` | TEXT | Sender's phone number |
| `body` | TEXT | Message content |
| `flag` | TEXT | `opt-out`, `confirmed`, `needs-reply`, `unread` |
| `agent_id` | TEXT | Linked agent (via broadcast lookup) |
| `read_at` | TEXT | When marked as read |
| `created_at` | TEXT | ISO timestamp |

#### Other tables

| Table | Description |
|-------|-------------|
| `gateway_tokens` | JWT token store for gateway authentication |
| `campaigns` | Broadcast grouping and organization |
| `templates` | Reusable SMS message templates |
| `activity` | Audit log of all system actions |
| `settings` | Key-value configuration store |
| `remote_installations` | Central monitoring: remote server instances |
| `remote_stats_snapshots` | Central monitoring: historical stats data |

### 7.3 API Endpoints

#### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | None | Web UI login |
| POST | `/api/auth/gateway/login` | None | Android gateway login |
| POST | `/api/auth/gateway/online` | None | Mark gateway online + SIM info |
| POST | `/api/auth/gateway/offline` | None | Mark gateway offline |
| POST | `/api/auth/gateway/heartbeat` | None | 60s heartbeat + SIM carrier |
| POST | `/api/auth/logout` | None | Gateway logout + revoke tokens |
| GET | `/api/auth/me` | JWT | Current user info |

#### Gateway Communication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/gateway/outbound?max=N` | Bearer (inbound token) | Claim pending messages |
| POST | `/api/gateway/outbound/ack` | Bearer (inbound token) | Report send results |
| POST | `/api/gateway/delivery-report` | Bearer (inbound token) | Carrier delivery status |

#### Inbound SMS

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/webhook/inbound` | Bearer (inbound token) or none | Receive SMS from Android |
| POST | `/api/webhook/inbound/:gatewayId` | None | Per-gateway webhook |
| POST | `/api/inbound` | Bearer (inbound token) or none | LAN fallback |
| GET | `/api/inbound` | JWT (admin/agent) | List inbound messages |
| PUT | `/api/inbound/:id` | JWT (admin/agent) | Mark read / update flag |
| POST | `/api/inbound/:id/reply` | JWT (admin/agent) | Reply to inbound SMS |

#### Broadcasts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/broadcasts` | JWT | List broadcasts |
| POST | `/api/broadcasts` | JWT | Create + start broadcast |
| GET | `/api/broadcasts/:id` | JWT | Broadcast details |
| POST | `/api/broadcasts/:id/cancel` | JWT | Cancel running broadcast |
| POST | `/api/broadcasts/:id/pause` | JWT | Pause broadcast |
| POST | `/api/broadcasts/:id/resume` | JWT | Resume broadcast |

#### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET/POST/PUT/DELETE | `/api/agents` | JWT (admin+) | Agent management |
| GET/PUT/DELETE | `/api/agents/admins` | JWT (super_admin) | Admin management |
| GET/POST/PUT/DELETE | `/api/gateways` | JWT (admin+) | Gateway management |
| GET/POST/PUT/DELETE | `/api/templates` | JWT | Template management |
| GET | `/api/stats` | JWT | Global stats |
| GET | `/api/stats/historical` | JWT (admin+) | Time-series analytics |
| GET | `/api/stats/user/stats/:userId` | None | Per-user stats (Android poll) |
| GET | `/api/activity` | JWT | Activity log |

#### System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/ping` | None | Server health check |
| GET | `/api/config` | None | Public configuration (webhook URL) |
| GET | `/api/server-info` | JWT | LAN IP addresses |
| GET | `/api/server/connectivity` | JWT | Internet + ngrok status |
| GET | `/health` | None | Docker health check |

### 7.4 User Roles & Access Matrix

| Feature | Super Admin | Admin | Agent |
|---------|:-----------:|:-----:|:-----:|
| Dashboard | ✅ | ✅ | ✅ |
| Create broadcasts | — | — | ✅ |
| View own broadcasts | — | — | ✅ |
| View all broadcasts | ✅ | ✅ | — |
| Manage templates | ✅ | ✅ | ✅ |
| Manage gateways | ✅ | ✅ | — |
| Manage agents | ✅ | ✅ | — |
| **Manage admins** | **✅** | **✗** | **✗** |
| View inbound messages | ✅ | ✅ | Own only |
| View activity log | ✅ | ✅ | Own only |
| Analytics | ✅ | ✅ | — |
| System settings | ✅ | ✅ | — |
| Ngrok management | ✅ | ✅ | — |
| View Admins tab | ✅ | ✗ | — |

---

## 8. Communication Protocol

### 8.1 Pull Mode (Remote Gateways)

Pull mode is the primary mode for phones deployed in the field (cellular network, no public IP).

**Lifecycle:**

```
1. AUTHENTICATION
   Phone → Server:  POST /api/auth/gateway/login
                     { userId, password }
   Server → Phone:  { user, inboundToken }
                     (JWT token valid for 30 days)

2. CONFIG
   Phone → Server:  GET  /api/config
   Server → Phone:  { INBOUND_WEBHOOK_URL, ...settings }

3. ONLINE REGISTRATION
   Phone → Server:  POST /api/auth/gateway/online
                     { userId, deviceInfo, sim_carrier, sim2_carrier }
   Server:          Auto-creates gateway record with mode='pull', url=''

4. OUTBOUND LOOP (every ~5 seconds)
   Phone → Server:  GET  /api/gateway/outbound?max=10
                     (Authorization: Bearer <inboundToken>)
   Server:          Claims up to 10 'pending' messages for this gateway
                     Marks them as 'sending' (with 120s ACK timeout)
   Server → Phone:  { messages: [{ id, to, message }] }

   Phone:           For each message:
                      - Select SIM slot (round-robin if dual SIM)
                      - Call FlashSmsSender to send via SMS
                      - Wait 1.2s between sends
   
   Phone → Server:  POST /api/gateway/outbound/ack
                     (Authorization: Bearer <inboundToken>)
                     { results: [{ id, status, sim_slot, error? }] }
   Server:          Updates message statuses (sent/failed)
                     Updates gateway sent_today counter
                     Triggers broadcast progress recomputation

5. HEARTBEAT (every 60 seconds)
   Phone → Server:  POST /api/auth/gateway/heartbeat
                     { userId, sim_carrier, sim2_carrier }
   Server:          Updates last_beat, sets status='online'
   Server → Phone:  { inbound_webhook_url, ... } (latest webhook URL)

6. INBOUND SMS (as received from network)
   Phone:           InboundSmsReceiver intercepts incoming SMS
   Phone → Server:  POST <webhook_url> (from /api/config or heartbeat)
                     (Authorization: Bearer <inboundToken>)
                     { sender, message }
   Server:          Validates token, looks up linked agent
                     Auto-flags: STOP→opt-out, YES→confirmed, else→needs-reply
                     Stores in inbound table, broadcasts via WebSocket

7. DELIVERY REPORT (carrier callback)
   Phone → Server:  POST /api/gateway/delivery-report
                     (Authorization: Bearer <inboundToken>)
                     { message_id, status, error, sim_slot }
   Server:          If 'delivery_failed': increments delivery_fails counter
                     If 'delivered': resets delivery_fails counter, marks as delivered
                     If 5+ consecutive failures: alerts admin
```

**ACK Timeout:** If a phone claims messages but never ACKs them (e.g., phone lost power), the server re-releases them after 120 seconds.

### 8.2 Push Mode (LAN Gateways)

Push mode is used when phones are on the same local WiFi network as the server.

```
1. Phone runs NanoHTTPD server on port 8088 (configurable)
2. Server health-checks: GET /api/health → { status: "ok" }
3. Server POSTs directly: POST /send → { to, message, flash }
4. Phone sends SMS and returns result

Server polls all push gateways every 30 seconds via gateway-poller.js
```

### 8.3 Dual SIM Round-Robin

The Android gateway supports dual SIM operation with automatic load balancing:

```
Configuration:
  - Both SIMs are auto-detected via Android SubscriptionManager
  - SIM 1 → slot 0, SIM 2 → slot 1
  - Carriers stored in prefs for server-side display

Sending:
  Poll 1: SIM1 → message A
  Poll 2: SIM2 → message B
  Poll 3: SIM1 → message C
  ...

Each message is sent independently, with sim_slot (1 or 2) reported
in the ACK so the server tracks which SIM sent what.
```

---

## 9. Deployment Guide

### 9.1 Docker Deployment

**Prerequisites:** Docker and Docker Compose installed.

```bash
# From the monorepo root (srmc-platform):
docker compose -f apps/web/docker-compose.yml up -d --build

# Set environment variables (optional, via .env file):
#   ADMIN_PASSWORD   - Set a known admin password on every launch
#   NGROK_AUTHTOKEN  - Auto-open ngrok tunnel for inbound SMS
#   NGROK_URL        - Or use a fixed public URL
#   PORT             - Server port (default 3001)
#   JWT_SECRET       - JWT signing secret (auto-generated if blank)

# Access the web UI:
#   http://localhost:8080 (via Nginx)
#   http://localhost:3001 (direct to Express)
```

**Docker Compose Services:**

| Service | Description | Port |
|---------|-------------|------|
| `srmc-nginx` | Reverse proxy + static file serving | 8080 (host) → 80 |
| `srmc-web` | Express API + React frontend | 3001 (internal) |
| `srmc-central` | Optional monitoring server | 4000 |

**Data persistence:** Both services use named Docker volumes (`srmc-web-data`, `srmc-central-data`) mounted at `/data` inside the containers.

### 9.2 Local Development

```bash
# Install dependencies
npm install

# Build the React frontend
npm run client:build

# Start the web server
npm start
# → http://localhost:3001

# Or run with Vite dev server for live UI development
npm run client:dev    # Vite on port 5173 (proxies /api to :3001)
```

### 9.3 Android Gateway Setup

1. Open the `SRMCGateway` folder in Android Studio
2. Run `SETUP.bat` to copy the Gradle wrapper JAR (Windows), or:
   ```bash
   cd SRMCGateway
   gradle wrapper --gradle-version 8.2
   ```
3. Build and install the APK on the Android phone
4. Open the app — it launches the Login screen
5. Configure the server address (Settings gear icon):
   - **IP:** Server IP address or ngrok URL (e.g., `https://xxx.ngrok-free.app`)
   - **Port:** Server port (default `3001`)
6. Log in with an agent account created on the admin dashboard
7. Press **Start** to begin the gateway service

**Required permissions (granted on first launch):**
- SEND_SMS
- RECEIVE_SMS
- READ_SMS
- READ_PHONE_STATE
- POST_NOTIFICATIONS (Android 13+)

---

## 10. Security

### Authentication

| Mechanism | Location | Details |
|-----------|----------|---------|
| **Web login** | Express + JWT | Username + password → 24h JWT token |
| **Gateway login** | Express + JWT | Agent username + password → 30d JWT token |
| **Inbound webhook** | JWT in Bearer header | Token verified on every inbound SMS forward |
| **Phone's HTTP server** | API key | Configurable token, local network only |

### Data Protection

- **Passwords:** bcrypt hash (10 salt rounds), never stored in plaintext
- **JWT Secret:** Auto-generated 64-byte random hex, persisted to `secrets.json`
- **Webhook Secret:** Auto-generated on first run
- **Database:** Local SQLite file (not exposed over network)
- **Admin Password:** Can be set via `ADMIN_PASSWORD` env var (recommended for Docker)

### Access Control

- Role-based middleware (`adminOnly`, `superAdminOnly`) on all protected routes
- Agents can only see their own broadcasts and linked inbound messages
- Admin tab and admin management hidden from non-super_admin users
- Super admin toggle/delete buttons disabled for the last remaining super admin

---

## 11. Known Limitations

1. **Flash SMS dependency on hidden API** — Class 0 flash SMS uses `sendRawPdu` via Java reflection. This relies on Android's internal API and may break on OS updates. Falls back to regular SMS if reflection fails.

2. **Delivery reports are unreliable** — Many Philippine carriers do not send delivery reports or only send them for specific traffic types. The system handles this gracefully (assumes "sent" means delivered) but tracking is best-effort.

3. **Pull gateway reply** — Replying to inbound messages through a pull gateway works by queuing the reply in the `messages` table. The phone will pick it up on its next poll cycle (up to 5 second delay).

4. **No end-to-end encryption** — SMS is inherently not encrypted. Messages are stored in plaintext in the SQLite database. For sensitive collections data, consider using the system on trusted networks only.

5. **ngrok free tier limits** — The free ngrok tier has a 40 connections/minute rate limit and the tunnel URL changes on restart. The paid tier or a fixed public URL is recommended for production.

---

## 12. Conclusion

The SRMC SMS Blast System successfully demonstrates that standard Android smartphones can serve as cost-effective, scalable SMS gateways for credit collection operations. The key innovation is the **pull-based outbound protocol** that eliminates the need for phones to have public IP addresses — a critical requirement for phones operating on Philippine cellular networks.

The dual SIM round-robin feature maximizes the value of each phone by utilizing both SIM slots, effectively doubling the sending capacity without additional hardware. The real-time dashboard, delivery tracking, and role-based access control provide the operational visibility and control needed for a professional collections workflow.

The system is production-ready with Docker deployment support, and the modular architecture allows for future enhancements such as:
- Integration with third-party SMS APIs as a fallback
- Webhook callbacks for external system integration
- Advanced campaign scheduling and automation
- Mobile data optimization for large-scale deployments

---

*Document generated for SRMC Credit Collection Services.*
