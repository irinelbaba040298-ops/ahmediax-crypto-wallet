const assert = require('assert');
const http = require('http');

// Set env vars for testing
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.PORT = '4099';
process.env.ETH_RPC_URL = 'https://mainnet.infura.io/v3/PLACEHOLDER';
process.env.BNB_RPC_URL = 'https://bsc-dataseed.binance.org';
process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';
process.env.ARBITRUM_RPC_URL = 'https://arb1.g.alchemy.com/public';
process.env.OPTIMISM_RPC_URL = 'https://mainnet.optimism.io';

const app = require('./server');

let server;
let sessionCookie = '';

function makeRequest(method, path, body = null, cookie = '') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4099,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (cookie) options.headers['Cookie'] = cookie;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  server = app.listen ? app : null;
  
  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  \u2713 ${name}`);
      passed++;
    } catch (err) {
      console.log(`  \u2717 ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n=== Crypto Wallet Admin Tests ===\n');

  // Auth tests
  console.log('Auth:');
  
  await test('Login with wrong password returns 401', async () => {
    const res = await makeRequest('POST', '/api/login', { password: 'wrong' });
    assert.strictEqual(res.status, 401);
  });

  await test('Login without password returns 400', async () => {
    const res = await makeRequest('POST', '/api/login', {});
    assert.strictEqual(res.status, 400);
  });

  await test('Login with correct password returns 200', async () => {
    const res = await makeRequest('POST', '/api/login', { password: 'testpassword123' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    // Extract session cookie
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      sessionCookie = setCookie[0].split(';')[0];
    }
  });

  // Wallet tests (require auth)
  console.log('\nWallet:');

  await test('Get wallet without auth returns 401', async () => {
    const res = await makeRequest('GET', '/api/wallet');
    assert.strictEqual(res.status, 401);
  });

  await test('Get wallet with auth generates new wallet', async () => {
    const res = await makeRequest('GET', '/api/wallet', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.hasWallet, true);
    assert(res.body.address.startsWith('0x'));
    assert.strictEqual(res.body.address.length, 42);
  });

  await test('Get wallet again returns existing wallet (masked mnemonic)', async () => {
    const res = await makeRequest('GET', '/api/wallet', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.hasWallet, true);
    assert(res.body.address.startsWith('0x'));
  });

  await test('Import wallet with invalid key returns 400', async () => {
    const res = await makeRequest('POST', '/api/wallet/import', { privateKey: 'invalid' }, sessionCookie);
    assert.strictEqual(res.status, 400);
  });

  await test('Import wallet with valid private key succeeds', async () => {
    const validKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const res = await makeRequest('POST', '/api/wallet/import', { privateKey: validKey }, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.hasWallet, true);
    assert(res.body.address.startsWith('0x'));
  });

  await test('Import wallet with valid mnemonic succeeds', async () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const res = await makeRequest('POST', '/api/wallet/import', { mnemonic }, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.hasWallet, true);
  });

  // Address tests
  console.log('\nAddresses:');

  await test('Get ethereum address succeeds', async () => {
    const res = await makeRequest('GET', '/api/address/ethereum', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.network, 'ethereum');
    assert(res.body.address.startsWith('0x'));
  });

  await test('Get bnb address succeeds', async () => {
    const res = await makeRequest('GET', '/api/address/bnb', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.network, 'bnb');
  });

  await test('Get bitcoin address returns with note', async () => {
    const res = await makeRequest('GET', '/api/address/bitcoin', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.network, 'bitcoin');
    assert(res.body.note);
  });

  await test('Get unsupported network returns 400', async () => {
    const res = await makeRequest('GET', '/api/address/solana', null, sessionCookie);
    assert.strictEqual(res.status, 400);
  });

  // Send validation tests
  console.log('\nSend:');

  await test('Send without fields returns 400', async () => {
    const res = await makeRequest('POST', '/api/send', {}, sessionCookie);
    assert.strictEqual(res.status, 400);
  });

  await test('Send with invalid address returns 400', async () => {
    const res = await makeRequest('POST', '/api/send', {
      network: 'ethereum',
      to: 'not-a-valid-address',
      amount: '0.01'
    }, sessionCookie);
    assert.strictEqual(res.status, 400);
    assert(res.body.error.includes('Invalid'));
  });

  await test('Send BTC returns 501 (not implemented)', async () => {
    const res = await makeRequest('POST', '/api/send', {
      network: 'bitcoin',
      to: 'bc1qtest',
      amount: '0.001'
    }, sessionCookie);
    assert.strictEqual(res.status, 501);
  });

  // QR code test
  console.log('\nQR Code:');

  await test('Generate QR code succeeds', async () => {
    const res = await makeRequest('GET', '/api/qrcode/0x1234567890abcdef');
    assert.strictEqual(res.status, 200);
    assert(res.body.qrcode.startsWith('data:image/png;base64,'));
  });

  // Gas estimation test
  console.log('\nGas:');

  await test('Get gas for network returns response', async () => {
    const res = await makeRequest('GET', '/api/gas/ethereum', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    // May fail due to no real provider, but should return valid JSON
    assert(typeof res.body === 'object');
  });

  // Logout test
  console.log('\nLogout:');

  await test('Logout succeeds', async () => {
    const res = await makeRequest('POST', '/api/logout', null, sessionCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  await test('After logout, wallet returns 401', async () => {
    const res = await makeRequest('GET', '/api/wallet', null, sessionCookie);
    assert.strictEqual(res.status, 401);
  });

  // Static pages
  console.log('\nStatic Pages:');

  await test('GET / returns HTML', async () => {
    const res = await makeRequest('GET', '/');
    assert.strictEqual(res.status, 200);
  });

  await test('GET /wallet returns HTML', async () => {
    const res = await makeRequest('GET', '/wallet');
    assert.strictEqual(res.status, 200);
  });

  await test('GET /send returns HTML', async () => {
    const res = await makeRequest('GET', '/send');
    assert.strictEqual(res.status, 200);
  });

  await test('GET /receive returns HTML', async () => {
    const res = await makeRequest('GET', '/receive');
    assert.strictEqual(res.status, 200);
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
