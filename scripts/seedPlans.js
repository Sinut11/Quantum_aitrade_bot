// server/scripts/seedPlans.js
require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Mongo connected');

    const plans = [
      { code: '15d', days: 15, dailyRate: 0.010, min: 20, max: 500000 },
      { code: '30d', days: 30, dailyRate: 0.012, min: 20, max: 500000 },
      { code: '45d', days: 45, dailyRate: 0.015, min: 20, max: 500000 },
      { code: '60d', days: 60, dailyRate: 0.018, min: 20, max: 500000 },
    ];

    for (const p of plans) {
      await Plan.updateOne({ code: p.code }, { $set: p }, { upsert: true });
      console.log('Upserted plan', p.code);
    }
    console.log('✅ Done');
  } catch (e) {
    console.error('Seeder error:', e?.message || e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
