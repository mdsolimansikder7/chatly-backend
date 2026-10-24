
require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const connectDB = require("./config/db");
const socketHandler = require("./socket/socketHandler");

const allowedOrigins = [
  "http://localhost:5173",
  "https://chatly-message.vercel.app",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
]
  .filter(Boolean)
  .map((url) => url.replace(/\/+$/, ""));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

// Ensure MongoDB is connected before Socket.IO authentication.
io.use(async (socket, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("Socket MongoDB connection failed:", error.message);
    next(new Error("Database unavailable"));
  }
});

socketHandler(io);

module.exports = server;
