require("dotenv").config();

const cors = require("cors");
const express = require("express");
const http = require("http");
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
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({ origin: clientUrl }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.json({ message: "Chatly API is running." }));
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/calls", callRoutes);
app.use("/uploads", express.static("uploads"));
app.use((req, res) => res.status(404).json({ message: "Route not found." }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: clientUrl, methods: ["GET", "POST"] } });
socketHandler(io);
app.set("io", io);

const port = Number(process.env.PORT) || 5000;

async function start() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing. Copy .env.example to .env and configure it.");
  await connectDB();
  server.listen(port, () => console.log(`Chatly API listening on port ${port}`));
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
