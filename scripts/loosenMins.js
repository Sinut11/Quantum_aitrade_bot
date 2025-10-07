// server/scripts/loosenMins.js
require("dotenv").config();
const mongoose = require("mongoose");

const Plan = mongoose.models.Plan || mongoose.model(
  "Plan",
  new mongoose.Schema(
    { code: String, days: Number, dailyRate: Number, min: Number, max: Number, active: Boolean },
    { collection: "plans" }
  )
);

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Mongo connected");
    const res = await Plan.updateMany({}, { $set: { min: 1 } });
    console.log("Updated plans:", res.modifiedCount);
  } catch (e) {
    console.error(e);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
