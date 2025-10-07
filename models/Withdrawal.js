// server/models/Withdrawal.js
const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  tgId: { type: String, index: true, required: true },
  amount: { type: Number, required: true },       // human USDT (>=10)
  to: { type: String, required: true },           // payout address
  status: { type: String, enum: ['queued','sent','failed'], default: 'queued', index: true },
  txHash: { type: String },
  failReason: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);
