const mongoose = require("mongoose");

async function connectMongo() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set in environment variables");
  }

  if (mongoose.connection.readyState === 1) return mongoose;

  await mongoose.connect(mongoUri, {
    autoIndex: true,
  });

  return mongoose;
}

module.exports = {
  connectMongo,
  mongoose,
};
