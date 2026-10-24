
require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const app = require("./app");
const socketHandler = require("./socket/socketHandler");

const server = http.createServer(app);

// Socket.IO configuration
const io = new Server(server, {
  cors: { origin: ["http://localhost:5173", "https://chatly-message.vercel.app", process.env.CLIENT_URL, process.env.FRONTEND_URL].filter(Boolean), methods: ["GET", "POST"] },
});

socketHandler(io);
app.set("io", io);

// Render provides the PORT environment variable
const port = Number(process.env.PORT) || 5000;

async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is missing from environment variables."
    );
  }

  await connectDB();

  server.listen(port, "0.0.0.0", () => {
    console.log(`Chatly API listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Chatly API:", error);
  process.exit(1);
});