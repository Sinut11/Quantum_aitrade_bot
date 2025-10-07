// server/models/User.js
const mongoose = require('mongoose');

const BalanceSchema = new mongoose.Schema({
  qp:             { type: Number, default: 0 },   // free QP
  lockedQP:       { type: Number, default: 0 },   // QP engaged in plans (burned at end)
  referralEarned: { type: Number, default: 0 },   // USDT from referrals
  packageEarned:  { type: Number, default: 0 },   // USDT daily earnings from plans
  withdrawable:   { type: Number, default: 0 },   // optional, if you separate withdraw pool
}, { _id: false });

const PlanSchema = new mongoose.Schema({
  qp:            { type: Number, required: true },     // QP locked in this plan
  rate:          { type: Number, required: true },     // daily rate (e.g. 0.061 = 6.1%)
  startAt:       { type: Date,   default: Date.now },
  endAt:         { type: Date,   required: true },
  unlockAt:      { type: Date },                        // = endAt
  creditedDays:  { type: Number, default: 0 },         // how many days already credited
  remainingDays: { type: Number, default: 20 },        // UI helper
  status:        { type: String, enum: ['active', 'completed'], default: 'active' },
  lastCreditedAt:{ type: Date },
  completedAt:   { type: Date },
}, { _id: false });

const StatsSchema = new mongoose.Schema({
  directRefs:     { type: Number, default: 0 },
  netRefs:        { type: Number, default: 0 },
  referralEarned: { type: Number, default: 0 },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  tgId:         { type: String, index: true, unique: true, required: true },
  username:     { type: String, default: '' },
  referralCode: { type: String, index: true },
  referredBy:   { type: String, default: '' },             // parent tgId (level 1 upline)
  sponsorChain: { type: [String], default: [] },           // up to 15 tgIds

  balances:     { type: BalanceSchema, default: () => ({}) },
  stats:        { type: StatsSchema,    default: () => ({}) },

  // IMPORTANT: embed plans here so saves persist
  activePlans:  { type: [PlanSchema], default: [] },

  payoutAddress:{ type: String, default: '' },

  createdAt:    { type: Date, default: Date.now },
}, {
  versionKey: false,
  strict: true,   // keep strict; schema now contains all needed fields
});

module.exports = mongoose.model('User', UserSchema);
