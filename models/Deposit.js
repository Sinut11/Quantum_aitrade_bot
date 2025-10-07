// models/Deposit.js
const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema({
  tgId:       { type: String, required: true, index: true },
  amount:     { type: Number, required: true },        // USDT
  creditedQP: { type: Number, required: true },        // 1:1 to QP
  txid:       { type: String, required: true, unique: true },
  status:     { type: String, enum: ['pending','confirmed','failed'], default: 'confirmed' },
  source:     { type: String, default: 'debug' },      // "debug" marks simulated deposits
  createdAt:  { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('Deposit', DepositSchema);
