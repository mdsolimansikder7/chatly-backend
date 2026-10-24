const mongoose = require("mongoose");

let connectionPromise;

async function connectDB() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing. Copy .env.example to .env and configure MongoDB.");
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  mongoose.set("strictQuery", true);
  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
      .then(() => {
        console.log(`MongoDB connected: ${mongoose.connection.host}`);
        return mongoose.connection;
      })
      .catch((error) => {
        connectionPromise = undefined;
        throw error;
      });
  }

  return connectionPromise;
}

module.exports = connectDB;
