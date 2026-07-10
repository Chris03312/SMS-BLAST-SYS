# SRMC SMS Blast — Asterisk & GOIP Integration Guide

> **Purpose:** Connect the SRMC SMS Blast System to Asterisk PBX with GOIP GSM gateways for SMS sending and receiving alongside Android phones.  
> **Version:** 1.0  
> **Last Updated:** June 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [GOIP SMS API Reference](#2-goip-sms-api-reference)
3. [Integrating with SRMC Server](#3-integrating-with-srmc-server)
4. [Inbound SMS from GOIP](#4-inbound-sms-from-goip)
5. [Asterisk SIP Trunk SMS](#5-asterisk-sip-trunk-sms)
6. [Hybrid Mode: Android + GOIP](#6-hybrid-mode-android--goip)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Overview

### What is GOIP?

GOIP (GSM Over IP) is a hardware device that connects physical SIM cards to your network. Typical models:

| Model | SIM Slots | Use Case |
|-------|-----------|----------|
| GOIP-1 | 1 SIM | Single line |
| GOIP-4 | 4 SIMs | Small office |
| GOIP-8 | 8 SIMs | Medium deployment |
| GOIP-16/32 | 16–32 SIMs | Large deployment |

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SRMC Server                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Express API  │  │  GOIP Bridge  │  │  Android Poll │  │
│  │  Port 3001    │  │  (goip.js)   │  │  Handler      │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
└─────────┼─────────────────┼───────────────────┼──────────┘
          │                 │                   │
          │          HTTP API             HTTPS (pull)
          ▼                 ▼                   ▼
   ┌──────────┐    ┌──────────────┐    ┌──────────────┐
   │ Browser  │    │ GOIP Device  │    │ Android Phone│
   │ (Web UI) │    │ (SIM 1-4)    │    │ (SIM 1+2)    │
   └──────────┘    └──────────────┘    └──────────────┘
```

### How GOIP SMS Works

- **Sending SMS:** POST/GET to the GOIP device's internal web server
- **Receiving SMS:** GOIP pushes incoming SMS via UDP to a configured listener, or you poll the device's inbox
- **Channel management:** Each SIM slot is a "channel" — you can only send one message at a time per channel

---

## 2. GOIP SMS API Reference

### 2.1 Default Credentials

| Setting | Default Value |
|---------|---------------|
| Web IP | `192.168.1.100` (check your router) |
| Web Port | `80` |
| Username | `admin` |
| Password | `admin` |

**⚠️ Change the default password immediately.** Do not expose the GOIP web interface to the internet — keep it on an isolated network.

### 2.2 Send SMS via HTTP

**Endpoint:**
```
GET http://{GOIP_IP}/default/en_US/send.html
     ?u={username}
     &p={password}
     &l={channel}
     &n={phone_number}
     &m={message_text}
```

**Parameters:**

| Param | Description | Example |
|-------|-------------|---------|
| `u` | Admin username | `admin` |
| `p` | Admin password | `admin` |
| `l` | SIM channel (1-based) | `1` |
| `n` | Destination number (international format) | `639178885555` |
| `m` | Message text (URL-encoded) | `Hello%20World` |

**Full example:**
```bash
curl "http://192.168.1.100/default/en_US/send.html?u=admin&p=admin&l=1&n=639178885555&m=Test%20message"
```

**Success response:**
```
Sending,L1 Send SMS to:639178885555; ID:12345
```

**Error responses:**

| Response | Meaning |
|----------|---------|
| `error 7` | Wrong username/password |
| `error 3` | Channel busy (already sending) |
| `error 0` | Device is starting up |
| `error 5` | Invalid phone number format |

### 2.3 Check SMS Status

**Endpoint:**
```
GET http://{GOIP_IP}/default/en_US/send_status.xml?u=admin&p=admin
```

**Response (XML):**
```xml
<Status>
  <Line Status="DONE" ID="12345" />
  <Line Status="SENDING" ID="12346" />
</Status>
```

| Status | Meaning |
|--------|---------|
| `DONE` | Message sent successfully |
| `SENDING` | Still being sent |
| `FAILED` | Sending failed |
| `WAITING` | Queued for sending |

### 2.4 Check SMS Balance / SIM Status

**Endpoint:**
```
GET http://{GOIP_IP}/default/en_US/gsm_status.xml?u=admin&p=admin
```

Shows GSM signal strength, operator, registration status per channel.

### 2.5 Receive SMS — UDP Push Method (Recommended)

Configure the GOIP device to forward incoming SMS:

1. Log in to the GOIP web interface
2. Go to **SMS Server Settings** (or **Tools > SMS Forwarding**)
3. Set:
   - **Server IP:** IP of your SRMC server
   - **Server Port:** `3002` (UDP)
   - **Protocol:** UDP
4. The GOIP will send incoming SMS as UDP packets to your server

**UDP packet format:**
```
FROM: +639178885555
TO: 639177773333
CONTENT: Hello, this is a reply
CHANNEL: 1
TIME: 2026/06/29 14:30:00
```

### 2.6 Receive SMS — Polling Method (Alternative)

If UDP push isn't available on your GOIP model, you can poll the inbox:

```
GET http://{GOIP_IP}/default/en_US/tools.html?type=sms_inbox
```

This returns HTML — you'd need to parse the table. Not recommended for production.

---

## 3. Integrating with SRMC Server

### 3.1 Node.js Bridge Script

Create a file at `packages/server/goip-bridge.js`:

```javascript
/**
 * goip-bridge.js — GOIP GSM Gateway integration for SRMC
 *
 * Sends outbound SMS through GOIP devices and receives
 * inbound SMS from GOIP UDP push.
 */

import dgram from 'dgram';
import fetch from 'node-fetch';
import db from './db.js';

const GOIP_CONFIG = {
  ip: process.env.GOIP_IP || '192.168.1.100',
  username: process.env.GOIP_USER || 'admin',
  password: process.env.GOIP_PASS || 'admin',
  channels: parseInt(process.env.GOIP_CHANNELS) || 4,
};

// Track channel availability
const channelBusy = new Array(GOIP_CONFIG.channels + 1).fill(false);

/**
 * Send an SMS through a GOIP channel.
 * Returns true if the device accepted the send request.
 */
export async function sendViaGoip(toNumber, message, channel) {
  const ch = channel || 1;
  const url =
    `http://${GOIP_CONFIG.ip}/default/en_US/send.html` +
    `?u=${GOIP_CONFIG.username}` +
    `&p=${GOIP_CONFIG.password}` +
    `&l=${ch}` +
    `&n=${encodeURIComponent(toNumber)}` +
    `&m=${encodeURIComponent(message)}`;

  try {
    const res = await fetch(url, { timeout: 8000 });
    const text = await res.text();
    if (text.includes('Sending')) {
      console.log(`[goip] ✅ Channel ${ch} sent to ${toNumber}: ${text}`);
      return true;
    }
    console.warn(`[goip] ❌ Channel ${ch} failed: ${text}`);
    return false;
  } catch (err) {
    console.error(`[goip] ❌ Channel ${ch} error: ${err.message}`);
    return false;
  }
}

/**
 * Find the first available (non-busy) channel.
 */
export function getAvailableChannel() {
  for (let i = 1; i <= GOIP_CONFIG.channels; i++) {
    if (!channelBusy[i]) return i;
  }
  return -1; // All channels busy
}

/**
 * Mark a channel as available again.
 */
export function releaseChannel(channel) {
  if (channel >= 1 && channel <= GOIP_CONFIG.channels) {
    channelBusy[channel] = false;
  }
}

/**
 * Start UDP listener for incoming SMS from GOIP.
 * Listen on port 3002 for UDP packets.
 */
export function startGoipUdpListener() {
  const server = dgram.createSocket('udp4');

  server.on('message', (msg, rinfo) => {
    const raw = msg.toString();
    console.log(`[goip] 📨 UDP from ${rinfo.address}:${rinfo.port}: ${raw}`);

    // Parse GOIP UDP format
    const from = extractField(raw, 'FROM');
    const content = extractField(raw, 'CONTENT');
    const channel = extractField(raw, 'CHANNEL');

    if (from && content) {
      // Store in inbound table
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO inbound (id, from_number, body, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).run(id, from, content);

      // Broadcast via WebSocket
      const { broadcast } = require('./ws.js');
      broadcast({
        type: 'inbound:new',
        inbound: {
          id,
          from_number: from,
          body: content,
          created_at: new Date().toISOString(),
        },
      });

      console.log(`[goip] ✅ Inbound stored: ${from} → ${content}`);
    }
  });

  server.bind(3002);
  console.log('[goip] 📡 UDP listener started on port 3002');
}

function extractField(raw, field) {
  const match = raw.match(new RegExp(`${field}:\\s*(.+)`));
  return match ? match[1].trim() : null;
}
```

### 3.2 Add GOIP Gateway to the Web UI

In the admin **Numbers** page (`packages/client/src/pages/admin/Numbers.jsx`), GOIP devices would appear alongside Android gateways. Each GOIP channel is listed as a separate "SIM slot" with its status (available/busy/failed).

### 3.3 Environment Variables

Add to your `.env` or `docker-compose.yml`:

```env
# GOIP Configuration
GOIP_IP=192.168.1.100
GOIP_USER=admin
GOIP_PASS=your-goip-password
GOIP_CHANNELS=4
```

---

## 4. Inbound SMS from GOIP

### 4.1 UDP Push Method (Recommended)

1. Configure your GOIP device:
   - SMS Server IP → your SRMC server IP
   - SMS Server Port → `3002`
   - Protocol → UDP
2. The bridge script (`goip-bridge.js`) listens on UDP port 3002
3. Incoming SMS is stored in the `inbound` table and shows up in the web UI

### 4.2 Webhook Method (Alternative)

If you prefer HTTP over UDP, create a webhook endpoint in the SRMC server:

**Endpoint:**
```
POST /api/webhook/goip/inbound
```

**Payload:**
```json
{
  "from": "639178885555",
  "message": "Test reply from GOIP",
  "channel": 1,
  "timestamp": "2026-06-29T14:30:00"
}
```

Then configure your GOIP (or an intermediate script) to POST to this endpoint instead of UDP.

---

## 5. Asterisk SIP Trunk SMS

### 5.1 What is SIP SMS?

Some SIP trunk providers support sending SMS via the SIP protocol using `MESSAGE` requests. This allows using the same trunk for both voice calls and SMS.

### 5.2 Sending SMS via Asterisk

```ini
; extensions.conf
; Send SMS via SIP trunk
[sms-outbound]
exten => _X.,1,Set(MESSAGE(text)="${MESSAGE}")
same => n,MESSAGE(from)="sms@your-domain.com"
same => n,MESSAGE(to)="sip:${EXTEN}@your-sip-provider.com"
same => n,SendMsg()
same => n,Hangup()
```

### 5.3 Receiving SMS via Asterisk

```ini
; extensions.conf
; Receive SMS from SIP trunk
[sms-inbound]
exten => sms,1,Set(payload="${MESSAGE(text)}")
same => n,Set(from="${CALLERID(num)}")
same => n,Post(http://localhost:3001/api/webhook/sip-inbound,{"from":"${from}","message":"${QUOTE(payload)}"})
same => n,Hangup()
```

This POSTs the incoming SMS to the SRMC server's webhook endpoint, where it's stored in the `inbound` table.

### 5.4 Provider Compatibility

| Provider | SIP MESSAGE Support | Notes |
|----------|---------------------|-------|
| Twilio Elastic SIP Trunk | ✅ Yes | Best-in-class SMS support |
| Plivo | ✅ Yes | SMS + Voice on same trunk |
| Local PH providers | ⚠️ Varies | Check with provider |

---

## 6. Hybrid Mode: Android + GOIP

The SRMC system can use **both** Android phones and GOIP devices simultaneously.

### Architecture

```
                    ┌──────────────────┐
                    │   SRMC Server    │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
         │ Android │   │ Android │   │  GOIP   │
         │ Phone 1 │   │ Phone 2 │   │ Device  │
         │ (pull)  │   │ (pull)  │   │ (HTTP)  │
         └─────────┘   └─────────┘   └─────────┘
```

### How it Works

1. **GOIP devices** are registered as gateways in the admin panel with `mode: 'goip'`
2. When distributing messages, the broadcast engine treats GOIP gateways like push gateways (server pushes to them via HTTP)
3. The bridge script handles channel allocation — it finds an available channel before sending
4. Inbound SMS from GOIP goes through UDP listener → stored in `inbound` table
5. **All messages** (Android + GOIP) appear in the same dashboard, analytics, and activity log

### Gateway Priority

Configure which gateways to use first in Settings:

```json
{
  "gateway_priority": ["goip", "android"],
  "goip_fallback": true
}
```

- `gateway_priority`: Which type to prefer (default: `["goip", "android"]`)
- `goip_fallback`: If all GOIP channels are busy, fall back to Android phones

---

## 7. Troubleshooting

| Problem | Likely Cause | Solution |
|---------|-------------|----------|
| `error 7` from GOIP | Wrong username/password | Check GOIP web interface credentials |
| `error 3` from GOIP | Channel busy | Wait 5s or select a different channel |
| No response from GOIP | Wrong IP address | Ping the GOIP device; check network |
| Inbound SMS not arriving | UDP port 3002 not open | Check firewall; verify GOIP SMS server config |
| SMS not sending (GOIP) | SIM has no load | Insert SIM in a regular phone to test |
| Channel stuck on "SENDING" | Message failed silently | Reboot GOIP device |
| Asterisk MESSAGE not working | Provider doesn't support SIP MESSAGE | Check with provider; fall back to HTTP API |

### Quick Test Commands

```bash
# Test GOIP reachability
ping 192.168.1.100

# Test GOIP SMS send
curl "http://192.168.1.100/default/en_US/send.html?u=admin&p=admin&l=1&n=639178885555&m=Test"

# Check GOIP channel status
curl "http://192.168.1.100/default/en_US/send_status.xml?u=admin&p=admin"

# Check GOIP GSM signal
curl "http://192.168.1.100/default/en_US/gsm_status.xml?u=admin&p=admin"
```

---

*This guide assumes basic familiarity with Asterisk PBX administration and network configuration. For GOIP-specific questions, consult your device's manual.*
