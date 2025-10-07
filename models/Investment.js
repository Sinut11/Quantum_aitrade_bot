// server/models/Investment.js
const mongoose = require('mongoose');

const InvestmentSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },   // your tgId string
    amount: { type: Number, required: true, min: 0 },
    planCode: { type: String, default: 'Q20' },              // single plan
    days: { type: Number, default: 20 },
    dailyRate: { type: Number, required: true },             // e.g. 0.012
    status: { type: String, default: 'active', enum: ['active', 'completed', 'cancelled'] },
    startAt: { type: Date, default: () => new Date() },
    endAt: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Investment || mongoose.model('Investment', InvestmentSchema);
