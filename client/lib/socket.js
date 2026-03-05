/**
 * BuzzMaster Pro - Socket.io client utility with NTP-style offset calculation.
 */
import { io } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

let socketInstance = null;

export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: false,
    });
  }
  return socketInstance;
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

/**
 * Calculate the NTP-style clock offset between client and server.
 * Returns a promise that resolves to the offset in milliseconds.
 * TrueTime = localPressTime + offset
 */
export function syncClock(socket) {
  return new Promise((resolve) => {
    const clientTime = Date.now();
    socket.emit("time_sync_request", clientTime);
    socket.once("time_sync_response", ({ serverTime, clientTime: ct }) => {
      const rtt = Date.now() - ct;
      const offset = serverTime - ct - rtt / 2;
      resolve(offset);
    });
  });
}

/**
 * Get or create a unique session ID stored in localStorage.
 */
export function getSessionId() {
  if (typeof window === "undefined") return null;
  let id = localStorage.getItem("buzzmaster_session_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("buzzmaster_session_id", id);
  }
  return id;
}

export async function apiCreateRoom(hostName, sessionId) {
  const res = await fetch(`${API_URL}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName, sessionId }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create room");
  }
  return res.json();
}

export function getExportUrl(roomCode) {
  return `${API_URL}/api/rooms/${roomCode}/export`;
}
