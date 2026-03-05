import Head from "next/head";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { apiCreateRoom, getSessionId } from "@/lib/socket";

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState("join");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("buzzmaster_name");
    if (saved) setName(saved);
  }, []);

  async function handleHostCreate(e) {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    setError("");
    setLoading(true);
    try {
      const sessionId = getSessionId();
      localStorage.setItem("buzzmaster_name", name.trim());
      const { roomCode: code } = await apiCreateRoom(name.trim(), sessionId);
      router.push(`/host/${code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleJoin(e) {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    if (!roomCode.trim() || roomCode.trim().length !== 6) return setError("Enter a valid 6-digit room code.");
    setError("");
    localStorage.setItem("buzzmaster_name", name.trim());
    router.push(`/play/${roomCode.trim()}`);
  }

  function handleSpectate(e) {
    e.preventDefault();
    if (!roomCode.trim() || roomCode.trim().length !== 6) return setError("Enter a valid 6-digit room code.");
    setError("");
    router.push(`/view/${roomCode.trim()}`);
  }

  return (
    <>
      <Head>
        <title>BuzzMaster Pro</title>
        <meta name="description" content="Real-time buzzer system for competitive events" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="page" style={{ justifyContent: "center", paddingTop: "2rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div className="header-logo" style={{ fontSize: "2.5rem", display: "block" }}>
            ⚡ BuzzMaster Pro
          </div>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
            Real-time buzzer system for competitive events
          </p>
        </div>

        <div className="card" style={{ maxWidth: "420px" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
            {["host", "join", "spectate"].map((t) => (
              <button
                key={t}
                className={"btn btn-sm " + (tab === t ? "btn-primary" : "btn-ghost")}
                style={{ flex: 1 }}
                onClick={() => { setTab(t); setError(""); }}
              >
                {t === "host" ? "🏠 Host" : t === "join" ? "🎯 Play" : "👁 Watch"}
              </button>
            ))}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {tab === "host" && (
            <form onSubmit={handleHostCreate}>
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. Alice"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={30}
                  autoFocus
                />
              </div>
              <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
                {loading ? "Creating…" : "🚀 Create Room"}
              </button>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.75rem", textAlign: "center" }}>
                A unique 6-digit room code will be generated for you.
              </p>
            </form>
          )}

          {tab === "join" && (
            <form onSubmit={handleJoin}>
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. Bob"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={30}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Room Code</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="6-digit code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <button className="btn btn-success btn-full" type="submit">
                🎯 Join Room
              </button>
            </form>
          )}

          {tab === "spectate" && (
            <form onSubmit={handleSpectate}>
              <div className="form-group">
                <label className="form-label">Room Code</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="6-digit code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <button className="btn btn-ghost btn-full" type="submit">
                👁 Watch as Spectator
              </button>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.75rem", textAlign: "center" }}>
                Projector-optimised real-time leaderboard view.
              </p>
            </form>
          )}
        </div>

        <div style={{ marginTop: "2rem", fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center" }}>
          BuzzMaster Pro — Fair buzzing for everyone ⚡
        </div>
      </div>
    </>
  );
}
