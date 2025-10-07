// server/index.js
require('dotenv').config();
require('./botjs'); // keep bot bootstrap

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');

const userCtx = require('./middleware/userCtx');

// Models
const User = require('./models/User');
try { require('./models/DepositAllocation'); } catch {}
const Deposit = require('./models/Deposit'); // ensure models/Deposit.js exists

// Inline Withdrawal model (so no missing route/module)
const Withdrawal = mongoose.models.Withdrawal || mongoose.model(
  'Withdrawal',
  new mongoose.Schema({
    tgId: { type: String, index: true },
    amount: Number,
    address: String,
    status: { type: String, default: 'pending' }, // pending -> paid / rejected
    meta: Object,
  }, { timestamps: true })
);

const PORT = Number(process.env.PORT || 8080);
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || '';
const BOT_USERNAME = (process.env.BOT_USERNAME || 'Quantum_aitrade_bot').replace(/^@/, '');

let DB_READY = false;
mongoose.set('bufferCommands', false);

// DB connect
(async () => {
  if (!MONGO_URI) {
    console.warn('[DB] No MONGO_URI set. Running without DB.');
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 15000,
    });
    DB_READY = true;
    console.log('Mongo connected');
  } catch (err) {
    console.warn('[DB] Failed to connect (degraded mode):', err.message);
  }
})();

// ---------- helpers ----------
function makeReferral(tgId) {
  const digits = (String(tgId).match(/\d+/) || ['0'])[0];
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = BigInt(digits), out = '';
  while (n > 0n) { out = alphabet[Number(n % 62n)] + out; n /= 62n; }
  if (!out) out = '0';
  const sum = [...digits].reduce((a,c)=>a+(c.charCodeAt(0)%13),0)%13;
  return `${out}_${sum.toString(36)}`;
}
function extractInit(req) {
  const raw =
    req.get('X-Telegram-Init') ||
    req.get('x-telegram-init') ||
    req.get('X-Telegram-Init-Data') ||
    req.get('x-telegram-init-data') ||
    '';
  const qs = raw ? new URLSearchParams(raw) : null;
  const header = {};
  try {
    const userJson = qs?.get('user');
    if (userJson) header.user = JSON.parse(userJson);
  } catch {}
  const sp = qs?.get('start_param') || qs?.get('startapp') || null;
  if (sp) header.start_param = sp;
  return { raw, header };
}
function extractTgId(req) {
  const { header } = extractInit(req);
  if (header.user?.id) return String(header.user.id);
  if (req.get('X-TG-ID')) return String(req.get('X-TG-ID'));
  const q = req.query.tgId || req.query.userId || '';
  return q ? String(q) : null;
}
function extractRefCode(req) {
  const { header } = extractInit(req);
  if (header.start_param) return String(header.start_param);
  if (req.query.start)    return String(req.query.start);
  if (req.query.startapp) return String(req.query.startapp);
  if (req.query.ref)      return String(req.query.ref);
  return null;
}

function dailyRateFromQp(qp){
  qp = Number(qp||0);
  if (qp <= 100) return 0.061;
  if (qp <= 250) return 0.062;
  if (qp <= 1000) return 0.063;
  if (qp <= 5000) return 0.065;
  return 0.068;
}

const ONE_DAY_MS = 24*60*60*1000;
function floorDaysBetween(start, end){
  return Math.max(0, Math.floor((end - start) / ONE_DAY_MS));
}

// ---------- app ----------
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(userCtx);

// (These external routes are optional; if missing, our inline endpoints below cover them)
try { app.use("/api", require("./routes/referralBind")); } catch {}
try { app.use("/api/_internal", require("./routes/depositsWebhook")); } catch {}
// try { app.use('/api/withdraw', require('./routes/withdraw')); } catch {} // not needed now
try { app.use('/api', require('./routes/deposit')); } catch {}

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/ping', (_req, res) => res.json({ ok: true, now: Date.now() }));

/**
 * Lazy/idempotent daily earnings for active 20d plans.
 * - Add daily earnings to balances.packageEarned (USDT)
 * - When plan completes, burn QP (reduce lockedQP; QP never returns)
 */
async function creditDueRoi(user){
  if (!user) return false;
  user.balances = user.balances || { qp:0, lockedQP:0, referralEarned:0, packageEarned:0, withdrawable:0 };
  user.activePlans = Array.isArray(user.activePlans) ? user.activePlans : [];

  const now = Date.now();
  let changed = false;

  for (const plan of user.activePlans){
    if (plan.status === 'completed') continue;

    const startAt = new Date(plan.startAt).getTime();
    const endAt = new Date(plan.endAt || plan.unlockAt).getTime();
    const cappedNow = Math.min(now, endAt);

    const shouldHave = Math.min(20, floorDaysBetween(startAt, cappedNow));
    const credited = Number(plan.creditedDays || 0);
    let due = shouldHave - credited;
    if (due <= 0) continue;

    const qp = Number(plan.qp || 0);
    const rate = Number(plan.rate || 0);
    const creditAmount = qp * rate * due;

    user.balances.packageEarned = Number(user.balances.packageEarned || 0) + creditAmount;
    plan.creditedDays = credited + due;
    plan.lastCreditedAt = new Date();
    plan.remainingDays = Math.max(0, 20 - Number(plan.creditedDays));

    if (plan.creditedDays >= 20 || cappedNow >= endAt){
      plan.status = 'completed';
      plan.completedAt = new Date();
      plan.remainingDays = 0;
      user.balances.lockedQP = Math.max(0, Number(user.balances.lockedQP || 0) - qp); // burn
    }

    changed = true;
  }

  if (changed) await user.save();
  return changed;
}

async function getSponsorChainFor(user){
  if (!user) return [];
  if (Array.isArray(user.sponsorChain) && user.sponsorChain.length) {
    return user.sponsorChain.slice(0, 15);
  }
  const out = [];
  let currentTg = user.referredBy || null;
  for (let i = 0; i < 15 && currentTg; i++){
    out.push(String(currentTg));
    const u = await User.findOne({ tgId: String(currentTg) }).select('referredBy').lean();
    currentTg = u?.referredBy || null;
  }
  return out;
}

/**
 * POST /api/invest/buy
 * - Min 20 QP
 * - Deduct qp → lock it
 * - Create 20d plan
 * - Pay referral bonus: 1% per level up to 15 levels
 */
app.post('/api/invest/buy', async (req, res) => {
  try{
    if (!DB_READY) return res.status(503).json({ ok:false, error:'no_db' });
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });

    const amountQp = Number(req.body?.qp || 0);
    if (!isFinite(amountQp) || amountQp < 20) {
      return res.status(400).json({ ok:false, error:'min_qp_20' });
    }

    const user = await User.findOne({ tgId });
    if (!user) return res.status(404).json({ ok:false, error:'user_not_found' });
    user.balances = user.balances || {};

    const avail = Number(user.balances.qp || 0);
    if (avail < amountQp) return res.status(400).json({ ok:false, error:'insufficient_qp' });

    const rate = dailyRateFromQp(amountQp);
    const start = new Date();
    const end = new Date(start.getTime() + 20*ONE_DAY_MS);

    user.balances.qp = avail - amountQp;
    user.balances.lockedQP = Number(user.balances.lockedQP || 0) + amountQp;

    user.activePlans = Array.isArray(user.activePlans) ? user.activePlans : [];
    user.activePlans.push({
      qp: amountQp,
      rate,
      startAt: start,
      endAt: end,
      unlockAt: end,
      creditedDays: 0,
      remainingDays: 20,
      status: 'active'
    });

    await user.save();

    // Referral: 1% per level (up to 15)
    const chain = await getSponsorChainFor(user);
    const bonus = amountQp * 0.01;
    for (const sponsorTg of chain) {
      try {
        if (String(sponsorTg) === String(user.tgId)) continue;
        await User.updateOne(
          { tgId: String(sponsorTg) },
          { $inc: { 'balances.referralEarned': bonus } }
        );
      } catch(e) { console.warn('ref bonus failed for', sponsorTg, e.message); }
    }

    await creditDueRoi(user);
    return res.json({ ok:true });
  }catch(e){
    console.error('POST /api/invest/buy', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

/**
 * POST /api/earnings/transfer-to-qp
 * - Convert ALL (packageEarned + referralEarned) → QP
 * - Apply +3% bonus
 */
app.post('/api/earnings/transfer-to-qp', async (req, res) => {
  try{
    if (!DB_READY) return res.status(503).json({ ok:false, error:'no_db' });
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });

    const user = await User.findOne({ tgId });
    if (!user) return res.status(404).json({ ok:false, error:'user_not_found' });
    user.balances = user.balances || {};

    const pkg = Number(user.balances.packageEarned || 0);
    const ref = Number(user.balances.referralEarned || 0);
    const base = pkg + ref;

    if (base <= 0) {
      return res.status(400).json({ ok:false, error:'nothing_to_transfer' });
    }

    const BONUS_RATE = 0.03; // +3%
    const bonus = Math.round(base * BONUS_RATE * 100) / 100;
    const credited = Math.round((base + bonus) * 100) / 100;

    user.balances.packageEarned = 0;
    user.balances.referralEarned = 0;
    user.balances.qp = Number(user.balances.qp || 0) + credited;

    await user.save();

    return res.json({
      ok:true,
      transferred: base,
      bonus,
      creditedQP: credited,
      balances: user.balances
    });
  }catch(e){
    console.error('transfer-to-qp error', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

/**
 * POST /api/profile/wallet
 * Save/Update BEP-20 payout address for the user
 */
app.post('/api/profile/wallet', async (req, res) => {
  try{
    if (!DB_READY) return res.status(503).json({ ok:false, error:'no_db' });
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });

    const { address } = req.body || {};
    if (!address || typeof address !== 'string' || !address.startsWith('0x') || address.length < 20) {
      return res.status(400).json({ ok:false, error:'invalid_address' });
    }

    const user = await User.findOne({ tgId });
    if (!user) return res.status(404).json({ ok:false, error:'user_not_found' });

    user.payoutAddress = address.trim();
    await user.save();
    return res.json({ ok:true });
  }catch(e){
    console.error('profile/wallet error', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

/**
 * POST /api/withdraw
 * - Min $5
 * - Requires payout address (request body takes precedence; else stored address)
 * - Deducts from earnings ONLY (packageEarned first, then referralEarned)
 * - Creates a pending Withdrawal record
 */
app.post('/api/withdraw', async (req, res) => {
  try{
    if (!DB_READY) return res.status(503).json({ ok:false, error:'no_db' });
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });

    const { amount, address } = req.body || {};
    const amt = Number(amount);
    if (!isFinite(amt) || amt < 5) {
      return res.status(400).json({ ok:false, error:'min_withdraw_5' });
    }

    const user = await User.findOne({ tgId });
    if (!user) return res.status(404).json({ ok:false, error:'user_not_found' });
    user.balances = user.balances || {};

    const payout = (address && typeof address === 'string' ? address : user.payoutAddress || '').trim();
    if (!payout || !payout.startsWith('0x') || payout.length < 20){
      return res.status(400).json({ ok:false, error:'no_payout_address' });
    }

    // Earnings only
    let pkg = Number(user.balances.packageEarned || 0);
    let ref = Number(user.balances.referralEarned || 0);
    const total = pkg + ref;
    if (total < amt) {
      return res.status(400).json({ ok:false, error:'insufficient_earnings' });
    }

    // Deduct from package first, then referral
    let need = amt;
    const fromPkg = Math.min(pkg, need);
    pkg -= fromPkg; need -= fromPkg;
    const fromRef = Math.min(ref, need);
    ref -= fromRef; need -= fromRef;

    user.balances.packageEarned = Math.round(pkg * 100) / 100;
    user.balances.referralEarned = Math.round(ref * 100) / 100;
    await user.save();

    const wd = await Withdrawal.create({
      tgId, amount: Math.round(amt*100)/100, address: payout, status: 'pending',
      meta: { fromPackage: fromPkg, fromReferral: fromRef }
    });

    return res.json({ ok:true, requestId: String(wd._id), status: wd.status });
  }catch(e){
    console.error('withdraw error', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

/**
 * GET /api/history
 * Simple combined history (deposits + withdrawals) for demos
 */
app.get('/api/history', async (req, res) => {
  try{
    if (!DB_READY) return res.status(503).json({ ok:false, error:'no_db' });
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });

    const [deps, wds] = await Promise.all([
      Deposit.find({ tgId }).sort({ createdAt: -1 }).limit(50).lean().catch(()=>[]),
      Withdrawal.find({ tgId }).sort({ createdAt: -1 }).limit(50).lean().catch(()=>[]),
    ]);

    res.json({ ok:true, deposits: deps, withdrawals: wds });
  }catch(e){
    console.error('history error', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/**
 * GET /api/me
 * - Find/create user
 * - Bind referral (once)
 * - creditDueRoi
 * - Recompute lockedQP from activePlans (authoritative, auto-heal)
 */
app.get('/api/me', async (req, res) => {
  const tgId = extractTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'no_tgId' });

  const fallbackReferral = makeReferral(tgId);
  const incomingRef = extractRefCode(req);
  const usernameFromQs = req.query.username ? String(req.query.username) : undefined;

  if (!DB_READY) {
    return res.json({
      ok: true,
      tgId,
      referralCode: fallbackReferral,
      botUsername: BOT_USERNAME,
      balances: { qp: 0, withdrawable: 0, lockedQP: 0, referralEarned: 0, packageEarned: 0 },
      activePlans: [],
      debugSource: 'degraded-no-db'
    });
  }

  try {
    let user = await User.findOne({ tgId });
    if (!user) {
      user = await User.create({
        tgId,
        username: usernameFromQs || '',
        referralCode: fallbackReferral,
        balances: { qp: 0, withdrawable: 0, lockedQP: 0, referralEarned: 0, packageEarned: 0 },
        stats: { directRefs: 0, netRefs: 0, referralEarned: 0 },
        activePlans: []
      });
    } else if (usernameFromQs && !user.username) {
      user.username = usernameFromQs;
      await user.save();
    }

    // One-time referral binding
    if (!user.referredBy && incomingRef) {
      const inviter = await User.findOne({ referralCode: incomingRef }).select('tgId sponsorChain');
      if (inviter && inviter.tgId && inviter.tgId !== user.tgId) {
        user.referredBy = inviter.tgId;
        user.sponsorChain = [inviter.tgId, ...(inviter.sponsorChain || [])].slice(0, 15);
        await user.save();
        await User.updateOne({ tgId: inviter.tgId }, { $inc: { 'stats.directRefs': 1 } }).catch(()=>{});
      }
    }

    // Lazy daily earnings
    await creditDueRoi(user);

    // Compute ACTIVE plans and lockedQP from plans (authoritative)
    const rawPlans = Array.isArray(user.activePlans) ? user.activePlans : [];
    const activePlans = rawPlans.filter(p => p.status !== 'completed');

    const plansOut = activePlans.map(p => {
      const credited = Number(p.creditedDays || 0);
      const remaining = typeof p.remainingDays === 'number' ? p.remainingDays : Math.max(0, 20 - credited);
      return {
        qp: p.qp,
        rate: p.rate,
        unlockAt: p.endAt || p.unlockAt,
        creditedDays: credited,
        remainingDays: remaining
      };
    });

    const lockedFromPlans = plansOut.reduce((s,p)=> s + Number(p.qp || 0), 0);

    // Auto-heal DB if mismatched
    if ((Number(user.balances?.lockedQP || 0)) !== lockedFromPlans) {
      user.balances = user.balances || {};
      user.balances.lockedQP = lockedFromPlans;
      await user.save().catch(()=>{});
    }

    res.json({
      ok: true,
      tgId: user.tgId,
      referralCode: user.referralCode || fallbackReferral,
      botUsername: BOT_USERNAME,
      balances: {
        ...(user.balances || {}),
        lockedQP: lockedFromPlans // authoritative value
      },
      activePlans: plansOut,
      debugSource: 'db'
    });
  } catch (err) {
    console.error('GET /api/me error:', err);
    res.json({
      ok: true,
      tgId,
      referralCode: fallbackReferral,
      botUsername: BOT_USERNAME,
      balances: { qp: 0, withdrawable: 0, lockedQP: 0, referralEarned: 0, packageEarned: 0 },
      activePlans: [],
      debugSource: 'db-error-fallback'
    });
  }
});

/** ---------- Referrals summary ----------
 * earnings[level] = 1% * sum( all QP purchases by users at that level )
 */
async function computeReferralSummaryByLevels_TgString(tgId) {
  const zeros = Array.from({ length: 15 }, (_, i) => ({ level: i + 1, count: 0, earnings: 0 }));
  if (!DB_READY) return { out: zeros, source: 'no-db' };

  const me = await User.findOne({ tgId }).select('tgId').lean();
  if (!me) return { out: zeros, source: 'no-user' };

  let frontier = [me.tgId];
  const out = [];

  for (let lvl = 1; lvl <= 15; lvl++) {
    if (!frontier.length) {
      while (out.length < 15) out.push({ level: out.length + 1, count: 0, earnings: 0 });
      break;
    }

    const kids = await User.find({ referredBy: { $in: frontier } })
      .select('tgId activePlans')
      .lean();

    const count = kids.length;

    let qpSum = 0;
    for (const k of kids) {
      const plans = Array.isArray(k.activePlans) ? k.activePlans : [];
      for (const p of plans) {
        const q = Number(p?.qp || 0);
        if (q > 0) qpSum += q;
      }
    }
    const earnings = qpSum * 0.01; // 1% per level

    out.push({ level: lvl, count, earnings });
    frontier = kids.map(x => x.tgId);
  }

  while (out.length < 15) out.push({ level: out.length + 1, count: 0, earnings: 0 });
  return { out, source: 'db' };
}

app.get('/api/referrals', async (req, res) => {
  const tgId = extractTgId(req);
  if (!tgId) return res.status(400).json({ ok: false, error: 'no_tgId' });
  try {
    const { out, source } = await computeReferralSummaryByLevels_TgString(tgId);
    res.json({ ok: true, summary: out, source });
  } catch (e) {
    console.error('GET /api/referrals error', e);
    const zeros = Array.from({ length: 15 }, (_, i) => ({ level: i + 1, count: 0, earnings: 0 }));
    res.json({ ok: true, summary: zeros, source: 'error-fallback' });
  }
});

// ---------- Simulated deposit (dev-only) ----------
const DEV_ENABLED = process.env.NODE_ENV !== 'production';
app.post('/api/debug/simulate-deposit', async (req, res) => {
  try {
    if (!DEV_ENABLED) return res.status(403).json({ ok: false, error: 'disabled_in_prod' });
    if (!DB_READY)  return res.status(503).json({ ok: false, error: 'no_db' });

    const { tgId, amount, txid } = req.body || {};
    if (!tgId) return res.status(400).json({ ok: false, error: 'tgId_required' });

    const amt = Number(amount);
    if (!(typeof amt === 'number' && isFinite(amt) && amt > 0)) {
      return res.status(400).json({ ok: false, error: 'amount_invalid' });
    }

    const user = await User.findOne({ tgId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const safeTxid = txid || `devtx-${tgId}-${Date.now()}`;

    let dep = await Deposit.findOne({ txid: safeTxid });
    if (!dep) {
      dep = await Deposit.create({
        tgId, amount: amt, creditedQP: amt,
        txid: safeTxid, status: 'confirmed', source: 'debug'
      });
      user.balances = user.balances || {};
      user.balances.qp = Number(user.balances.qp || 0) + dep.creditedQP;
      await user.save();
    }

    return res.json({
      ok: true,
      credited: dep.creditedQP,
      qpBalance: Number(user.balances?.qp || 0),
      txid: dep.txid,
      status: dep.status
    });
  } catch (e) {
    if (e && e.code === 11000) {
      const dep = await Deposit.findOne({ txid: req.body.txid });
      return res.json({
        ok: true,
        credited: dep?.creditedQP || 0,
        txid: req.body.txid,
        status: dep?.status || 'confirmed'
      });
    }
    console.error('simulate-deposit error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ---------- SHARED SIMULATED FUTURES TRADES ----------
const TRADE_PAIRS = (() => {
  const core = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT'];
  const more = 'DOGE,MATIC,AVAX,DOT,TRX,LTC,SHIB,NEAR,ATOM,LINK,APT,OP,ARB,SUI,INJ,FTM,ICP,ALGO,ETC,IMX,HBAR,TON,STX,AR,GMX,RUNE,CAKE,MANA,SAND,AXS,ROSE,CELO,KSM,NEO,ONT,ZIL,CHR,AGIX,FET,OCEAN,WLD,PIXEL,PORTAL,TIA,STRK,BONK,BLUR,QTUM,EOS,BCH,XLM,XTZ,ONE,TFUEL,RSR,ANKR,BAND,CHZ,REN,SKL,STORJ,KAVA,GALA,ENS,GLMR,ASTR,CFX,CKB,BNX,ID,TRB,HOOK,ACH,SSV,LPT,FLM,JOE,UNI,SUSHI,COMP,CRV,MKR,AAVE,PEPE,SEI,ORDI,JTO,ENA,JUP,TAO,MINA,FLOKI,BIT,ARB,BLAST,DEGEN,DEXE,BICO,ILV,OPUL,SC,STG,FRONT,CEEK,ARPA,LYX,VELO,OM,BAKE,ALICE'
    .split(',').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase() + 'USDT');
  const pool = [...new Set([...core, ...more])];
  return pool.length >= 100 ? pool : pool.concat(Array.from({length:100-pool.length}).map((_,i)=>`ALT${i+1}USDT`));
})();

const SIM_TRADES = [];
const MAX_KEEP = 120;
const SHOW_N = 10;

function randInt(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }
function randChoice(arr){ return arr[randInt(0, arr.length-1)]; }
function round2(n){ return Math.round(n*100)/100; }

function genSimTrade(ts = Date.now()){
  let pair = randChoice(TRADE_PAIRS);
  if (Math.random() < 0.35) {
    const core = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT'];
    pair = randChoice(core);
  }
  const amount = round2(randInt(20, 250));
  const levOptions = [3, 5, 10, 15, 20];
  const lev = randChoice(levOptions);
  const pctRanges = { 3:[10,20], 5:[15,30], 10:[25,45], 15:[30,55], 20:[40,60] };
  const [lo, hi] = pctRanges[lev] || [10,60];
  const pct = Math.random() * (hi - lo) + lo;
  const profit = round2(amount * (pct / 100));
  return { time:new Date(ts).toISOString(), symbol:pair, amount, profit, leverage:`${lev}x` };
}
function pushTrade(t){ SIM_TRADES.push(t); if (SIM_TRADES.length > MAX_KEEP) SIM_TRADES.shift(); }
(function seedSimTrades(){
  const now = Date.now();
  const gaps = [60,75,90,100,110,120,130,140,155,170].map(m=>m*60*1000);
  gaps.forEach(g => pushTrade(genSimTrade(now-g)));
})();
setInterval(()=>pushTrade(genSimTrade()), 18*60*1000);

app.get('/api/trades', (_req,res)=>{
  res.json({ ok:true, trades: SIM_TRADES.slice(-SHOW_N) });
});

// ---------- Debug reconcile ----------
/**
 * GET /api/debug/reconcile-user?tgId=XXXX
 * - Recomputes lockedQP from activePlans and saves it
 * - Returns the diff
 */
app.get('/api/debug/reconcile-user', async (req, res) => {
  try{
    if (!DB_READY) return res.status(503).json({ ok:false, error:'no_db' });
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });
    const u = await User.findOne({ tgId });
    if (!u) return res.status(404).json({ ok:false, error:'user_not_found' });

    const plans = (u.activePlans || []).filter(p => p.status !== 'completed');
    const lockedFromPlans = plans.reduce((s,p)=> s + Number(p.qp || 0), 0);
    const before = Number(u.balances?.lockedQP || 0);
    if (!u.balances) u.balances = {};
    u.balances.lockedQP = lockedFromPlans;
    await u.save();

    res.json({ ok:true, tgId, before, after: lockedFromPlans, plans: plans.map(p=>({qp:p.qp, creditedDays:p.creditedDays, remainingDays:p.remainingDays})) });
  }catch(e){
    console.error('reconcile-user error', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// ---------- Static web ----------
app.use('/', express.static(path.join(__dirname, 'web')));
app.listen(PORT, ()=>console.log('Server on :' + PORT));
