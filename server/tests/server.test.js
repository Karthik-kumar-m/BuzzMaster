/**
 * BuzzMaster Pro - Server Tests
 * Tests for room management, buzzer logic, and host controls.
 */

const request = require("supertest");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { io: ClientIO } = require("socket.io-client");
const { app, server, rooms } = require("../index");

const PORT = 4001;
let serverAddr;

beforeAll((done) => {
  server.listen(PORT, () => {
    serverAddr = `http://localhost:${PORT}`;
    done();
  });
});

afterAll((done) => {
  // Clean up all rooms
  rooms.clear();
  server.close(done);
});

afterEach(() => {
  rooms.clear();
});

// ── Helper ─────────────────────────────────────────────────────────────────
function connectClient(opts = {}) {
  return ClientIO(serverAddr, {
    transports: ["websocket"],
    forceNew: true,
    ...opts,
  });
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

// ── REST API Tests ─────────────────────────────────────────────────────────
describe("REST API", () => {
  test("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("POST /api/rooms creates a room with 6-digit code", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: "host-uuid-1" });
    expect(res.status).toBe(200);
    expect(res.body.roomCode).toMatch(/^\d{6}$/);
  });

  test("POST /api/rooms returns 400 if sessionId missing", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice" });
    expect(res.status).toBe(400);
  });

  test("POST /api/rooms returns 400 if hostName missing", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .send({ sessionId: "host-uuid-2" });
    expect(res.status).toBe(400);
  });

  test("GET /api/rooms/:code/export returns CSV", async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: "host-uuid-3" });
    const { roomCode } = createRes.body;

    const res = await request(app).get(`/api/rooms/${roomCode}/export`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("Rank");
    expect(res.text).toContain("Name");
    expect(res.text).toContain("Total Score");
  });

  test("GET /api/rooms/:code/export returns 404 for unknown room", async () => {
    const res = await request(app).get("/api/rooms/999999/export");
    expect(res.status).toBe(404);
  });
});

// ── Socket Tests ───────────────────────────────────────────────────────────
describe("Socket.io - Room Management", () => {
  test("Host can join a created room", async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: "host-uuid-10" });
    const { roomCode } = createRes.body;

    const hostSocket = connectClient();
    const joinedPromise = waitFor(hostSocket, "host_joined");

    hostSocket.emit("host_join", {
      roomCode,
      sessionId: "host-uuid-10",
      name: "Alice",
    });

    const data = await joinedPromise;
    expect(data.roomCode).toBe(roomCode);
    expect(data.roomState).toBeDefined();
    hostSocket.disconnect();
  });

  test("Player can join a room", async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: "host-uuid-11" });
    const { roomCode } = createRes.body;

    const playerSocket = connectClient();
    const joinedPromise = waitFor(playerSocket, "joined_room");

    playerSocket.emit("join_room", {
      roomCode,
      sessionId: "player-uuid-1",
      name: "Bob",
    });

    const data = await joinedPromise;
    expect(data.sessionId).toBe("player-uuid-1");
    expect(data.name).toBe("Bob");
    expect(data.score).toBe(0);
    playerSocket.disconnect();
  });

  test("Player gets error joining a non-existent room", async () => {
    const playerSocket = connectClient();
    const errorPromise = waitFor(playerSocket, "error");

    playerSocket.emit("join_room", {
      roomCode: "000000",
      sessionId: "player-uuid-2",
      name: "Bob",
    });

    const data = await errorPromise;
    expect(data.message).toBeDefined();
    playerSocket.disconnect();
  });

  test("Spectator can join a room", async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: "host-uuid-12" });
    const { roomCode } = createRes.body;

    const spectatorSocket = connectClient();
    const joinedPromise = waitFor(spectatorSocket, "spectator_joined");

    spectatorSocket.emit("spectator_join", { roomCode });

    const data = await joinedPromise;
    expect(data.players).toBeDefined();
    spectatorSocket.disconnect();
  });
});

describe("Socket.io - Host Controls", () => {
  let roomCode;
  let hostSocket;
  let playerSocket;
  const HOST_SESSION = "host-ctrl-1";
  const PLAYER_SESSION = "player-ctrl-1";

  beforeEach(async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: HOST_SESSION });
    roomCode = createRes.body.roomCode;

    hostSocket = connectClient();
    playerSocket = connectClient();

    const hostJoined = waitFor(hostSocket, "host_joined");
    hostSocket.emit("host_join", { roomCode, sessionId: HOST_SESSION, name: "Alice" });
    await hostJoined;

    const playerJoined = waitFor(playerSocket, "joined_room");
    playerSocket.emit("join_room", { roomCode, sessionId: PLAYER_SESSION, name: "Bob" });
    await playerJoined;
  });

  afterEach(() => {
    hostSocket.disconnect();
    playerSocket.disconnect();
  });

  test("Host can lock the room", async () => {
    const lockEvent = waitFor(hostSocket, "room_locked");
    hostSocket.emit("toggle_lock", { roomCode, sessionId: HOST_SESSION });
    const data = await lockEvent;
    expect(data.locked).toBe(true);
  });

  test("Locked room rejects new players", async () => {
    // Lock room
    const lockEvent = waitFor(hostSocket, "room_locked");
    hostSocket.emit("toggle_lock", { roomCode, sessionId: HOST_SESSION });
    await lockEvent;

    // New player tries to join
    const newPlayer = connectClient();
    const errorEvent = waitFor(newPlayer, "error");
    newPlayer.emit("join_room", { roomCode, sessionId: "new-player-uuid", name: "Charlie" });
    const err = await errorEvent;
    expect(err.message).toMatch(/locked/i);
    newPlayer.disconnect();
  });

  test("Host can start a round", async () => {
    const roundStarted = waitFor(playerSocket, "round_started");
    hostSocket.emit("start_round", { roomCode, sessionId: HOST_SESSION, roundValue: 20 });
    const data = await roundStarted;
    expect(data.roundValue).toBe(20);
  });

  test("Host can kick a player", async () => {
    const kickedEvent = waitFor(playerSocket, "kicked");
    hostSocket.emit("kick_player", {
      roomCode,
      sessionId: HOST_SESSION,
      targetSessionId: PLAYER_SESSION,
    });
    const data = await kickedEvent;
    expect(data.reason).toBeDefined();
  });

  test("Kicked player is banned and cannot rejoin", async () => {
    const kickedEvent = waitFor(playerSocket, "kicked");
    hostSocket.emit("kick_player", {
      roomCode,
      sessionId: HOST_SESSION,
      targetSessionId: PLAYER_SESSION,
    });
    await kickedEvent;

    // Try to rejoin
    const rejoinSocket = connectClient();
    const errorEvent = waitFor(rejoinSocket, "error");
    rejoinSocket.emit("join_room", { roomCode, sessionId: PLAYER_SESSION, name: "Bob" });
    const err = await errorEvent;
    expect(err.message).toMatch(/banned/i);
    rejoinSocket.disconnect();
  });

  test("Host can adjust player score", async () => {
    const scoreAdjusted = waitFor(hostSocket, "score_adjusted");
    hostSocket.emit("adjust_score", {
      roomCode,
      sessionId: HOST_SESSION,
      targetSessionId: PLAYER_SESSION,
      newScore: 100,
    });
    const data = await scoreAdjusted;
    expect(data.sessionId).toBe(PLAYER_SESSION);
    expect(data.newScore).toBe(100);

    const room = rooms.get(roomCode);
    expect(room.players.get(PLAYER_SESSION).score).toBe(100);
  });

  test("Host can set round value", async () => {
    const updated = waitFor(hostSocket, "round_value_updated");
    hostSocket.emit("set_round_value", {
      roomCode,
      sessionId: HOST_SESSION,
      roundValue: 50,
    });
    const data = await updated;
    expect(data.roundValue).toBe(50);
  });
});

describe("Socket.io - Buzzer Logic", () => {
  let roomCode;
  let hostSocket;
  let player1Socket;
  let player2Socket;
  const HOST_SESSION = "buzz-host-1";
  const P1_SESSION = "buzz-p1-1";
  const P2_SESSION = "buzz-p2-1";

  beforeEach(async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: HOST_SESSION });
    roomCode = createRes.body.roomCode;

    hostSocket = connectClient();
    player1Socket = connectClient();
    player2Socket = connectClient();

    const hostJoined = waitFor(hostSocket, "host_joined");
    hostSocket.emit("host_join", { roomCode, sessionId: HOST_SESSION, name: "Alice" });
    await hostJoined;

    const p1Joined = waitFor(player1Socket, "joined_room");
    player1Socket.emit("join_room", { roomCode, sessionId: P1_SESSION, name: "Player1" });
    await p1Joined;

    const p2Joined = waitFor(player2Socket, "joined_room");
    player2Socket.emit("join_room", { roomCode, sessionId: P2_SESSION, name: "Player2" });
    await p2Joined;
  });

  afterEach(() => {
    hostSocket.disconnect();
    player1Socket.disconnect();
    player2Socket.disconnect();
  });

  test("Players cannot buzz before round starts", async () => {
    // No winner event should come
    let winnerAnnounced = false;
    player1Socket.once("winner_announced", () => { winnerAnnounced = true; });
    player1Socket.emit("buzz", { roomCode, sessionId: P1_SESSION, trueTime: Date.now() });

    await new Promise((r) => setTimeout(r, 200));
    expect(winnerAnnounced).toBe(false);
  });

  test("Winner is announced after buzz window", async () => {
    const roundStarted = waitFor(player1Socket, "round_started");
    hostSocket.emit("start_round", { roomCode, sessionId: HOST_SESSION, roundValue: 10 });
    await roundStarted;

    const winnerEvent = waitFor(player1Socket, "winner_announced");
    player1Socket.emit("buzz", { roomCode, sessionId: P1_SESSION, trueTime: Date.now() });

    const winner = await winnerEvent;
    expect(winner.sessionId).toBe(P1_SESSION);
  }, 10000);

  test("NTP-adjusted TrueTime determines winner", async () => {
    const roundStarted = waitFor(player1Socket, "round_started");
    hostSocket.emit("start_round", { roomCode, sessionId: HOST_SESSION, roundValue: 10 });
    await roundStarted;

    const now = Date.now();
    // Player2 has earlier TrueTime (despite arriving second due to network)
    const winnerEvent = waitFor(hostSocket, "winner_announced");
    player1Socket.emit("buzz", { roomCode, sessionId: P1_SESSION, trueTime: now + 100 });
    player2Socket.emit("buzz", { roomCode, sessionId: P2_SESSION, trueTime: now + 50 });

    const winner = await winnerEvent;
    // Player2 had earlier TrueTime
    expect(winner.sessionId).toBe(P2_SESSION);
  }, 10000);

  test("Host can reset round - all players unlocked", async () => {
    const roundStarted = waitFor(player1Socket, "round_started");
    hostSocket.emit("start_round", { roomCode, sessionId: HOST_SESSION, roundValue: 10 });
    await roundStarted;

    const winnerEvent = waitFor(hostSocket, "winner_announced");
    player1Socket.emit("buzz", { roomCode, sessionId: P1_SESSION, trueTime: Date.now() });
    await winnerEvent;

    const resetEvent = waitFor(player1Socket, "round_reset");
    hostSocket.emit("reset_round", { roomCode, sessionId: HOST_SESSION });
    const resetData = await resetEvent;
    expect(resetData.keepWinnerLocked).toBe(false);

    // Check player is unlocked
    const room = rooms.get(roomCode);
    expect(room.players.get(P1_SESSION).locked).toBe(false);
  }, 10000);

  test("Host can reset others - winner stays locked", async () => {
    const roundStarted = waitFor(player1Socket, "round_started");
    hostSocket.emit("start_round", { roomCode, sessionId: HOST_SESSION, roundValue: 10 });
    await roundStarted;

    const winnerEvent = waitFor(hostSocket, "winner_announced");
    player1Socket.emit("buzz", { roomCode, sessionId: P1_SESSION, trueTime: Date.now() });
    await winnerEvent;

    const resetEvent = waitFor(player1Socket, "round_reset");
    hostSocket.emit("reset_others", { roomCode, sessionId: HOST_SESSION });
    await resetEvent;

    const room = rooms.get(roomCode);
    expect(room.players.get(P1_SESSION).locked).toBe(true);
    expect(room.players.get(P2_SESSION).locked).toBe(false);
  }, 10000);

  test("Host can award points to winner", async () => {
    const roundStarted = waitFor(player1Socket, "round_started");
    hostSocket.emit("start_round", { roomCode, sessionId: HOST_SESSION, roundValue: 10 });
    await roundStarted;

    const winnerEvent = waitFor(hostSocket, "winner_announced");
    player1Socket.emit("buzz", { roomCode, sessionId: P1_SESSION, trueTime: Date.now() });
    await winnerEvent;

    const pointsAwarded = waitFor(hostSocket, "points_awarded");
    hostSocket.emit("award_points", { roomCode, sessionId: HOST_SESSION });
    const data = await pointsAwarded;
    expect(data.sessionId).toBe(P1_SESSION);
    expect(data.points).toBe(10);

    const room = rooms.get(roomCode);
    expect(room.players.get(P1_SESSION).score).toBe(10);
    expect(room.players.get(P1_SESSION).buzzes).toBe(1);
  }, 10000);
});

describe("Socket.io - Session Persistence", () => {
  test("Reconnecting player gets their previous score restored", async () => {
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ hostName: "Alice", sessionId: "host-persist-1" });
    const { roomCode } = createRes.body;

    // Join and manually set a score
    const playerSocket = connectClient();
    const joinedEvent = waitFor(playerSocket, "joined_room");
    playerSocket.emit("join_room", { roomCode, sessionId: "persist-player-1", name: "Bob" });
    await joinedEvent;

    // Set score manually
    const room = rooms.get(roomCode);
    room.players.get("persist-player-1").score = 50;

    // Disconnect and reconnect with same sessionId
    playerSocket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const reconnectSocket = connectClient();
    const rejoinedEvent = waitFor(reconnectSocket, "joined_room");
    reconnectSocket.emit("join_room", { roomCode, sessionId: "persist-player-1", name: "Bob" });
    const data = await rejoinedEvent;

    expect(data.score).toBe(50);
    reconnectSocket.disconnect();
  });
});

describe("Socket.io - NTP Time Sync", () => {
  test("Server responds to time_sync_request with serverTime and clientTime", async () => {
    const socket = connectClient();
    const syncResponse = waitFor(socket, "time_sync_response");

    const clientTime = Date.now();
    socket.emit("time_sync_request", clientTime);

    const data = await syncResponse;
    expect(typeof data.serverTime).toBe("number");
    expect(data.clientTime).toBe(clientTime);
    socket.disconnect();
  });
});
