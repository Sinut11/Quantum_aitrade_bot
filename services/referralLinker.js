// server/services/referralLinker.js
const crypto = require('crypto');
const User = require('../models/User');

// Generate short readable code
function makeCode() {
  return crypto.randomBytes(3).toString('base64url'); // 4–5 chars
}

async function ensureUser({ tgId, username }) {
  let u = await User.findOne({ tgId });
  if (!u) {
    u = new User({
      tgId,
      username: username || '',
      depositIndex: 0,
      depositAddress: '',
      balances: {
        referralCode: makeCode(),
        qp: 0,
        lockedQP: 0,
        referralEarned: 0,
      },
      stats: {}
    });
    await u.save();
  } else if (!u.balances || !u.balances.referralCode) {
    u.balances = u.balances || {};
    u.balances.referralCode = makeCode();
    if (typeof username === 'string' && username && !u.username) u.username = username;
    await u.save();
  } else if (typeof username === 'string' && username && u.username !== username) {
    u.username = username;
    await u.save();
  }
  return u;
}

// Attach referral only if not already set
async function attachReferralIfMissing({ tgId, referralCode }) {
  const me = await User.findOne({ tgId });
  if (!me) return false;

  // Already referred, nothing to do
  if (me.referredByUserId) return true;

  // Look up referrer by code
  const ref = await User.findOne({ 'balances.referralCode': referralCode });
  if (!ref) return false;

  // Prevent self-referral
  if (String(ref._id) === String(me._id)) return false;

  me.referredByUserId = ref._id;
  await me.save();
  return true;
}

module.exports = { ensureUser, attachReferralIfMissing };
