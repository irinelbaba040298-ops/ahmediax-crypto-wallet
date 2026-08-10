const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const axios = require('axios');
const { ethers } = require('ethers');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// In-memory wallet storage (DEMO ONLY)
// SECURITY: In production, encrypt private keys with user password and store in DB
// NEVER log private keys or mnemonics
let walletStore = null;

// Hash the admin password on first run if it's plaintext
let adminPasswordHash = process.env.ADMIN_PASSWORD || '';

// RPC Providers
const providers = {
  ethereum: null,
  bnb: null,
  polygon: null,
  arbitrum: null,
  optimism: null
};

function initProviders() {
  try {
    if (process.env.ETH_RPC_URL && !process.env.ETH_RPC_URL.includes('PLACEHOLDER')) {
      providers.ethereum = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
    }
  } catch (e) { /* provider init failed */ }
  try {
    providers.bnb = new ethers.JsonRpcProvider(process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org');
  } catch (e) { /* provider init failed */ }
  try {
    providers.polygon = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
  } catch (e) { /* provider init failed */ }
  try {
    providers.arbitrum = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.g.alchemy.com/public');
  } catch (e) { /* provider init failed */ }
  try {
    providers.optimism = new ethers.JsonRpcProvider(process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io');
  } catch (e) { /* provider init failed */ }
}

initProviders();

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// ============ AUTH ROUTES ============

// POST /api/login — verify admin password, set session
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    let isValid = false;
    // Check if stored password is already a bcrypt hash
    if (adminPasswordHash.startsWith('$2a$') || adminPasswordHash.startsWith('$2b$')) {
      isValid = await bcrypt.compare(password, adminPasswordHash);
    } else {
      // Plaintext comparison for dev; hash it for future use
      isValid = (password === adminPasswordHash);
      if (isValid) {
        adminPasswordHash = await bcrypt.hash(password, 10);
      }
    }

    if (isValid) {
      req.session.authenticated = true;
      return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Invalid password' });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ============ WALLET ROUTES ============

// GET /api/wallet — get or generate wallet
app.get('/api/wallet', requireAuth, (req, res) => {
  if (walletStore) {
    return res.json({
      address: walletStore.address,
      mnemonic: walletStore.mnemonic ? '••••••••' : null,
      hasWallet: true
    });
  }

  // Generate new wallet
  const wallet = ethers.Wallet.createRandom();
  walletStore = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null
  };

  // SECURITY: Private key stored in memory only for this demo
  // In production: encrypt with user password and store in DB
  return res.json({
    address: walletStore.address,
    mnemonic: walletStore.mnemonic,
    hasWallet: true,
    isNew: true
  });
});

// POST /api/wallet/import — import from mnemonic or private key
app.post('/api/wallet/import', requireAuth, (req, res) => {
  try {
    const { mnemonic, privateKey } = req.body;

    let wallet;
    if (mnemonic) {
      wallet = ethers.Wallet.fromPhrase(mnemonic.trim());
      walletStore = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: mnemonic.trim()
      };
    } else if (privateKey) {
      wallet = new ethers.Wallet(privateKey.trim());
      walletStore = {
        address: wallet.address,
        privateKey: privateKey.trim(),
        mnemonic: null
      };
    } else {
      return res.status(400).json({ error: 'Provide mnemonic or private key' });
    }

    return res.json({
      address: walletStore.address,
      hasWallet: true
    });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid mnemonic or private key' });
  }
});

// GET /api/address/:network — get address for specific network
app.get('/api/address/:network', requireAuth, (req, res) => {
  if (!walletStore) {
    return res.status(404).json({ error: 'No wallet found' });
  }

  const network = req.params.network.toLowerCase();

  // EVM chains share the same address
  if (['ethereum', 'bnb', 'polygon', 'arbitrum', 'optimism'].includes(network)) {
    return res.json({ network, address: walletStore.address });
  }

  // BTC address derivation placeholder
  if (network === 'bitcoin') {
    // For demo, we show a note that BTC uses different derivation
    return res.json({
      network: 'bitcoin',
      address: walletStore.address,
      note: 'BTC requires separate key derivation (m/84\'/0\'/0\'/0/0). This demo uses the EVM address as placeholder.'
    });
  }

  return res.status(400).json({ error: 'Unsupported network' });
});

// GET /api/balances — fetch all balances
app.get('/api/balances', requireAuth, async (req, res) => {
  if (!walletStore) {
    return res.status(404).json({ error: 'No wallet found' });
  }

  const balances = {};
  const address = walletStore.address;

  // Fetch EVM balances in parallel
  const evmChains = [
    { key: 'ethereum', symbol: 'ETH', provider: providers.ethereum },
    { key: 'bnb', symbol: 'BNB', provider: providers.bnb },
    { key: 'polygon', symbol: 'MATIC', provider: providers.polygon },
    { key: 'arbitrum', symbol: 'ARB_ETH', provider: providers.arbitrum },
    { key: 'optimism', symbol: 'OP_ETH', provider: providers.optimism }
  ];

  const evmPromises = evmChains.map(async (chain) => {
    try {
      if (!chain.provider) {
        balances[chain.key] = { symbol: chain.symbol, balance: '0', error: 'Provider not configured' };
        return;
      }
      const bal = await chain.provider.getBalance(address);
      balances[chain.key] = {
        symbol: chain.symbol,
        balance: ethers.formatEther(bal),
        raw: bal.toString()
      };
    } catch (err) {
      balances[chain.key] = { symbol: chain.symbol, balance: '0', error: err.message };
    }
  });

  // Fetch BTC balance from Blockstream API
  const btcPromise = (async () => {
    try {
      const resp = await axios.get(`https://blockstream.info/api/address/${address}`, { timeout: 10000 });
      const funded = resp.data.chain_stats.funded_txo_sum || 0;
      const spent = resp.data.chain_stats.spent_txo_sum || 0;
      const satoshis = funded - spent;
      balances.bitcoin = {
        symbol: 'BTC',
        balance: (satoshis / 1e8).toFixed(8),
        raw: satoshis.toString()
      };
    } catch (err) {
      balances.bitcoin = { symbol: 'BTC', balance: '0', error: 'Could not fetch BTC balance' };
    }
  })();

  await Promise.allSettled([...evmPromises, btcPromise]);

  return res.json({ address, balances });
});

// GET /api/prices — fetch top 50 coins from CoinGecko
app.get('/api/prices', requireAuth, async (req, res) => {
  try {
    const resp = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 50,
        page: 1,
        sparkline: false
      },
      timeout: 15000
    });

    const coins = resp.data.map(coin => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h,
      marketCap: coin.market_cap,
      image: coin.image
    }));

    return res.json({ coins });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch prices', details: err.message });
  }
});

// POST /api/send — send crypto transaction
app.post('/api/send', requireAuth, async (req, res) => {
  try {
    const { network, to, amount } = req.body;

    if (!walletStore) {
      return res.status(404).json({ error: 'No wallet found' });
    }

    // Always validate addresses before sending
    if (!to || !amount || !network) {
      return res.status(400).json({ error: 'Missing required fields: network, to, amount' });
    }

    // Require confirmation for transactions over $100 (handled client-side)
    const networkLower = network.toLowerCase();

    if (['ethereum', 'bnb', 'polygon', 'arbitrum', 'optimism'].includes(networkLower)) {
      // Validate recipient address before anything else
      if (!ethers.isAddress(to)) {
        return res.status(400).json({ error: 'Invalid recipient address' });
      }

      const providerMap = {
        ethereum: providers.ethereum,
        bnb: providers.bnb,
        polygon: providers.polygon,
        arbitrum: providers.arbitrum,
        optimism: providers.optimism
      };

      const provider = providerMap[networkLower];
      if (!provider) {
        return res.status(400).json({ error: `Provider for ${network} not configured` });
      }

      const wallet = new ethers.Wallet(walletStore.privateKey, provider);
      const tx = await wallet.sendTransaction({
        to: to,
        value: ethers.parseEther(amount.toString())
      });

      return res.json({
        success: true,
        txHash: tx.hash,
        network: networkLower
      });
    }

    if (networkLower === 'bitcoin') {
      // BTC sending requires bitcoinjs-lib with proper UTXO management
      // This is a placeholder for the demo
      return res.status(501).json({
        error: 'BTC sending requires full UTXO management. Not implemented in this demo.',
        note: 'Use bitcoinjs-lib with Blockstream API for production BTC transactions.'
      });
    }

    return res.status(400).json({ error: 'Unsupported network' });
  } catch (err) {
    return res.status(500).json({ error: 'Transaction failed', details: err.message });
  }
});

// GET /api/gas/:network — estimate gas fee
app.get('/api/gas/:network', requireAuth, async (req, res) => {
  try {
    const network = req.params.network.toLowerCase();
    const providerMap = {
      ethereum: providers.ethereum,
      bnb: providers.bnb,
      polygon: providers.polygon,
      arbitrum: providers.arbitrum,
      optimism: providers.optimism
    };

    const provider = providerMap[network];
    if (!provider) {
      return res.json({ gasPrice: '0', estimated: false });
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0';
    const estimatedCost = feeData.gasPrice ? ethers.formatEther(feeData.gasPrice * 21000n) : '0';

    return res.json({
      gasPrice: gasPrice + ' Gwei',
      estimatedCost,
      network
    });
  } catch (err) {
    return res.json({ gasPrice: '0', estimated: false, error: err.message });
  }
});

// GET /api/qrcode/:text — generate QR code
app.get('/api/qrcode/:text', async (req, res) => {
  try {
    const qr = await QRCode.toDataURL(req.params.text, {
      color: { dark: '#00ff88', light: '#0a0a0f' },
      width: 256
    });
    res.json({ qrcode: qr });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/wallet', (req, res) => res.sendFile(path.join(__dirname, 'public', 'wallet.html')));
app.get('/send', (req, res) => res.sendFile(path.join(__dirname, 'public', 'send.html')));
app.get('/receive', (req, res) => res.sendFile(path.join(__dirname, 'public', 'receive.html')));

app.listen(PORT, () => {
  console.log(`Crypto Wallet Admin Panel running on port ${PORT}`);
});

module.exports = app;
