import Head from "next/head";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { getSocket, disconnectSocket } from "@/lib/socket";

export default function ViewPage() {
  const router = useRouter();
  const { roomCode } = router.query;

  const [players, setPlayers] = useState([]);
  const [currentWinner, setCurrentWinner] = useState(null);
  const currentWinnerRef = useRef(null);
  const [roundActive, setRoundActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const winnerTimerRef = useRef(null);
  const socketRef = useRef(null);

  // Keep ref in sync with state so socket handlers avoid stale closures
  useEffect(() => { currentWinnerRef.current = currentWinner; }, [currentWinner]);

  const flashWinner = useCallback((winner) => {
    setCurrentWinner(winner);
    setShowWinner(true);
    if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
    // Auto-hide after 5 seconds, but keep winner info
    winnerTimerRef.current = setTimeout(() => setShowWinner(false), 5000);
  }, []);

  useEffect(() => {
    if (!roomCode) return;

    const socket = getSocket();
    socketRef.current = socket;
    if (!socket.connected) socket.connect();

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("spectator_join", { roomCode });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("spectator_joined", ({ players: p, currentWinner: cw, roundActive: ra }) => {
      setPlayers(p || []);
      setCurrentWinner(cw);
      setRoundActive(ra);
      if (cw) setShowWinner(true);
    });

    socket.on("leaderboard_update", ({ players: p, currentWinner: cw, roundActive: ra }) => {
      setPlayers(p || []);
      setRoundActive(ra);
      if (cw && (!currentWinnerRef.current || cw.sessionId !== currentWinnerRef.current?.sessionId)) {
        flashWinner(cw);
      } else if (!cw) {
        setCurrentWinner(null);
        setShowWinner(false);
      }
    });

    socket.on("winner_announced", ({ name, sessionId }) => {
      flashWinner({ name, sessionId });
    });

    socket.on("round_started", () => {
      setCurrentWinner(null);
      setShowWinner(false);
      setRoundActive(true);
    });

    socket.on("round_reset", () => {
      setCurrentWinner(null);
      setShowWinner(false);
      setRoundActive(false);
    });

    if (socket.connected) {
      setConnected(true);
      socket.emit("spectator_join", { roomCode });
    }

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("spectator_joined");
      socket.off("leaderboard_update");
      socket.off("winner_announced");
      socket.off("round_started");
      socket.off("round_reset");
      disconnectSocket();
      if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
    };
  }, [roomCode, flashWinner]);

  function rankStyle(i) {
    if (i === 0) return { color: "#fbbf24", fontSize: "2.5rem", fontWeight: 900 };
    if (i === 1) return { color: "#94a3b8", fontSize: "2rem", fontWeight: 800 };
    if (i === 2) return { color: "#d97706", fontSize: "1.75rem", fontWeight: 800 };
    return { color: "var(--text)", fontSize: "1.5rem", fontWeight: 700 };
  }

  if (!roomCode) return null;

  return (
    <>
      <Head>
        <title>BuzzMaster — Room {roomCode} (Projector)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem 2rem",
          gap: "1.5rem",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="header-logo" style={{ fontSize: "2rem" }}>⚡ BuzzMaster Pro</span>
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div className="header-room-code" style={{ fontSize: "1.1rem" }}>
              Room Code <span style={{ fontSize: "2rem" }}>{roomCode}</span>
            </div>
            <span className={"badge " + (connected ? "badge-green" : "badge-red")} style={{ fontSize: "1rem" }}>
              {connected ? "● Live" : "● Offline"}
            </span>
            <span className={"badge " + (roundActive ? "badge-green" : "badge-red")} style={{ fontSize: "1rem" }}>
              {roundActive ? "Round Active" : "Round Idle"}
            </span>
          </div>
        </div>

        {/* Winner Spotlight */}
        {showWinner && currentWinner && (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))",
              border: "2px solid var(--primary)",
              borderRadius: "var(--radius)",
              animation: "winnerPop 0.5s ease",
            }}
          >
            <div style={{ fontSize: "1rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "0.5rem" }}>
              ⚡ Fastest Finger
            </div>
            <div style={{ fontSize: "clamp(3rem, 8vw, 6rem)", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>
              🏆 {currentWinner.name}
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "1rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "1rem", fontWeight: 700 }}>
            Live Leaderboard
          </div>

          {players.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "1.5rem", marginTop: "3rem" }}>
              Waiting for players to join…
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {players.map((p, i) => (
                <div
                  key={p.sessionId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1.5rem",
                    padding: "1rem 1.5rem",
                    background: currentWinner && currentWinner.sessionId === p.sessionId
                      ? "rgba(251,191,36,0.1)"
                      : "var(--surface)",
                    border: currentWinner && currentWinner.sessionId === p.sessionId
                      ? "2px solid #fbbf24"
                      : "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    transition: "all 0.3s ease",
                  }}
                >
                  <div style={{ ...rankStyle(i), minWidth: "3rem", textAlign: "center" }}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "clamp(1.25rem, 3vw, 2rem)", fontWeight: 800 }}>
                      {p.name}
                      {!p.connected && (
                        <span className="badge badge-red" style={{ marginLeft: "0.75rem", fontSize: "0.7rem" }}>offline</span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                      {p.buzzes} successful buzz{p.buzzes !== 1 ? "es" : ""}
                    </div>
                  </div>
                  <div style={{ fontSize: "clamp(1.5rem, 4vw, 3rem)", fontWeight: 900, color: "var(--primary)" }}>
                    {p.score}
                    <span style={{ fontSize: "0.6em", color: "var(--text-muted)", marginLeft: "0.25rem" }}>pts</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Join at this device and enter room code <strong style={{ color: "var(--text)", letterSpacing: "0.1em" }}>{roomCode}</strong>
        </div>
      </div>

      <style jsx global>{`
        @keyframes winnerPop {
          0% { transform: scale(0.8); opacity: 0; }
          60% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}
