// server/wallet.js
const { ethers } = require("ethers");

// --- RPC ---
const RPC = process.env.BSC_RPC;
if (!RPC) throw new Error("BSC_RPC missing in .env");

const provider = RPC.startsWith("wss://")
  ? new ethers.WebSocketProvider(RPC)
  : new ethers.JsonRpcProvider(RPC);

const IS_WEBSOCKET = RPC.startsWith("wss://");

// --- Wallet (optional) ---
let wallet;
if (process.env.WALLET_PRIVATE_KEY) {
  wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);
} else if (process.env.WALLET_MNEMONIC) {
  wallet = ethers.Wallet.fromPhrase(process.env.WALLET_MNEMONIC).connect(provider);
}

// Deposit address we will watch for incoming USDT
const depositAddress = (wallet?.address || process.env.DEPOSIT_ADDRESS || "").toLowerCase();
if (!depositAddress) {
  console.warn("⚠️  No WALLET_* or DEPOSIT_ADDRESS set; watcher will not know which address to monitor.");
}

// USDT contract + decimals
const USDT = (process.env.USDT_ADDRESS || "").toLowerCase();
const USDT_DECIMALS = Number(process.env.USDT_DECIMALS || 18);

module.exports = {
  provider,
  IS_WEBSOCKET,
  wallet,
  depositAddress,
  USDT,
  USDT_DECIMALS,
};
