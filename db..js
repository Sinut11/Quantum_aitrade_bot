const mongoose = require("mongoose");

async function connectMongo(uri) {
  if (!uri) throw new Error("MONGO_URI missing");
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { autoIndex: true });
  console.log("✅ Mongo connected");
}

module.exports = { connectMongo, mongoose };
