/**
 * BuzzMaster Pro - Backend Server
 * Implements NTP-style fairness, session persistence, host controls, and rate limiting.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

// ── Configuration ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const BUZZ_WINDOW_MS = 50; // ms window to collect buzzes and sort by TrueTime

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Rate-limit on HTTP endpoints (general protection)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ── In-Memory State ────────────────────────────────────────────────────────
/**
 * rooms: Map<roomCode, Room>
 * Room {
 *   code: string,
 *   hostSessionId: string,
 *   hostSocketId: string,
 *   locked: boolean,
 *   roundActive: boolean,
 *   roundValue: number,
 *   currentWinner: Player | null,
 *   buzzerQueue: Array<{ sessionId, socketId, name, trueTime }>,
 *   buzzerWindowTimer: NodeJS.Timeout | null,
 *   players: Map<sessionId, Player>,
 *   bannedSessionIds: Set<string>,
 *   buzzRateLimiter: Map<sessionId, number[]>  // timestamps of recent buzzes
 * }
 *
 * Player {
 *   sessionId, name, socketId, score, buzzes, locked, connected
 * }
 */
const rooms = new Map();

// ── Helper Functions ───────────────────────────────────────────────────────
function generateRoomCode() {
  // 6-digit numeric code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getRoom(roomCode) {
  return rooms.get(roomCode);
}

function serializePlayers(room) {
  const list = [];
  room.players.forEach((p) => {
    list.push({
      sessionId: p.sessionId,
      name: p.name,
      score: p.score,
      buzzes: p.buzzes,
      locked: p.locked,
      connected: p.connected,
    });
  });
  // Sort by score descending, then name
  list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return list;
}

function broadcastLeaderboard(io, room) {
  io.to(room.code).emit("leaderboard_update", {
    players: serializePlayers(room),
    currentWinner: room.currentWinner
      ? {
          sessionId: room.currentWinner.sessionId,
          name: room.currentWinner.name,
        }
      : null,
    roundActive: room.roundActive,
    roundValue: room.roundValue,
    locked: room.locked,
  });
}

/**
 * Rate-limit check for BUZZ_EVENT: max 3 buzz attempts per 2 seconds per player.
 */
function isBuzzRateLimited(room, sessionId) {
  const now = Date.now();
  const windowMs = 2000;
  const maxBuzzes = 3;

  if (!room.buzzRateLimiter.has(sessionId)) {
    room.buzzRateLimiter.set(sessionId, []);
  }
  const timestamps = room.buzzRateLimiter.get(sessionId).filter((t) => now - t < windowMs);
  timestamps.push(now);
  room.buzzRateLimiter.set(sessionId, timestamps);
  return timestamps.length > maxBuzzes;
}

// ── REST Endpoints ─────────────────────────────────────────────────────────

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Create a new room (host)
app.post("/api/rooms", (req, res) => {
  const { hostName, sessionId } = req.body;
  if (!hostName || !sessionId) {
    return res.status(400).json({ error: "hostName and sessionId are required" });
  }

  // Generate a unique room code
  let code;
  let attempts = 0;
  do {
    code = generateRoomCode();
    attempts++;
    if (attempts > 1000) {
      return res.status(500).json({ error: "Could not generate unique room code" });
    }
  } while (rooms.has(code));

  const room = {
    code,
    hostSessionId: sessionId,
    hostSocketId: null,
    locked: false,
    roundActive: false,
    roundValue: 10,
    currentWinner: null,
    buzzerQueue: [],
    buzzerWindowTimer: null,
    players: new Map(),
    bannedSessionIds: new Set(),
    buzzRateLimiter: new Map(),
    roundHistory: [],
  };
  rooms.set(code, room);

  return res.json({ roomCode: code });
});

// Export leaderboard as CSV
app.get("/api/rooms/:code/export", (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found" });

  const players = serializePlayers(room);
  const total = players.reduce((s, p) => s + p.score, 0);

  const rows = [["Rank", "Name", "Total Score", "Total Successful Buzzes", "Accuracy %"]];
  players.forEach((p, i) => {
    const accuracy =
      p.buzzes > 0 ? (p.score / (p.buzzes * Math.max(room.roundValue, 1)) * 100).toFixed(1) : "0.0";
    rows.push([i + 1, p.name, p.score, p.buzzes, accuracy]);
  });

  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="buzzmaster-${room.code}.csv"`);
  res.send(csv);
});

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  // ── NTP Sync ──────────────────────────────────────────────────────────
  socket.on("time_sync_request", (clientTime) => {
    socket.emit("time_sync_response", {
      serverTime: Date.now(),
      clientTime,
    });
  });

  // ── Host: Create/Join Room ────────────────────────────────────────────
  socket.on("host_join", ({ roomCode, sessionId, name }) => {
    const room = getRoom(roomCode);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }
    if (room.hostSessionId !== sessionId) {
      socket.emit("error", { message: "Not authorized as host" });
      return;
    }

    room.hostSocketId = socket.id;
    socket.join(roomCode);
    socket.data = { roomCode, sessionId, role: "host" };

    socket.emit("host_joined", {
      roomCode,
      roomState: {
        locked: room.locked,
        roundActive: room.roundActive,
        roundValue: room.roundValue,
        players: serializePlayers(room),
        currentWinner: room.currentWinner
          ? { sessionId: room.currentWinner.sessionId, name: room.currentWinner.name }
          : null,
      },
    });
  });

  // ── Player: Join Room ─────────────────────────────────────────────────
  socket.on("join_room", ({ roomCode, sessionId, name }) => {
    if (!roomCode || !sessionId || !name) {
      socket.emit("error", { message: "roomCode, sessionId, and name are required" });
      return;
    }

    const room = getRoom(roomCode);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    // Check ban
    if (room.bannedSessionIds.has(sessionId)) {
      socket.emit("error", { message: "You have been banned from this room" });
      return;
    }

    // Check room lock for NEW players
    const existing = room.players.get(sessionId);
    if (room.locked && !existing) {
      socket.emit("error", { message: "Room is locked. Cannot join at this time." });
      return;
    }

    socket.join(roomCode);
    socket.data = { roomCode, sessionId, role: "player" };

    if (existing) {
      // Reconnect: restore state
      existing.socketId = socket.id;
      existing.connected = true;
      socket.emit("joined_room", {
        sessionId,
        name: existing.name,
        score: existing.score,
        locked: existing.locked,
        roundActive: room.roundActive,
        roundValue: room.roundValue,
        currentWinner: room.currentWinner
          ? { sessionId: room.currentWinner.sessionId, name: room.currentWinner.name }
          : null,
      });
    } else {
      // New player
      const player = {
        sessionId,
        name,
        socketId: socket.id,
        score: 0,
        buzzes: 0,
        locked: false,
        connected: true,
      };
      room.players.set(sessionId, player);
      socket.emit("joined_room", {
        sessionId,
        name,
        score: 0,
        locked: false,
        roundActive: room.roundActive,
        roundValue: room.roundValue,
        currentWinner: room.currentWinner
          ? { sessionId: room.currentWinner.sessionId, name: room.currentWinner.name }
          : null,
      });
    }

    // Notify all (including host) of updated leaderboard
    broadcastLeaderboard(io, room);
  });

  // ── Spectator: Join Room ──────────────────────────────────────────────
  socket.on("spectator_join", ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }
    socket.join(roomCode);
    socket.data = { roomCode, role: "spectator" };
    socket.emit("spectator_joined", {
      players: serializePlayers(room),
      currentWinner: room.currentWinner
        ? { sessionId: room.currentWinner.sessionId, name: room.currentWinner.name }
        : null,
      roundActive: room.roundActive,
    });
  });

  // ── Host: Lock/Unlock Room ────────────────────────────────────────────
  socket.on("toggle_lock", ({ roomCode, sessionId }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== sessionId) return;
    room.locked = !room.locked;
    io.to(roomCode).emit("room_locked", { locked: room.locked });
  });

  // ── Host: Start Round ─────────────────────────────────────────────────
  socket.on("start_round", ({ roomCode, sessionId, roundValue }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== sessionId) return;

    room.roundActive = true;
    room.roundValue = typeof roundValue === "number" && roundValue > 0 ? roundValue : room.roundValue;
    room.currentWinner = null;
    room.buzzerQueue = [];

    io.to(roomCode).emit("round_started", { roundValue: room.roundValue });
    broadcastLeaderboard(io, room);
  });

  // ── Buzzer Event ──────────────────────────────────────────────────────
  socket.on("buzz", ({ roomCode, sessionId, trueTime }) => {
    const room = getRoom(roomCode);
    if (!room || !room.roundActive) return;

    const player = room.players.get(sessionId);
    if (!player || player.locked) return;

    // Rate limit check
    if (isBuzzRateLimited(room, sessionId)) {
      socket.emit("buzz_rejected", { reason: "Rate limit exceeded" });
      return;
    }

    // Add to queue with server receive time as fallback
    room.buzzerQueue.push({
      sessionId,
      socketId: socket.id,
      name: player.name,
      trueTime: typeof trueTime === "number" ? trueTime : Date.now(),
    });

    // Acknowledge the buzz to the player
    socket.emit("buzz_acknowledged", { sessionId });

    // Start the 50ms collection window if not already running
    if (!room.buzzerWindowTimer) {
      room.buzzerWindowTimer = setTimeout(() => {
        resolveWinner(io, room);
      }, BUZZ_WINDOW_MS);
    }
  });

  // ── Host: Award Points ────────────────────────────────────────────────
  socket.on("award_points", ({ roomCode, sessionId }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== sessionId) return;
    if (!room.currentWinner) return;

    const winner = room.players.get(room.currentWinner.sessionId);
    if (!winner) return;

    winner.score += room.roundValue;
    winner.buzzes += 1;

    room.roundHistory.push({
      round: room.roundHistory.length + 1,
      winner: winner.name,
      sessionId: winner.sessionId,
      pointsAwarded: room.roundValue,
    });

    io.to(roomCode).emit("points_awarded", {
      sessionId: winner.sessionId,
      name: winner.name,
      points: room.roundValue,
      newScore: winner.score,
    });

    broadcastLeaderboard(io, room);
  });

  // ── Host: Reset Round (Reset All) ─────────────────────────────────────
  socket.on("reset_round", ({ roomCode, sessionId }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== sessionId) return;

    resetRound(io, room, false);
  });

  // ── Host: Reset Others (keep winner locked) ───────────────────────────
  socket.on("reset_others", ({ roomCode, sessionId }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== sessionId) return;

    resetRound(io, room, true);
  });

  // ── Host: Kick Player ─────────────────────────────────────────────────
  socket.on("kick_player", ({ roomCode, sessionId: hostSessionId, targetSessionId }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== hostSessionId) return;

    const target = room.players.get(targetSessionId);
    if (!target) return;

    // Blacklist the session
    room.bannedSessionIds.add(targetSessionId);
    room.players.delete(targetSessionId);

    // Disconnect their socket
    const targetSocket = io.sockets.sockets.get(target.socketId);
    if (targetSocket) {
      targetSocket.emit("kicked", { reason: "You have been removed from the room by the host." });
      targetSocket.leave(roomCode);
    }

    broadcastLeaderboard(io, room);
  });

  // ── Host: Manual Score Adjustment ────────────────────────────────────
  socket.on("adjust_score", ({ roomCode, sessionId: hostSessionId, targetSessionId, newScore }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== hostSessionId) return;

    const target = room.players.get(targetSessionId);
    if (!target) return;
    if (typeof newScore !== "number") return;

    target.score = newScore;

    io.to(roomCode).emit("score_adjusted", {
      sessionId: targetSessionId,
      name: target.name,
      newScore,
    });

    broadcastLeaderboard(io, room);
  });

  // ── Host: Set Round Value ─────────────────────────────────────────────
  socket.on("set_round_value", ({ roomCode, sessionId, roundValue }) => {
    const room = getRoom(roomCode);
    if (!room || room.hostSessionId !== sessionId) return;
    if (typeof roundValue === "number" && roundValue > 0) {
      room.roundValue = roundValue;
      io.to(roomCode).emit("round_value_updated", { roundValue });
    }
  });

  // ── Disconnect ────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const { roomCode, sessionId, role } = socket.data || {};
    if (!roomCode) return;

    const room = getRoom(roomCode);
    if (!room) return;

    if (role === "player" && sessionId) {
      const player = room.players.get(sessionId);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        broadcastLeaderboard(io, room);
      }
    } else if (role === "host") {
      room.hostSocketId = null;
    }
  });
});

// ── Internal Logic ─────────────────────────────────────────────────────────

function resolveWinner(io, room) {
  room.buzzerWindowTimer = null;
  if (room.buzzerQueue.length === 0) return;

  // Sort by TrueTime (NTP-adjusted) ascending - smallest = fastest
  room.buzzerQueue.sort((a, b) => a.trueTime - b.trueTime);
  const winner = room.buzzerQueue[0];

  room.roundActive = false;
  room.currentWinner = room.players.get(winner.sessionId) || null;

  // Lock all players who buzzed (they participated in this round)
  room.buzzerQueue.forEach(({ sessionId }) => {
    const p = room.players.get(sessionId);
    if (p) p.locked = true;
  });

  io.to(room.code).emit("winner_announced", {
    sessionId: winner.sessionId,
    name: winner.name,
    trueTime: winner.trueTime,
  });

  // Notify each buzzing player of their result
  room.buzzerQueue.forEach(({ sessionId, socketId }) => {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) {
      const isWinner = sessionId === winner.sessionId;
      targetSocket.emit("buzz_result", { won: isWinner, winnerName: winner.name });
    }
  });

  broadcastLeaderboard(io, room);
}

function resetRound(io, room, keepWinnerLocked) {
  // Clear any pending window timer
  if (room.buzzerWindowTimer) {
    clearTimeout(room.buzzerWindowTimer);
    room.buzzerWindowTimer = null;
  }

  room.roundActive = false;
  room.buzzerQueue = [];

  const winnerSessionId = room.currentWinner ? room.currentWinner.sessionId : null;

  // Unlock players
  room.players.forEach((player) => {
    if (keepWinnerLocked && player.sessionId === winnerSessionId) {
      // Keep winner locked for this question
      player.locked = true;
    } else {
      player.locked = false;
    }
  });

  if (!keepWinnerLocked) {
    room.currentWinner = null;
  }

  io.to(room.code).emit("round_reset", {
    keepWinnerLocked,
    winnerSessionId: keepWinnerLocked ? winnerSessionId : null,
  });

  broadcastLeaderboard(io, room);
}

// ── Start Server ───────────────────────────────────────────────────────────
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`BuzzMaster Pro server running on port ${PORT}`);
  });
}

module.exports = { app, server, io, rooms, resolveWinner, resetRound };
