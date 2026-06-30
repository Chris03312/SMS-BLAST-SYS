# SRMC SMS Blast System — Quotation & Pricing

> **Prepared for:** Prospective Clients  
> **System Version:** 2.2  
> **Last Updated:** June 2026  
> **Developer:** SRMC Credit Collection Services / FlashSMS

---

## System Overview

The SRMC SMS Blast System is a complete bulk SMS broadcasting platform that uses **Android smartphones as GSM gateways** — no expensive hardware needed. Designed for credit collection agencies, it supports dual-SIM load balancing, real-time delivery tracking, role-based access control, and optional internet deployment via ngrok.

---

## Is This System Sellable?

**Yes.** Here's why:

| Strength | Advantage over competitors |
|----------|--------------------------|
| **Zero hardware cost** | Uses standard Android phones as SMS gateways, not expensive GOIP/GSM modems (₱15k–₱150k savings per channel) |
| **Pull-based protocol** | Works over any network — no public IP needed for phones. Competitors require LAN or static IPs |
| **Dual SIM** | Auto-detects both SIMs, round-robins messages across Globe/Smart — doubles capacity per phone |
| **Internet-ready** | Built-in ngrok support for demo/remote deployments |
| **Web-based dashboard** | Full admin panel with analytics, templates, gateways, activity log |
| **Role-based access** | Super Admin, Admin, Agent — suitable for teams |
| **Already deployed** | Running in production at SRMC Credit Collection Services |

**Target market:** Collection agencies, SMEs, barangay offices, coops, real estate,  marketingagencies, schools — any organization that needs to send 500–50,000 SMS/day.

---

## Pricing Tiers

All prices are in **Philippine Peso (₱)** and valid for on-premise deployments (client provides their own server or hosting).

### Tier 1: Lite — ₱15,000 (one-time)

| Feature | Included |
|---------|----------|
| **Server software** | Web platform + Docker deployment files |
| **Self-install** | Deployment guide + 1 hour remote setup support |
| **Android app** | 1 phone license (unbranded APK) |
| **Updates** | 3 months of updates |
| **Support** | Email support (48h response) |

**Best for:** Single-agent operations, small businesses testing the system.

---

### Tier 2: Standard — ₱35,000 (one-time)

| Feature | Included |
|---------|----------|
| **Server software** | Full web platform with all features |
| **Docker deployment** | Pre-configured Docker images + internet demo setup |
| **Android app** | Up to 5 phone licenses (unbranded APK) |
| **Custom branding** | Company logo + name on the web UI |
| **Support** | 6 months: email + video call setup |
| **Updates** | 6 months of updates |
| **Documentation** | Full deployment + operations manual |
| **Central server** | Optional monitoring server for multi-branch setup |

**Best for:** Small to medium agencies with 2–5 agents.

---

### Tier 3: Enterprise — ₱75,000 (one-time)

| Feature | Included |
|---------|----------|
| **Everything in Standard** | All of the above |
| **Android app** | Unlimited phone licenses |
| **On-site deployment** | 1 day on-site setup + training (within Metro Manila) |
| **Custom features** | Up to 40 hours of custom development |
| **API integration** | REST API access for external system integration |
| **White-label** | Full white-label (client's brand, no SRMC/FlashSMS references) |
| **Support** | 12 months: priority support (4h response) |
| **Updates** | 12 months of updates |
| **Source code access** | Full source code (JavaScript + Java) |

**Best for:** Large agencies, enterprises, or resellers.

---

### Tier 4: Enterprise + GOIP/Asterisk — ₱120,000 (one-time)

| Feature | Included |
|----------|----------|
| **Everything in Enterprise** | All of the above |
| **GOIP/Asterisk gateway** | Full integration with GOIP GSM gateways (1–32 channels) |
| **Hybrid mode** | Use Android phones + GOIP devices simultaneously |
| **SIP trunk support** | SMS via SIP trunk providers |
| **Custom channel management** | Load balancing across GOIP channels |
| **On-site deployment** | 2 days: server + GOIP device setup and testing |

**Best for:** Organizations with existing GOIP/Asterisk infrastructure wanting to add SMS broadcasting.

---

### Annual Maintenance (Optional — 20% of license fee/year)

| Feature | Included |
|----------|----------|
| Software updates | All feature updates and security patches |
| Technical support | Email + chat support during business hours |
| Priority bug fixes | Critical bugs addressed within 24 hours |
| Phone license renewals | Continued device activations |

---

## Cost Breakdown & ROI

### Scenario: Collection Agency with 5 Agents

| Item | Amount |
|------|--------|
| Standard license (one-time) | ₱35,000 |
| Android phones (5 × ₱3,000) | ₱15,000 |
| PC/server (mini PC or VPS) | ₱10,000–₱25,000 |
| **Total upfront investment** | **₱60,000–₱75,000** |
| Monthly SIM load (5 phones × 2 SIMs) | ₱5,000–₱15,000 |
| **vs. Third-party SMS API (₱0.35/SMS, 10,000/day)** | **₱105,000/month** |

**Payback period:** Less than 1 month vs. using paid SMS APIs at scale.

---

## What You're Buying

| Component | Description |
|-----------|-------------|
| **SRMC Web Platform** | Node.js + React web app with admin/agent dashboards, analytics, templates, broadcasts, gateway management, activity log, settings |
| **SRMC Android Gateway** | Java Android app installed on each phone — handles outbound SMS, inbound SMS forwarding, dual-SIM load balancing, heartbeat, delivery reports |
| **Docker Deployment** | Ready-to-deploy Docker images with nginx reverse proxy. Internet demo mode with ngrok support |
| **Database** | SQLite (zero-config, embedded). No separate database server needed |
| **Optional: Central Monitor** | Track multiple remote installations from one dashboard |

---

## Payment Terms

| Item | Terms |
|------|-------|
| **One-time license** | 50% downpayment, 50% on deployment completion |
| **Annual maintenance** | Due at start of each year |
| **Custom development** | ₱1,500/hour (quoted per feature) |
| **On-site deployment** | ₱5,000/day + transportation (outside Metro Manila) |

---

## What's Not Included

- **SIM cards and load** — Client provides their own SIMs
- **Android phones** — Client provides phones (recommended: any Android 8+ with dual SIM)
- **Server hardware** — Client provides server or VPS (min: 2GB RAM, 20GB storage)
- **Internet connection** — Client provides stable internet for the server
- **Custom features outside standard scope** — Quoted separately at ₱1,500/hour

---

## Contact

**SRMC Credit Collection Services**  
Developer: FlashSMS  
System: SRMC SMS Blast System v2.2  
Email: (contact SRMC for inquiries)

---

*This quotation is valid for 30 days from the date of issue. Prices may change based on scope changes or additional requirements.*
