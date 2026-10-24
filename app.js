require("dotenv").config();

const cors = require("cors");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const messageRoutes = require("./routes/messageRoutes");
const userRoutes = require("./routes/userRoutes");
const friendRoutes = require("./routes/friendRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const callRoutes = require("./routes/callRoutes");
const { getBetterAuth } = require("./config/betterAuth");

const app = express();
const uploadsDirectory = process.env.VERCEL
  ? path.join(os.tmpdir(), "chatly-uploads")
  : path.join(__dirname, "uploads");

fs.mkdirSync(uploadsDirectory, { recursive: true });

const allowedOrigins = [
  "http://localhost:5173",
  "https://chatly-message.vercel.app",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
]
  .filter(Boolean)
  .map((url) => url.replace(/\/+$/, ""));

const uniqueAllowedOrigins = [...new Set(allowedOrigins)];
const corsOptions = {
  origin(origin, callback) {
    if (!origin || uniqueAllowedOrigins.includes(origin.replace(/\/+$/, ""))) {
      return callback(null, true);
    }

    console.warn("CORS blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

app.all("/api/better-auth/*splat", async (req, res, next) => {
  try {
    const [{ toNodeHandler }, auth] = await Promise.all([
      import("better-auth/node"),
      getBetterAuth(),
    ]);
    return toNodeHandler(auth)(req, res, next);
  } catch (error) {
    console.error("Better Auth request failed:", error.message);
    return res.status(503).json({ message: "Google sign-in is not available." });
  }
});

app.use(express.json({ limit: "1mb" }));
app.set("uploadsDirectory", uploadsDirectory);

app.get("/", (req, res) => {
  res.status(200).json({ message: "Chatly API is running." });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api", async (req, res, next) => {
  if (req.method === "GET" && req.path === "/auth/facebook") {
    return next();
  }

  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ message: "API service is not configured." });
  }

  try {
    await connectDB();
    return next();
  } catch (error) {
    console.error("API database connection failed:", error.message);
    return res.status(503).json({ message: "API service is temporarily unavailable." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/calls", callRoutes);

app.get("/uploads/:filename", (req, res, next) => {
  const filename = path.basename(req.params.filename);
  res.sendFile(filename, { root: uploadsDirectory }, (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found.",
    path: req.originalUrl,
    method: req.method,
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "Origin not allowed by CORS." });
  }

  console.error("Server error:", err);
  return res.status(500).json({ message: "Internal server error." });
});

module.exports = app;
