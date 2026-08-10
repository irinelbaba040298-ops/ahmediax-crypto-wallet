# Crypto Wallet Admin Panel

A standalone Node.js + Express crypto wallet admin panel with a dark theme. Supports EVM chains (Ethereum, BNB Chain, Polygon, Arbitrum, Optimism) and Bitcoin.

## Features

- **Admin Login** — Password-protected with bcrypt hashing and session-based auth
- **Wallet Management** — Generate new wallets or import from mnemonic/private key
- **Multi-chain Balances** — View balances across ETH, BNB, MATIC, Arbitrum, Optimism, and BTC
- **Price Tracking** — Top 50 coins from CoinGecko with auto-refresh every 30 seconds
- **Send Crypto** — Send transactions on any EVM chain with gas estimation
- **Receive** — QR code generation and address display per network
- **Portfolio Value** — Total USD value calculated from balances × live prices

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:
- `ADMIN_PASSWORD` — your admin password (stored in plaintext for first login, then auto-hashed)
- `SESSION_SECRET` — random string for session encryption
- `ETH_RPC_URL` — get a free key at https://infura.io or https://alchemy.com

### 3. Start the server

```bash
npm start
```

The app runs on `http://localhost:4000` by default.

## ⚠️ Security Warnings

> **THIS IS A DEMO APPLICATION — NOT FOR PRODUCTION USE WITH REAL FUNDS**

- **Private keys are stored in memory only.** They are lost when the server restarts.
- **Never use this with wallets containing real funds** unless you add proper encryption and persistent storage.
- In production:
  - Encrypt private keys with the user's password before storing
  - Use a proper database (PostgreSQL, etc.) for wallet storage
  - Add rate limiting, 2FA, and IP whitelisting
  - Run behind HTTPS with proper CORS configuration
  - Never log private keys or mnemonics
  - Add transaction confirmation for amounts over $100

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** Plain HTML + CSS + Vanilla JS
- **Crypto:** ethers.js v6 (EVM chains), Blockstream API (Bitcoin)
- **Prices:** CoinGecko public API
- **Auth:** bcryptjs + express-session
- **QR Codes:** qrcode library (server-side generation)

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/login | Verify admin password |
| POST | /api/logout | End session |
| GET | /api/wallet | Get/generate wallet |
| POST | /api/wallet/import | Import mnemonic or private key |
| GET | /api/balances | Fetch all chain balances |
| GET | /api/prices | Top 50 coins from CoinGecko |
| POST | /api/send | Send crypto transaction |
| GET | /api/address/:network | Get address for network |
| GET | /api/gas/:network | Estimate gas fee |
| GET | /api/qrcode/:text | Generate QR code |

## Project Structure

```
crypto-wallet/
├── server.js          # Express server + all API routes
├── package.json       # Dependencies and scripts
├── .env.example       # Environment template
├── .env               # Your local config (gitignored)
├── README.md          # This file
└── public/
    ├── index.html     # Admin login page
    ├── wallet.html    # Main wallet dashboard
    ├── send.html      # Send crypto page
    └── receive.html   # Receive page (QR + address)
```
