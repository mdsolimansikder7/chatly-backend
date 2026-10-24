
require("dotenv").config();

const cors = require("cors");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const messageRoutes = require("./routes/messageRoutes");
const userRoutes = require("./routes/userRoutes");
const friendRoutes = require("./routes/friendRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const callRoutes = require("./routes/callRoutes");

const socketHandler = require("./socket/socketHandler");

const app = express();
const server = http.createServer(app);

// Frontend URLs allowed to access the API
const allowedOrigins = [
  "http://localhost:5173",
  "https://chatly-message.vercel.app",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
]
  .filter(Boolean)
  .map((url) => url.replace(/\/+$/, ""));

const uniqueAllowedOrigins = [...new Set(allowedOrigins)];

// CORS configuration
const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server requests and health checks
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = origin.replace(/\/+$/, "");

    if (uniqueAllowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    console.warn("CORS blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Root endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Chatly API is running.",
  });
});

// Health endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

// Authentication
app.use("/api/auth", authRoutes);

// Users
app.use("/api/users", userRoutes);

// Friends
app.use("/api/friends", friendRoutes);

// Conversations
app.use("/api/conversations", conversationRoutes);

// Messages
app.use("/api/messages", messageRoutes);

// Uploads API
app.use("/api/upload", uploadRoutes);

// Calls API
app.use("/api/calls", callRoutes);

// Uploaded files
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

// Unknown routes
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found.",
    path: req.originalUrl,
    method: req.method,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      message: "Origin not allowed by CORS.",
    });
  }

  console.error("Server error:", err);

  return res.status(500).json({
    message: "Internal server error.",
  });
});

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: uniqueAllowedOrigins,
    methods: ["GET", "POST"],
  },
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
    console.log("Allowed frontend origins:", uniqueAllowedOrigins);
  });
}

start().catch((error) => {
  console.error("Failed to start Chatly API:", error);
  process.exit(1);
});