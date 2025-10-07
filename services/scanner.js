// server/services/scanner.js
const { Contract, JsonRpcProvider, Interface } = require('ethers');
const User = require('../models/User');
const Txn = require('../models/Txn');

const USDT = (process.env.USDT_ADDRESS || '').toLowerCase();
const RPC = process.env.BSC_RPC;
const DECIMALS = 18; // BSC USDT uses 18

const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '10000', 10); // how often to poll
const SCAN_CHUNK_BLOCKS = parseInt(process.env.SCAN_CHUNK_BLOCKS || '10', 10);  // block window

const transferAbi = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];
const iface = new Interface(transferAbi);

let provider;
let lastScanned = 0;

async function loadUserAddressMap() {
  const users = await User.find({ depositAddress: { $exists: true, $ne: null } }, 'tgId depositAddress');
  const map = new Map();
  users.forEach(u => {
    if (u.depositAddress) map.set(String(u.depositAddress).toLowerCase(), u);
  });
  return map;
}

async function creditUser(user, amount, txHash) {
  try {
    if (!user) return;
    const exists = await Txn.findOne({ txHash });
    if (exists) return;

    await Txn.create({
      tgId: user.tgId,
      type: 'deposit',
      amount,
      status: 'confirmed',
      txHash
    });

    user.balances = user.balances || {};
    user.balances.lockedQP = (user.balances.lockedQP || 0) + amount;
    await user.save();

    console.log(`[scanner] credited ${amount} USDT to tgId=${user.tgId} tx=${txHash}`);
  } catch (e) {
    console.error('[scanner] credit error:', e);
  }
}

async function scanOnce() {
  try {
    if (!provider) provider = new JsonRpcProvider(RPC);
    const latest = await provider.getBlockNumber();

    if (!lastScanned) {
      // first run, start just behind latest
      lastScanned = latest - 1;
    }

    let from = lastScanned + 1;
    let to = Math.min(from + SCAN_CHUNK_BLOCKS - 1, latest);

    if (to < from) return;

    const topics = [iface.getEvent('Transfer').topicHash];
    const logs = await provider.getLogs({
      fromBlock: from,
      toBlock: to,
      address: USDT,
      topics: [topics]
    });

    const addrMap = await loadUserAddressMap();

    for (const lg of logs) {
      let parsed;
      try { parsed = iface.parseLog(lg); } catch { continue; }
      const toAddr = String(parsed.args.to).toLowerCase();
      const user = addrMap.get(toAddr);
      if (!user) continue;

      const raw = parsed.args.value;
      const amount = Number(raw) / Math.pow(10, DECIMALS);
      await creditUser(user, amount, lg.transactionHash);
    }

    lastScanned = to;
  } catch (e) {
    console.error('[scanner] scan error:', e?.message || e);
  }
}

function startScanner() {
  if (!RPC || !USDT) {
    console.warn('[scanner] BSC_RPC or USDT_ADDRESS missing — scanner NOT started.');
    return;
  }
  console.log('[scanner] starting…');
  // kick immediately, then interval
  scanOnce().catch(() => {});
  setInterval(scanOnce, SCAN_INTERVAL_MS).unref();
}

module.exports = { startScanner };
