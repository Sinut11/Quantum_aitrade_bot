// server/services/sweeper.js
const { ethers, HDNodeWallet, Mnemonic } = require("ethers");
const { provider, wallet, USDT, USDT_DECIMALS } = require("../wallet");
const DepositAllocation = require("../models/DepositAllocation");
const Txn = require("../models/Txn");

const ENABLED = String(process.env.SWEEP_ENABLED || "false").toLowerCase() === "true";
const TREASURY = (process.env.TREASURY_ADDRESS || "").toLowerCase();
const MIN_USDT = Number(process.env.SWEEP_MIN_USDT || 1);
const TOPUP_BNB = Number(process.env.CHILD_GAS_TOPUP_BNB || 0.0007);
const LOOP_MS   = Number(process.env.SWEEP_INTERVAL_MS || 15000);
const BASE_PATH = process.env.BASE_DERIVATION_PATH || "m/44'/60'/0'/0";

// Optional: require some cushion on main wallet before we attempt topups
const MIN_MAIN_BNB = Number(process.env.MIN_MAIN_BNB || 0.002);

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)"
];

if (!USDT) throw new Error("USDT_ADDRESS missing in .env for sweeper");

const usdtRead = new ethers.Contract(USDT, erc20Abi, provider);

function requireHotWalletMnemonic() {
  if (!process.env.WALLET_MNEMONIC) throw new Error("Auto-sweeper requires WALLET_MNEMONIC (hot mode).");
}
function childWalletFromIndex(index) {
  requireHotWalletMnemonic();
  const mn = Mnemonic.fromPhrase(process.env.WALLET_MNEMONIC.trim());
  return HDNodeWallet.fromMnemonic(mn, `${BASE_PATH}/${index}`).connect(provider);
}
async function getBnbBalance(addr) {
  return Number(ethers.formatEther(await provider.getBalance(addr)));
}
async function getUsdtBalance(addr) {
  const raw = await usdtRead.balanceOf(addr);
  return Number(ethers.formatUnits(raw, USDT_DECIMALS));
}
async function topUpGasIfNeeded(childAddr) {
  const bal = await getBnbBalance(childAddr);
  if (bal >= TOPUP_BNB / 2) return null; // child already has some gas

  if (!wallet) throw new Error("Main wallet signer not available to top-up gas.");
  const mainBal = await getBnbBalance(wallet.address);
  if (mainBal < MIN_MAIN_BNB) {
    throw new Error(
      `Main wallet low on BNB (have ${mainBal}, need >= ${MIN_MAIN_BNB}) to top-up children`
    );
  }

  const tx = await wallet.sendTransaction({
    to: childAddr,
    value: ethers.parseEther(String(TOPUP_BNB)),
  });
  return tx.hash;
}

async function sweepChild(index, address) {
  // 1) Check USDT balance
  const amount = await getUsdtBalance(address);
  if (amount < MIN_USDT) return { skipped: true, reason: "below-min", amount };

  // 2) Ensure BNB for gas
  const topupHash = await topUpGasIfNeeded(address);
  if (topupHash) {
    console.log(`⛽ Topped up ${TOPUP_BNB} BNB to ${address} (tx ${topupHash})`);
    await provider.waitForTransaction(topupHash, 1);
  }

  // 3) Send USDT from child to treasury
  const childSigner = childWalletFromIndex(index);
  const childUsdt = new ethers.Contract(USDT, erc20Abi, childSigner);
  const value = ethers.parseUnits(String(amount), USDT_DECIMALS);

  const tx = await childUsdt.transfer(TREASURY, value);
  console.log(`🔁 Sweeping ${amount} USDT from ${address} → ${TREASURY} (tx ${tx.hash})`);
  const rec = await provider.waitForTransaction(tx.hash, 1);
  const ok = rec && rec.status === 1;

  if (ok) {
    await Txn.create({
      user: null, // optional: store the owning tgId in meta if you like
      type: "sweep",
      amount,
      meta: { from: address, to: TREASURY, hash: tx.hash }
    });
  }
  return { swept: ok, hash: tx.hash, amount };
}

async function loop() {
  if (!ENABLED) return;
  if (!TREASURY) { console.warn("⚠️ SWEEP_ENABLED=true but TREASURY_ADDRESS is missing."); return; }
  if (!wallet)   { console.warn("⚠️ SWEEP_ENABLED=true but no main wallet signer."); return; }

  console.log("🧹 Auto-sweeper started");

  while (true) {
    try {
      const allocations = await DepositAllocation.find({}, { derivationIndex: 1, address: 1 }).lean();

      for (const a of allocations) {
        const addr = String(a.address).toLowerCase();

        // 🔒 Safety: never sweep or top-up the treasury / base wallet itself
        if (addr === TREASURY || addr === wallet.address.toLowerCase()) {
          // console.log(`skip base/treasury ${addr} (index=${a.derivationIndex})`);
          continue;
        }

        try {
          const res = await sweepChild(a.derivationIndex, addr);
          if (res?.swept) {
            console.log(`✅ Swept ${res.amount} USDT from ${addr} → ${TREASURY} (tx ${res.hash})`);
          }
          await new Promise(r => setTimeout(r, 500)); // pacing
        } catch (e) {
          const msg = e?.message || String(e);
          if (msg.toLowerCase().includes("main wallet low on bnb")) {
            console.warn("⛽ Add BNB to main wallet (index-0) to enable child top-ups.");
          } else {
            console.warn(`Sweep error for index=${a.derivationIndex} ${addr}:`, msg);
          }
        }
      }
    } catch (e) {
      console.error("Sweeper loop error:", e?.message || e);
    }
    await new Promise(r => setTimeout(r, LOOP_MS));
  }
}

function startSweeper() {
  try {
    if (!ENABLED) { console.log("🧹 Auto-sweeper disabled"); return; }
    loop();
  } catch (e) {
    console.error("Sweeper start error:", e?.message || e);
  }
}

module.exports = { startSweeper };
