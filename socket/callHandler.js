const callHandler = (io, socket, onlineUsers) => {
  // Helper to emit to a specific user by userId
  const emitTo = (userId, event, data) => {
    const socketId = onlineUsers.get(String(userId));
    if (!socketId) return false;
    io.to(socketId).emit(event, data);
    return true;
  };

  // Caller initiates call
  socket.on("call:start", ({ to, offer, callerName }) => {
    const delivered = emitTo(to, "call:incoming", {
      from: socket.userId,
      callerName,
      offer,
    });
    if (!delivered) socket.emit("call:unavailable");
  });

  // Receiver accepts call
  socket.on("call:accept", ({ to, answer }) => {
    emitTo(to, "call:accepted", { answer });
  });

  // Receiver rejects call
  socket.on("call:reject", ({ to }) => {
    emitTo(to, "call:rejected", {});
  });

  // Receiver is busy with another call
  socket.on("call:busy", ({ to }) => {
    emitTo(to, "call:busy", {});
  });

  // ICE candidate exchange
  socket.on("call:ice", ({ to, candidate }) => {
    emitTo(to, "call:ice", { candidate });
  });

  // End call
  socket.on("call:end", ({ to }) => {
    emitTo(to, "call:ended", {});
  });
};

module.exports = callHandler;