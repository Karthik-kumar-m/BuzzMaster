import Head from "next/head";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { getSocket, disconnectSocket, syncClock, getSessionId } from "@/lib/socket";

// Buzzer states
const STATE = {
  WAITING: "waiting",   // Red  - Host hasn't started the round
  ACTIVE: "active",     // Green - Go! Buzz now
  PRESSED: "pressed",   // Yellow - You buzzed, waiting for host
  WON: "won",           // Gold - You won this round
  LOST: "lost",         // Grey - Someone else won
  LOCKED: "locked",     // Locked out for this question
};

export default function PlayPage() {
  const router = useRouter();
  const { roomCode } = router.query;

  const [playerName, setPlayerName] = useState("");
  const [score, setScore] = useState(0);
  const [buzzerState, setBuzzerState] = useState(STATE.WAITING);
  const [roundValue, setRoundValue] = useState(10);
  const [winnerName, setWinnerName] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [roomLocked, setRoomLocked] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  const socketRef = useRef(null);
  const sessionIdRef = useRef(null);
  const clockOffsetRef = useRef(0);
  const buzzerStateRef = useRef(STATE.WAITING);
  const handleBuzzRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast({ msg, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Sync buzzerState ref with state
  useEffect(() => { buzzerStateRef.current = buzzerState; }, [buzzerState]);

  // Haptic feedback helper
  function vibrate(pattern) {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  useEffect(() => {
    if (!roomCode) return;

    const sessionId = getSessionId();
    sessionIdRef.current = sessionId;
    const name = localStorage.getItem("buzzmaster_name") || "Player";
    setPlayerName(name);

    const socket = getSocket();
    socketRef.current = socket;

    async function connectAndJoin() {
      if (!socket.connected) socket.connect();
    }

    socket.on("connect", async () => {
      setConnected(true);
      setError("");
      // Sync clock with server
      try {
        const offset = await syncClock(socket);
        clockOffsetRef.current = offset;
      } catch (_) { /* use 0 offset */ }
      // Join the room
      socket.emit("join_room", { roomCode, sessionId, name });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("joined_room", ({ name: n, score: s, locked: lk, roundActive, roundValue: rv, currentWinner }) => {
      setJoined(true);
      setPlayerName(n);
      setScore(s);
      setRoundValue(rv || 10);
      if (currentWinner) {
        setWinnerName(currentWinner.name);
        setBuzzerState(lk ? STATE.LOCKED : STATE.PRESSED);
      } else if (roundActive) {
        setBuzzerState(lk ? STATE.LOCKED : STATE.ACTIVE);
      } else {
        setBuzzerState(lk ? STATE.LOCKED : STATE.WAITING);
      }
    });

    socket.on("round_started", ({ roundValue: rv }) => {
      setRoundValue(rv);
      setWinnerName("");
      setBuzzerState((prev) => prev === STATE.LOCKED ? STATE.LOCKED : STATE.ACTIVE);
      vibrate(50);
      showToast("▶ Round started! Buzz now!");
    });

    socket.on("winner_announced", ({ name: n }) => {
      setWinnerName(n);
    });

    socket.on("buzz_acknowledged", () => {
      setBuzzerState(STATE.PRESSED);
    });

    socket.on("buzz_result", ({ won, winnerName: wn }) => {
      setWinnerName(wn);
      if (won) {
        setBuzzerState(STATE.WON);
        vibrate([100, 50, 100]);
        showToast("🏆 You buzzed first!");
      } else {
        setBuzzerState(STATE.LOST);
      }
    });

    socket.on("buzz_rejected", ({ reason }) => {
      showToast(`Buzz rejected: ${reason}`);
      setBuzzerState(STATE.ACTIVE);
    });

    socket.on("round_reset", ({ keepWinnerLocked, winnerSessionId }) => {
      const mySessionId = sessionIdRef.current;
      vibrate([30, 30, 30]);
      if (keepWinnerLocked && winnerSessionId === mySessionId) {
        setBuzzerState(STATE.LOCKED);
      } else {
        setBuzzerState(STATE.WAITING);
        setWinnerName("");
      }
    });

    socket.on("leaderboard_update", ({ players, roundValue: rv }) => {
      setLeaderboard(players || []);
      if (rv !== undefined) setRoundValue(rv);
      // Update our own score
      const me = (players || []).find((p) => p.sessionId === sessionIdRef.current);
      if (me) setScore(me.score);
    });

    socket.on("points_awarded", ({ sessionId: sid, points }) => {
      if (sid === sessionIdRef.current) {
        setScore((s) => s + points);
        showToast(`+${points} points!`);
      }
    });

    socket.on("room_locked", ({ locked: lk }) => {
      setRoomLocked(lk);
    });

    socket.on("kicked", ({ reason }) => {
      setError(`You were removed: ${reason}`);
      setBuzzerState(STATE.WAITING);
      disconnectSocket();
    });

    socket.on("error", ({ message }) => {
      setError(message);
    });

    connectAndJoin();

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("joined_room");
      socket.off("round_started");
      socket.off("winner_announced");
      socket.off("buzz_acknowledged");
      socket.off("buzz_result");
      socket.off("buzz_rejected");
      socket.off("round_reset");
      socket.off("leaderboard_update");
      socket.off("points_awarded");
      socket.off("room_locked");
      socket.off("kicked");
      socket.off("error");
      disconnectSocket();
    };
  }, [roomCode, showToast]);

  // Keep handleBuzzRef current so the stable keydown listener always calls latest version
  handleBuzzRef.current = handleBuzz;

  // Keyboard shortcut: Spacebar to buzz — registered once via stable ref
  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (handleBuzzRef.current) handleBuzzRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleBuzz() {
    const state = buzzerStateRef.current;
    if (state !== STATE.ACTIVE) return;
    const socket = socketRef.current;
    if (!socket) return;

    const localTime = Date.now();
    const trueTime = localTime + clockOffsetRef.current;

    socket.emit("buzz", {
      roomCode,
      sessionId: sessionIdRef.current,
      trueTime,
    });
    setBuzzerState(STATE.PRESSED);
  }

  function getBuzzerStyle() {
    const base = {
      width: "min(80vw, 320px)",
      height: "min(80vw, 320px)",
      borderRadius: "50%",
      border: "none",
      fontSize: "clamp(1.5rem, 8vw, 2.5rem)",
      fontWeight: 900,
      cursor: "pointer",
      transition: "transform 0.1s, box-shadow 0.2s",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "0.5rem",
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
    };

    switch (buzzerState) {
      case STATE.ACTIVE:
        return { ...base, background: "radial-gradient(circle, #22c55e, #16a34a)", color: "#fff",
          boxShadow: "0 0 60px #22c55e88, 0 0 20px #22c55e44" };
      case STATE.PRESSED:
        return { ...base, background: "radial-gradient(circle, #f59e0b, #d97706)", color: "#000",
          boxShadow: "0 0 40px #f59e0b55", transform: "scale(0.95)" };
      case STATE.WON:
        return { ...base, background: "radial-gradient(circle, #fbbf24, #f59e0b)", color: "#000",
          boxShadow: "0 0 80px #fbbf2488, 0 0 40px #fbbf2444" };
      case STATE.LOST:
        return { ...base, background: "radial-gradient(circle, #475569, #1e293b)", color: "var(--text-muted)",
          boxShadow: "none", cursor: "not-allowed" };
      case STATE.LOCKED:
        return { ...base, background: "radial-gradient(circle, #334155, #1e293b)", color: "var(--text-muted)",
          boxShadow: "none", cursor: "not-allowed" };
      default: // WAITING
        return { ...base, background: "radial-gradient(circle, #ef4444, #b91c1c)", color: "#fff",
          boxShadow: "0 0 30px #ef444433", cursor: "not-allowed" };
    }
  }

  function getBuzzerLabel() {
    switch (buzzerState) {
      case STATE.ACTIVE: return <><span>🟢</span><span>BUZZ!</span></>;
      case STATE.PRESSED: return <><span>🟡</span><span>Buzzed!</span></>;
      case STATE.WON: return <><span>🏆</span><span>You Won!</span></>;
      case STATE.LOST: return <><span>❌</span><span>{winnerName} Won</span></>;
      case STATE.LOCKED: return <><span>🔒</span><span>Locked</span></>;
      default: return <><span>🔴</span><span>Waiting…</span></>;
    }
  }

  return (
    <>
      <Head>
        <title>Play — {playerName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <div className="page" style={{ justifyContent: "flex-start", gap: "1rem", paddingTop: "1rem" }}>
        {/* Header */}
        <div className="header" style={{ maxWidth: "500px" }}>
          <span className="header-logo" style={{ fontSize: "1.2rem" }}>⚡ BuzzMaster</span>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <span className="header-room-code">
              Room <span>{roomCode}</span>
            </span>
            <span className={"badge " + (connected ? "badge-green" : "badge-red")}>
              {connected ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ maxWidth: "500px", width: "100%" }}>
            {error}
          </div>
        )}

        {/* Player Info */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text)" }}>{playerName}</div>
          <div style={{ fontSize: "2rem", fontWeight: 900, color: "var(--primary)" }}>
            {score} <span style={{ fontSize: "1rem", color: "var(--text-muted)" }}>pts</span>
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Round value: <strong style={{ color: "var(--warning)" }}>{roundValue} pts</strong>
          </div>
        </div>

        {/* Buzzer Button */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <button
            style={getBuzzerStyle()}
            onClick={handleBuzz}
            disabled={buzzerState !== STATE.ACTIVE}
            aria-label="Buzz"
          >
            {getBuzzerLabel()}
          </button>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Press <kbd style={{ background: "var(--surface2)", padding: "0.1rem 0.4rem", borderRadius: "4px", border: "1px solid var(--border)" }}>Space</kbd> to buzz
          </p>
        </div>

        {/* Winner Banner */}
        {winnerName && buzzerState !== STATE.ACTIVE && (
          <div
            style={{
              textAlign: "center",
              padding: "0.75rem 1.5rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              maxWidth: "400px",
              width: "100%",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Fastest Finger
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--warning)" }}>
              🏆 {winnerName}
            </div>
          </div>
        )}

        {/* Mini Leaderboard */}
        {leaderboard.length > 0 && (
          <div style={{ width: "100%", maxWidth: "500px" }}>
            <div className="section-title">Leaderboard</div>
            <ul className="leaderboard">
              {leaderboard.slice(0, 5).map((p, i) => (
                <li
                  key={p.sessionId}
                  className="leaderboard-item"
                  style={{ background: p.sessionId === sessionIdRef.current ? "rgba(99,102,241,0.1)" : undefined }}
                >
                  <span className={"leaderboard-rank " + (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "")}>
                    #{i + 1}
                  </span>
                  <span className="leaderboard-name">{p.name}</span>
                  <span className="leaderboard-score">{p.score}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {toast && (
        <div className="toast-container">
          <div className="toast">{toast.msg}</div>
        </div>
      )}
    </>
  );
}
