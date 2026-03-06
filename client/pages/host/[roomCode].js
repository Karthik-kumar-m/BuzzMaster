import Head from "next/head";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { getSocket, disconnectSocket, getSessionId, getExportUrl } from "@/lib/socket";

export default function HostPage() {
  const router = useRouter();
  const { roomCode } = router.query;

  const [players, setPlayers] = useState([]);
  const [currentWinner, setCurrentWinner] = useState(null);
  const [roundActive, setRoundActive] = useState(false);
  const [roundValue, setRoundValue] = useState(10);
  const [roundValueInput, setRoundValueInput] = useState("10");
  const [locked, setLocked] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustValue, setAdjustValue] = useState("");
  const socketRef = useRef(null);
  const sessionIdRef = useRef(null);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const sessionId = getSessionId();
    sessionIdRef.current = sessionId;

    const socket = getSocket();
    socketRef.current = socket;

    if (!socket.connected) socket.connect();

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("host_join", { roomCode, sessionId, name: "Host" });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("host_joined", ({ roomState }) => {
      setPlayers(roomState.players || []);
      setCurrentWinner(roomState.currentWinner);
      setRoundActive(roomState.roundActive);
      setRoundValue(roomState.roundValue);
      setRoundValueInput(String(roomState.roundValue));
      setLocked(roomState.locked);
    });

    socket.on("leaderboard_update", ({ players: p, currentWinner: cw, roundActive: ra, roundValue: rv, locked: lk }) => {
      setPlayers(p || []);
      setCurrentWinner(cw);
      setRoundActive(ra);
      if (rv !== undefined) setRoundValue(rv);
      if (lk !== undefined) setLocked(lk);
    });

    socket.on("winner_announced", ({ name }) => {
      showToast(`🏆 ${name} buzzed first!`, "success");
    });

    socket.on("points_awarded", ({ name, points }) => {
      showToast(`✅ +${points} pts awarded to ${name}`, "success");
    });

    socket.on("round_started", ({ roundValue: rv }) => {
      showToast(`▶ Round started! ${rv} pts available`, "info");
    });

    socket.on("room_locked", ({ locked: lk }) => {
      showToast(lk ? "🔒 Room locked" : "🔓 Room unlocked", "info");
    });

    socket.on("round_value_updated", ({ roundValue: rv }) => {
      setRoundValue(rv);
      setRoundValueInput(String(rv));
    });

    socket.on("score_adjusted", ({ name, newScore }) => {
      showToast(`✏️ ${name}'s score set to ${newScore}`, "info");
    });

    socket.on("error", ({ message }) => {
      showToast(`❌ ${message}`, "error");
    });

    // If socket was already connected
    if (socket.connected) {
      setConnected(true);
      socket.emit("host_join", { roomCode, sessionId, name: "Host" });
    }

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("host_joined");
      socket.off("leaderboard_update");
      socket.off("winner_announced");
      socket.off("points_awarded");
      socket.off("round_started");
      socket.off("room_locked");
      socket.off("round_value_updated");
      socket.off("score_adjusted");
      socket.off("error");
      disconnectSocket();
    };
  }, [roomCode, showToast]);

  function emit(event, extraData = {}) {
    if (!socketRef.current) return;
    socketRef.current.emit(event, {
      roomCode,
      sessionId: sessionIdRef.current,
      ...extraData,
    });
  }

  function handleStartRound() {
    const val = parseInt(roundValueInput, 10);
    emit("start_round", { roundValue: isNaN(val) || val <= 0 ? roundValue : val });
  }

  function handleSetRoundValue() {
    const val = parseInt(roundValueInput, 10);
    if (!isNaN(val) && val > 0) emit("set_round_value", { roundValue: val });
  }

  function handleAwardPoints() {
    emit("award_points");
  }

  function handleResetAll() {
    emit("reset_round");
  }

  function handleResetOthers() {
    emit("reset_others");
  }

  function handleToggleLock() {
    emit("toggle_lock");
  }

  function handleKick(targetSessionId) {
    if (!confirm("Kick and ban this player?")) return;
    emit("kick_player", { targetSessionId });
  }

  function handleAdjustScoreSubmit(e) {
    e.preventDefault();
    const val = parseInt(adjustValue, 10);
    if (isNaN(val)) return;
    emit("adjust_score", { targetSessionId: adjustTarget.sessionId, newScore: val });
    setAdjustTarget(null);
    setAdjustValue("");
  }

  function rankClass(i) {
    if (i === 0) return "gold";
    if (i === 1) return "silver";
    if (i === 2) return "bronze";
    return "";
  }

  if (!roomCode) return null;

  return (
    <>
      <Head>
        <title>Host Dashboard — {roomCode}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="page" style={{ maxWidth: "900px", margin: "0 auto", width: "100%", alignItems: "stretch" }}>
        {/* Header */}
        <div className="header">
          <span className="header-logo">⚡ BuzzMaster Pro</span>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div className="header-room-code">
              Room Code <span>{roomCode}</span>
            </div>
            <span className={"badge " + (connected ? "badge-green" : "badge-red")}>
              {connected ? "Live" : "Offline"}
            </span>
            <a href="/" className="btn btn-ghost btn-sm">← Home</a>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1rem" }}>
          {/* Left: Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Round Controls */}
            <div className="card">
              <div className="card-title">🎮 Round Controls</div>

              {currentWinner && (
                <div className="alert alert-success" style={{ marginBottom: "1rem" }}>
                  🏆 Winner: <strong>{currentWinner.name}</strong>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "flex-end" }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Round Points</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    value={roundValueInput}
                    onChange={(e) => setRoundValueInput(e.target.value)}
                    onBlur={handleSetRoundValue}
                  />
                </div>
                <button className="btn btn-ghost btn-sm" onClick={handleSetRoundValue} style={{ marginBottom: 0 }}>
                  Set
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <button
                  className={"btn " + (roundActive ? "btn-warning" : "btn-success")}
                  onClick={handleStartRound}
                  disabled={roundActive}
                >
                  {roundActive ? "⏳ Round Active" : "▶ Start Round"}
                </button>

                <button
                  className="btn btn-primary"
                  onClick={handleAwardPoints}
                  disabled={!currentWinner}
                >
                  🏆 Award Points
                </button>

                <button className="btn btn-ghost" onClick={handleResetAll} disabled={roundActive && !currentWinner}>
                  🔄 Reset All
                </button>

                <button className="btn btn-ghost" onClick={handleResetOthers} disabled={!currentWinner}>
                  🔄 Reset Others
                </button>
              </div>

              <div className="divider" />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="section-title" style={{ marginBottom: 0 }}>Room Status: </span>
                  <span className={"badge " + (locked ? "badge-red" : "badge-green")}>
                    {locked ? "🔒 Locked" : "🔓 Open"}
                  </span>
                </div>
                <button className={"btn btn-sm " + (locked ? "btn-success" : "btn-warning")} onClick={handleToggleLock}>
                  {locked ? "Unlock Room" : "Lock Room"}
                </button>
              </div>
            </div>

            {/* Export */}
            <div className="card">
              <div className="card-title">📊 Export</div>
              <a
                className="btn btn-ghost btn-full"
                href={getExportUrl(roomCode)}
                download={`buzzmaster-${roomCode}.csv`}
              >
                ⬇ Download Leaderboard CSV
              </a>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem", textAlign: "center" }}>
                Export rank, name, score, buzzes & accuracy
              </p>
            </div>

            {/* Links */}
            <div className="card">
              <div className="card-title">🔗 Quick Links</div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <a className="btn btn-ghost btn-sm" href={`/play/${roomCode}`} target="_blank" rel="noreferrer">
                  🎯 Player View
                </a>
                <a className="btn btn-ghost btn-sm" href={`/view/${roomCode}`} target="_blank" rel="noreferrer">
                  👁 Projector View
                </a>
              </div>
            </div>
          </div>

          {/* Right: Leaderboard + Players */}
          <div className="card">
            <div className="card-title">🏅 Players ({players.length})</div>
            {players.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No players yet. Share the room code!</p>
            )}
            <ul className="leaderboard">
              {players.map((p, i) => (
                <li
                  key={p.sessionId}
                  className="leaderboard-item"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem",
                    border: currentWinner && currentWinner.sessionId === p.sessionId ? "1px solid var(--success)" : undefined }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span className={"leaderboard-rank " + rankClass(i)}>#{i + 1}</span>
                    <span className="leaderboard-name">
                      {p.name}
                      {!p.connected && <span className="badge badge-red" style={{ marginLeft: "0.4rem" }}>offline</span>}
                      {p.locked && <span className="badge badge-yellow" style={{ marginLeft: "0.4rem" }}>locked</span>}
                    </span>
                    <span className="leaderboard-score">{p.score}</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setAdjustTarget(p); setAdjustValue(String(p.score)); }}
                    >
                      ✏️ Score
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleKick(p.sessionId)}>
                      🚫 Kick
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Adjust Score Modal */}
      {adjustTarget && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
          }}
          onClick={() => setAdjustTarget(null)}
        >
          <div className="card" style={{ maxWidth: "320px" }} onClick={(e) => e.stopPropagation()}>
            <div className="card-title">✏️ Adjust Score: {adjustTarget.name}</div>
            <form onSubmit={handleAdjustScoreSubmit}>
              <div className="form-group">
                <label className="form-label">New Score</label>
                <input
                  className="form-input"
                  type="number"
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn btn-primary" type="submit" style={{ flex: 1 }}>Save</button>
                <button className="btn btn-ghost" type="button" onClick={() => setAdjustTarget(null)} style={{ flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={"toast " + (toast.type === "error" ? "alert-error" : toast.type === "success" ? "alert-success" : "")}>
            {toast.msg}
          </div>
        </div>
      )}
    </>
  );
}
