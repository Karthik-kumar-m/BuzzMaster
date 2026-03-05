# ⚡ BuzzMaster Pro

A high-performance, real-time buzzer system for competitive environments (e.g., college technical fests). Prioritises **latency fairness**, **session persistence**, and **advanced host controls**.

## Screenshots

| Home | Host Dashboard | Player Buzzer | Projector View |
|------|---------------|---------------|----------------|
| ![Home](https://github.com/user-attachments/assets/96d50435-d63c-47aa-9cfe-f43bd42681ef) | ![Host](https://github.com/user-attachments/assets/5015f332-99c0-477d-b43d-ce5b94bf3c12) | ![Player](https://github.com/user-attachments/assets/f30f7053-8f0c-4cdf-879a-cc4ee5cda1a5) | ![Spectator](https://github.com/user-attachments/assets/32c7cabf-b673-490c-99cb-d6e3f9c88504) |

## Project Structure

```
BuzzMaster/
├── server/          # Node.js + Express + Socket.io backend
│   ├── index.js     # Main server entry point
│   └── tests/       # Jest test suite (25 tests)
└── client/          # Next.js frontend
    ├── pages/
    │   ├── index.js           # Home — create/join/watch
    │   ├── host/[roomCode].js # Host dashboard
    │   ├── play/[roomCode].js # Player buzzer (mobile-first)
    │   └── view/[roomCode].js # Projector/spectator view
    └── lib/
        └── socket.js          # Socket.io client + NTP sync utility
```

## Getting Started

### Install dependencies

```bash
npm run install:all
```

### Start development servers

```bash
# Terminal 1 — Backend (port 4000)
npm run dev:server

# Terminal 2 — Frontend (port 3000)
npm run dev:client
```

Then open [http://localhost:3000](http://localhost:3000).

### Run tests

```bash
npm test
```

## Features

### 🏠 Host
- Generate a unique **6-digit room code**
- **Lock Room** — prevents new players from joining
- **Variable Points** — set the point value before each round
- **Award / Reset** — award points to the winner, reset all locks, or reset others (keeping the winner locked)
- **Kick & Ban** — remove disruptive players by session ID
- **Manual Score Override** — adjust any player's score at any time
- **CSV Export** — download final leaderboard (Rank, Name, Score, Buzzes, Accuracy %)

### 🎯 Player
- **Persistent login** — session UUID in `localStorage`; automatically reconnects after network drops
- **Visual buzzer states** — 🔴 Waiting / 🟢 Active / 🟡 Buzzed / 🏆 Won / ❌ Lost / 🔒 Locked
- **Haptic feedback** — vibration on successful buzz and round reset
- **Keyboard shortcut** — `Space` to buzz on desktop
- **Mini leaderboard** — live score updates below the buzzer

### 👁 Spectator (Projector View)
- Full-screen **real-time leaderboard**
- Animated **"Fastest Finger" winner spotlight**
- Room status indicators (Live / Round Active)

## Fairness: NTP-Style Clock Sync

To eliminate the "internet speed advantage":

1. The client measures its **clock offset** against the server (`TrueTime = localPressTime + offset`)
2. The server collects all buzzes within a **50 ms window**
3. Buzzes are sorted by `TrueTime` — the earliest true press wins, regardless of network latency

## Security

- **Rate limiting** — max 3 buzz attempts per player per 2 seconds (anti-autoclicker)
- **Session ban** — kicked players are blacklisted by session ID
- **Host authentication** — all host actions verified against `hostSessionId`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (React, Pages Router) |
| Backend | Node.js + Express |
| Real-time | Socket.io |
| State | In-memory (Map) — ready for Redis upgrade |
| Tests | Jest + Supertest + socket.io-client |
