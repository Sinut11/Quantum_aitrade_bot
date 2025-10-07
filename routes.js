const express = require("express");
const dayjs = require("dayjs");
const User = require("./models/User");
const Investment = require("./models/Investment");
const Txn = require("./models/Txn");
const Withdrawal = require("./models/Withdrawal");
const { deriveWalletAt, isAddress, usdtWithSigner, toUnits } = require("./wallet");

const router = express.Router();

const PLAN_RATE = { 15: 0.01, 30: 0.012, 45: 0.015, 60: 0.018 };
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT_USDT || 2);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW_USDT || 2);
const AUTO_SEND_WITHDRAWALS = String(process.env.AUTO_SEND_WITHDRAWALS || "true") === "true";

// -------- Helpers ----------
async function getOrCreateUser({ tgId, firstName, username, ref }) {
  let user = await User.findOne({ tgId });
  if (!user) {
    user = await User.create({ tgId, firstName, username });
    const index = Math.floor(Math.random() * 1e6);
    const wallet = deriveWalletAt(index);
    user.depositIndex = index;
    user.depositAddress = wallet.address;
    await user.save();
  }
  return user;
}

// -------- Health ----------
router.get("/health", (req, res) => res.json({ ok: true }));

// -------- User info ----------
router.get("/user/:tgId", async (req, res) => {
  const user = await getOrCreateUser({
    tgId: req.params.tgId,
    firstName: req.query.firstName,
    username: req.query.username,
    ref: req.query.ref
  });
  const active = await Investment.find({ user: user._id, status: "active" });
  res.json({
    ok: true,
    user: {
      tgId: user.tgId,
      balance: user.balance,
      locked: user.locked,
      qp: user.qp,
      totalDeposited: user.totalDeposited,
      totalWithdrawn: user.totalWithdrawn,
      totalReferralEarned: user.totalReferralEarned,
      depositAddress: user.depositAddress,
      payoutAddress: user.payoutAddress
    },
    active
  });
});

// -------- Wallet endpoints ----------
router.get("/wallet/info/:tgId", async (req, res) => {
  const user = await getOrCreateUser({ tgId: req.params.tgId });
  res.json({
    ok: true,
    depositAddress: user.depositAddress,
    payoutAddress: user.payoutAddress,
    minDeposit: MIN_DEPOSIT,
    minWithdraw: MIN_WITHDRAW
  });
});

router.post("/wallet/setPayout", async (req, res) => {
  const { tgId, address } = req.body;
  if (!tgId || !isAddress(address)) return res.status(400).json({ ok: false, error: "bad_args" });
  const user = await getOrCreateUser({ tgId });
  user.payoutAddress = address;
  await user.save();
  res.json({ ok: true, payoutAddress: address });
});

// -------- Deposit (dev credit only) ----------
router.post("/deposit/credit", async (req, res) => {
  const { tgId, amount } = req.body;
  if (!tgId || !amount) return res.status(400).json({ ok: false, error: "bad_args" });
  const user = await getOrCreateUser({ tgId });
  user.balance += amount;
  user.totalDeposited += amount;
  await user.save();
  await Txn.create({ user: user._id, type: "deposit", amount, meta: { dev: true } });
  res.json({ ok: true, balance: user.balance });
});

// -------- Invest ----------
router.post("/invest", async (req, res) => {
  const { tgId, amount, days } = req.body;
  const rate = PLAN_RATE[days];
  if (!tgId || !amount || !rate) return res.status(400).json({ ok: false, error: "bad_args" });

  const user = await getOrCreateUser({ tgId });
  if (user.balance < amount) return res.status(400).json({ ok: false, error: "insufficient_balance" });

  user.balance -= amount;
  user.locked += amount;
  user.qp += amount;
  await user.save();

  const inv = await Investment.create({
    user: user._id,
    planDays: days,
    dailyRate: rate,
    capital: amount,
    startAt: new Date(),
    nextCreditAt: dayjs().add(1, "second").toDate(),
    endsAt: dayjs().add(days, "day").toDate()
  });

  await Txn.create({ user: user._id, type: "invest", amount, meta: { planDays: days, rate } });
  res.json({ ok: true, invId: inv._id, balance: user.balance });
});

// -------- Withdraw ----------
router.post("/withdraw", async (req, res) => {
  const { tgId, amount } = req.body;
  if (!tgId || !amount || amount < MIN_WITHDRAW) return res.status(400).json({ ok: false, error: "bad_args" });
  const user = await getOrCreateUser({ tgId });
  if (!user.payoutAddress) return res.status(400).json({ ok: false, error: "no_payout_address" });
  if (user.balance < amount) return res.status(400).json({ ok: false, error: "insufficient_balance" });

  user.balance -= amount;
  user.totalWithdrawn += amount;
  await user.save();

  const w = await Withdrawal.create({ user: user._id, tgId, amount, address: user.payoutAddress });

  if (!AUTO_SEND_WITHDRAWALS) {
    return res.json({ ok: true, queued: true, balance: user.balance });
  }

  try {
    const value = await toUnits(amount);
    const tx = await usdtWithSigner.transfer(user.payoutAddress, value);
    await tx.wait();
    w.status = "sent";
    w.txHash = tx.hash;
    await w.save();
    return res.json({ ok: true, txHash: tx.hash, balance: user.balance });
  } catch (e) {
    w.status = "failed";
    w.error = e.message;
    await w.save();
    user.balance += amount;
    user.totalWithdrawn -= amount;
    await user.save();
    return res.status(500).json({ ok: false, error: "send_failed" });
  }
});

// -------- Transactions ----------
router.get("/txns/:tgId", async (req, res) => {
  const user = await getOrCreateUser({ tgId: req.params.tgId });
  const txns = await Txn.find({ user: user._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ ok: true, txns });
});

module.exports = router;
