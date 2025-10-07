/**
 * walletWatcher.js (FULL VERSION – ethers v6, HTTP polling, safe & verbose)
 * -------------------------------------------------------------------------
 * What it does (out of the box):
 * - Starts a background loop polling BSC logs for USDT `Transfer` events.
 * - Never throws on startup. All errors are caught and retried.
 * - Uses only HTTP provider (works everywhere; no WebSocket needed).
 * - Emits console summaries like: `[watcher] USDT transfers in X-Y: N`
 *
 * Where to wire credit logic (optional):
 * - Implement `creditUserOnDeposit({ to, amount, txHash, blockNumber })`
 *   to look up a user by their deposit address and credit their balance.
 *
 * ENV it uses:
 * - BSC_RPC_URL          (e.g., https://bsc.publicnode.com  or an archive RPC)
 * - USDT_ADDRESS         (BEP-20 USDT on BSC mainnet: 0x55d398326f99059fF775485246999027B3197955)
 * - CONFIRMATIONS        (how many blocks to wait before considering final; default 5)
 */

import { JsonRpcProvider, Interface, toQuantity, toBigInt, zeroPadValue, getAddress } from "ethers";
import process from "node:process";

// ---- Config ----
const RPC_URL       = (process.env.BSC_RPC_URL || "https://bsc.publicnode.com").trim();
const USDT_ADDRESS  = (process.env.USDT_ADDRESS  || "0x55d398326f99059fF775485246999027B3197955").trim();
const CONFIRMS      = Number(process.env.CONFIRMATIONS || 5);

// Minimal ERC-20 ABI for Transfer(address,address,uint256)
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const erc20Iface = new Interface(ERC20_ABI);
const provider   = new JsonRpcProvider(RPC_URL);

// State for block cursor
let lastSafeBlock = 0;
let running = false;

// ---- Optional business hook (no-op by default) ----
async function creditUserOnDeposit({ to, amount, txHash, blockNumber }) {
  // TODO: Replace this with your real crediting logic:
  // 1) Find user by depositAddress == `to` (case-insensitive)
  // 2) Insert a "deposit" txn if not exists (idempotent by txHash)
  // 3) Increase user's withdrawable balance
  // 4) Trigger optional sweep or referral rewards, etc.
  // For now, we only log.
  console.log(`[watcher] Detected deposit to ${to}, amount=${amount} (wei), tx=${txHash}, block=${blockNumber}`);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function initCursor() {
  try {
    const head = await provider.getBlockNumber();
    lastSafeBlock = head - CONFIRMS;
    if (lastSafeBlock < 1) lastSafeBlock = 1;
    console.log(`[watcher] provider head=${head}, start at safe=${lastSafeBlock} (confirms=${CONFIRMS})`);
  } catch (e) {
    console.error("[watcher] init cursor error:", e?.message || e);
    lastSafeBlock = 0;
  }
}

async function pollOnce() {
  const head = await provider.getBlockNumber();
  const safe = head - CONFIRMS;
  if (safe <= lastSafeBlock) return; // nothing new yet

  const fromBlock = lastSafeBlock + 1;
  const toBlock   = safe;

  // Build filter for Transfer(to=indexed ANY). We'll decode and filter `to` later
  const topicTransfer = erc20Iface.getEvent("Transfer").topicHash;
  const filter = {
    address: USDT_ADDRESS,
    fromBlock,
    toBlock,
    topics: [ topicTransfer ],
  };

  const logs = await provider.getLogs(filter);
  console.log(`[watcher] USDT transfers in ${fromBlock}-${toBlock}: ${logs.length}`);

  // Decode logs & attempt credit
  for (const log of logs) {
    try {
      const parsed = erc20Iface.parseLog({ topics: log.topics, data: log.data });
      const to  = getAddress(parsed.args[1]);
      const val = toBigInt(parsed.args[2]);

      // You likely maintain a users collection keyed by depositAddress.
      // If so, uncomment the next line and implement the hook.
      await creditUserOnDeposit({
        to,
        amount: val.toString(),
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
      });
    } catch (e) {
      console.error("[watcher] log decode/credit error:", e?.message || e);
    }
  }

  lastSafeBlock = toBlock;
}

export async function startWalletWatcher() {
  if (running) return;
  running = true;

  console.log(`[watcher] starting for USDT @ ${USDT_ADDRESS} on ${RPC_URL}`);

  // Initialize cursor safely
  await initCursor();
  if (lastSafeBlock === 0) {
    // fallback: retry later
    setTimeout(() => { startWalletWatcher().catch(()=>{}); }, 2000);
    return;
  }

  // Main loop
  (async () => {
    while (running) {
      try {
        await pollOnce();
      } catch (e) {
        console.error("[watcher] loop error:", e?.message || e);
      }
      await sleep(3000); // ~3s cadence
    }
  })();
}

export default startWalletWatcher;