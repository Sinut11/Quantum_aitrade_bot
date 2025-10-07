// server/services/chain.js
require('dotenv').config();
const { ethers } = require('ethers');

// ---- ENV ----
const RPC = process.env.BSC_RPC_URL;                 // e.g. https://bsc-dataseed.binance.org
const TREASURY_PK = process.env.TREASURY_PRIVATE_KEY; // 0x... (DO NOT COMMIT)
const USDT = process.env.USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955'; // USDT (BSC)

// ---- Provider & Wallet ----
if (!RPC) throw new Error('Missing BSC_RPC_URL');
if (!TREASURY_PK) throw new Error('Missing TREASURY_PRIVATE_KEY');

const provider = new ethers.JsonRpcProvider(RPC);
const wallet   = new ethers.Wallet(TREASURY_PK, provider);

// ---- Minimal ERC20 ABI ----
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

async function getUsdtContract() {
  const c = new ethers.Contract(USDT, ERC20_ABI, wallet);
  const decimals = await c.decimals();
  return { c, decimals };
}

/**
 * Send USDT to `to` address.
 * @param {string} to - recipient
 * @param {string|number} amount - human amount (e.g. 12.34)
 * @returns {Promise<{hash:string}>}
 */
async function sendUsdt(to, amount) {
  const { c, decimals } = await getUsdtContract();
  const value = ethers.parseUnits(String(amount), decimals);
  const tx = await c.transfer(to, value);
  const rec = await tx.wait(1); // wait 1 conf (adjust if you want)
  return { hash: tx.hash, block: rec?.blockNumber };
}

module.exports = {
  sendUsdt,
  provider,
  wallet
};
