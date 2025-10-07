// server/models/Plan.js
const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  code: { type: String, unique: true, index: true },  // '15d' | '30d' | '45d' | '60d'
  days: { type: Number, required: true },
  dailyRate: { type: Number, required: true },        // e.g., 0.01 for 1.0%/day
  min: { type: Number, default: 20 },
  max: { type: Number, default: 500000 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);
