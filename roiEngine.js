// server/roiEngine.js
/**
 * ROI Engine — credits daily payouts to active investments.
 * Dev mode: 1 minute == 1 day (set ROI_DEV_MIN=1). Default real 24h.
 *
 * Env:
 *  ROI_DEV_MIN=1               // minutes per day in dev; if set, speeds up payouts
 *  ROI_TICK_SEC=10             // how often the engine scans for due payouts
 */
const path = require("path");

let Investment = null, Txn = null, User = null;
try { Investment = require("./models/Investment"); } catch {}
try { if (!Investment) Investment = require("./Investment"); } catch {}
try { if (!Investment) Investment = require("../models/Investment"); } catch {}

try { Txn = require("./models/Txn"); } catch {}
try { if (!Txn) Txn = require("./Txn"); } catch {}
try { if (!Txn) Txn = require("../models/Txn"); } catch {}

try { User = require("./models/User"); } catch {}
try { if (!User) User = require("./User"); } catch {}
try { if (!User) User = require("../models/User"); } catch {}

const DAY_MINUTES = Number(process.env.ROI_DEV_MIN || 0) > 0 ? Number(process.env.ROI_DEV_MIN) : (24 * 60);
const TICK_SEC = Math.max(5, Number(process.env.ROI_TICK_SEC || 15));

function addMinutes(date, mins) {
  return new Date(new Date(date).getTime() + mins * 60 * 1000);
}

// Compute payout for one day for a plan
function dailyCredit(amount, days, rate) {
  return (amount / days) + (amount * rate);
}

async function creditPayout(inv) {
  const now = new Date();

  const amount = Number(inv.amount || 0);
  const days = Number(inv.plan?.days || 0);
  const rate = Number(inv.plan?.rate || 0);
  const credit = dailyCredit(amount, days, rate);

  // Write payout txn
  if (Txn) {
    await Txn.create({
      tgId: inv.tgId,
      type: "payout",
      token: "USDT",
      amount: credit,
      status: "ok",
      meta: { investmentId: String(inv._id), plan: inv.plan?.code || "", day: (inv.payoutsMade || 0) + 1 },
      createdAt: now,
      updatedAt: now,
    });
  }

  // Increase user withdrawable balance if supported
  if (User) {
    try {
      const u = await User.findOne({ tgId: inv.tgId });
      if (u) {
        if (!u.balances) u.balances = { withdrawable: 0, lockedQP: 0, referralEarned: 0 };
        u.balances.withdrawable = Number(u.balances.withdrawable || 0) + credit;
        // Optionally reduce lockedQP gradually if you consider principal amortized
        // u.balances.lockedQP = Math.max(0, Number(u.balances.lockedQP || 0) - (inv.amount / days));
        await u.save();
      }
    } catch (e) {
      console.warn("ROI: user balance update failed:", e?.message || e);
    }
  }

  // Update investment
  inv.payoutsMade = (inv.payoutsMade || 0) + 1;
  inv.lastPayoutAt = now;
  inv.nextPayoutAt = addMinutes(inv.nextPayoutAt || now, DAY_MINUTES);

  if (inv.payoutsMade >= days) {
    inv.status = "completed";
    inv.nextPayoutAt = inv.endAt || now;
    // If you amortize principal, clear lockedQP here; or keep as-is.
  }

  try {
    await inv.save();
  } catch (e) {
    console.warn("ROI: investment save failed:", e?.message || e);
  }
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  const now = new Date();
  try {
    if (!Investment) return;

    // Find due investments
    const due = await Investment.find({
      status: { $in: ["active", "running"] },
      nextPayoutAt: { $lte: now },
    }).limit(200);

    for (const inv of due) {
      try {
        await creditPayout(inv);
      } catch (e) {
        console.warn("ROI credit error:", e?.message || e);
      }
    }
  } catch (e) {
    console.warn("ROI tick error:", e?.message || e);
  } finally {
    running = false;
  }
}

function startRoiEngine() {
  console.log(`🟢 ROI engine started (dev: each ${DAY_MINUTES} min = 1 day)`);
  if (timer) clearInterval(timer);
  timer = setInterval(tick, TICK_SEC * 1000);
  // also kick once after small delay
  setTimeout(tick, 1000);
}

module.exports = { startRoiEngine };
