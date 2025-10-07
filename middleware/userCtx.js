// server/middleware/userCtx.js
const qs = require('querystring');
const User = require('../models/User');

function safeDecode(s){ try{ return decodeURIComponent(s) }catch{ return s } }
function parseInitHeader(val){
  const raw = safeDecode(val || '');
  const parsed = qs.parse(raw);
  let userObj = null;
  if (typeof parsed.user === 'string') { try { userObj = JSON.parse(parsed.user) } catch {} }
  const startParam = parsed.start_param ? String(parsed.start_param) : '';
  return { userObj, startParam };
}
function genReferralCode(){
  const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s=''; for(let i=0;i<6;i++) s+=abc[Math.floor(Math.random()*abc.length)];
  return `${s}_${Math.floor(Math.random()*10)}`;
}

module.exports = async function userCtx(req, res, next){
  try{
    let tgId = '';
    let username = '';
    let startParam = '';

    // 1) Telegram headers
    const h = req.header('x-telegram-init')
      || req.header('x-telegram-init-data')
      || req.header('x-telegram-init-data-unsafe');
    if (h){
      const { userObj, startParam: sp } = parseInitHeader(h);
      if (userObj?.id) tgId = String(userObj.id);
      if (userObj?.username) username = String(userObj.username);
      if (sp) startParam = sp;
    }

    // 2) Browser / test via query
    if (!tgId){
      if (req.query.tgId) tgId = String(req.query.tgId);
      if (!username && typeof req.query.username === 'string') username = String(req.query.username);
    }
    if (!startParam){
      const qStart = req.query.start || req.query.start_param;
      if (qStart) startParam = String(qStart);
    }

    // 3) JSON body fallback
    if (!tgId && req.body && typeof req.body.tgId === 'string'){
      tgId = String(req.body.tgId);
      if (typeof req.body.username === 'string') username = String(req.body.username);
    }
    if (!startParam && req.body && typeof req.body.start === 'string'){
      startParam = String(req.body.start);
    }

    if (!tgId){ req.user = null; return next(); }

    // find or create user
    let u = await User.findOne({ tgId }).lean();
    if (!u){
      const doc = {
        tgId,
        username: username || '',
        referralCode: genReferralCode(),
        referredBy: '',
        referredByUserId: null,
        sponsorChain: [],
      };
      await User.create(doc);
      u = doc;
    } else {
      if (username && u.username !== username){
        await User.updateOne({ tgId }, { $set: { username } });
        u.username = username;
      }
      if (!u.referralCode){
        const rc = genReferralCode();
        await User.updateOne({ tgId }, { $set: { referralCode: rc } });
        u.referralCode = rc;
      }
      if (!Array.isArray(u.sponsorChain)) u.sponsorChain = [];
      if (typeof u.referredBy !== 'string') u.referredBy = '';
      if (u.referredByUserId === undefined) u.referredByUserId = null;
    }

    // attach sponsor ONCE (first time only)
    if (startParam && !u.referredByUserId && !u.referredBy){
      const inviter = await User.findOne({ referralCode: startParam }).select('_id tgId sponsorChain').lean();
      if (inviter && inviter.tgId !== tgId){
        const chain = [inviter.tgId, ...(Array.isArray(inviter.sponsorChain) ? inviter.sponsorChain : [])].slice(0,15);
        await User.updateOne(
          { tgId },
          { $set: {
              referredByUserId: inviter._id,   // <-- for /api/referrals reader
              referredBy: inviter.tgId,        // <-- legacy string, still useful
              sponsorChain: chain
          }}
        );
        u.referredByUserId = inviter._id;
        u.referredBy = inviter.tgId;
        u.sponsorChain = chain;
      }
    }

    req.user = { tgId, username };
    next();
  }catch(e){
    console.error('userCtx error:', e);
    req.user = null;
    next();
  }
};
