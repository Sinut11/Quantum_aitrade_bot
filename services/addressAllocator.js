// server/services/addressAllocator.js
// Unique per-user HD deposit allocator (ethers v6 safe, Mongo atomic)

const mongoose = require('mongoose');
const { HDNodeWallet } = require('ethers'); // v6
const SysState = require('../models/SysState');
const DepositAllocation = require('../models/DepositAllocation');
const User = require('../models/User');

const {
  DEPOSIT_MODE = 'hd',
  WALLET_MNEMONIC = '',
  BASE_DERIVATION_PATH = "m/44'/60'/0'/0",
  START_ALLOC_INDEX = '0',
  TREASURY_ADDRESS = '',
  DEPOSIT_BASE_ADDRESS = ''
} = process.env;

// ---------------- helpers ----------------

function assertMnemonic() {
  const m = (WALLET_MNEMONIC || '').trim();
  const words = m ? m.split(/\s+/) : [];
  if (!m || (words.length !== 12 && words.length !== 24)) {
    const err = new Error('bad_mnemonic_env');
    err.explain = 'WALLET_MNEMONIC is missing or not 12/24 words.';
    throw err;
  }
}

function sanitizeBasePath(p) {
  let path = String(p || "m/44'/60'/0'/0").trim();
  if (!path.startsWith('m/')) path = 'm/' + path.replace(/^\/+/, '');
  path = path.replace(/\/+$/, ''); // no trailing slash
  return path;
}

// Build a wallet already AT the base derivation path, then append /<index>
function addressAt(index) {
  const basePath = sanitizeBasePath(BASE_DERIVATION_PATH);
  const baseWallet = HDNodeWallet.fromPhrase(WALLET_MNEMONIC, undefined, basePath);
  // Append the index ONLY (no "m/" here!)
  const child = baseWallet.deriveChild(Number(index));
  return child.address;
}

// Ensure global counter doc exists (raw driver to avoid operator conflicts)
async function ensureGlobalDoc(session) {
  await SysState.collection.updateOne(
    { key: 'global' },
    { $setOnInsert: { key: 'global', nextDerivationIndex: Number(START_ALLOC_INDEX) || 0 } },
    { upsert: true, session }
  );
}

// Atomically reserve next index and return it
async function reserveNextIndex(session) {
  const doc = await SysState.collection.findOneAndUpdate(
    { key: 'global' },
    { $inc: { nextDerivationIndex: 1 } },
    { returnDocument: 'after', session }
  );
  if (!doc || typeof doc.nextDerivationIndex !== 'number') {
    const err = new Error('counter_unavailable');
    err.explain = 'Global counter not available after increment.';
    throw err;
  }
  return doc.nextDerivationIndex - 1; // reserved index
}

// ---------------- main API ----------------

/**
 * Returns an existing address for tgId or allocates a new unique one.
 * HD mode -> unique per tgId; HOT mode -> single static address.
 */
async function getOrCreateDepositAddress(tgId) {
  const mode = String(DEPOSIT_MODE).toLowerCase();

  // HOT (single, static)
  if (mode === 'hot') {
    const addr = TREASURY_ADDRESS || DEPOSIT_BASE_ADDRESS;
    if (!addr) {
      const err = new Error('hot_mode_missing_address');
      err.explain = 'Set TREASURY_ADDRESS (or DEPOSIT_BASE_ADDRESS) for hot mode.';
      throw err;
    }
    return { address: addr, derivationIndex: null, mode: 'hot' };
  }

  // HD (unique per tgId)
  assertMnemonic();

  // fast path
  const existing = await DepositAllocation.findOne({ tgId }).lean();
  if (existing?.address) {
    return { address: existing.address, derivationIndex: existing.derivationIndex, mode: 'hd' };
  }

  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      // re-check inside txn to avoid races
      const again = await DepositAllocation.findOne({ tgId }).session(session).lean();
      if (again?.address) {
        out = { address: again.address, derivationIndex: again.derivationIndex, mode: 'hd' };
        return;
      }

      // ensure counter, reserve unique index, derive address
      await ensureGlobalDoc(session);
      const idx = await reserveNextIndex(session);
      const addr = addressAt(idx);

      // persist allocation + ensure user doc exists
      await DepositAllocation.create([{ tgId, address: addr, derivationIndex: idx }], { session });
      await User.updateOne({ tgId }, { $setOnInsert: { tgId } }, { upsert: true, session });

      out = { address: addr, derivationIndex: idx, mode: 'hd' };
    });

    if (out) return out;

    const final = await DepositAllocation.findOne({ tgId }).lean();
    if (!final?.address) {
      const err = new Error('alloc_failed');
      err.explain = 'Allocation did not persist inside transaction.';
      throw err;
    }
    return { address: final.address, derivationIndex: final.derivationIndex, mode: 'hd' };
  } finally {
    await session.endSession();
  }
}

module.exports = { getOrCreateDepositAddress };
