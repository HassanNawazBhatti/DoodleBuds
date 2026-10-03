# 🎨 DoodleBuds

**A real-time collaborative drawing canvas — sketch, doodle, and create together, live.**

DoodleBuds lets you open a shared canvas with friends and watch each other draw in real time. Pick a tool, pick a color, and start sketching — every stroke shows up on everyone's screen as it happens, cursor labels and all.

---

## ✨ What it does

- **Draw together, live.** Every pen stroke, shape, and erase is broadcast instantly to everyone in the room — no refreshing, no lag.
- **Rooms, your way.** Spin up a private room with an auto-generated code, invite friends to join, or just draw solo.
- **A proper toolkit.** Pen, Neon (with a genuine glowing effect), and Eraser — plus Freehand, Line, Rectangle, and Circle shapes, each with adjustable color and brush size.
- **Undo/redo that makes sense.** Every artist in the room has their own independent undo/redo history — fixing your last stroke never touches anyone else's.
- **See who's drawing where.** Live cursor labels show you exactly where your collaborators are working, in real time.
- **Accounts that actually stick.** Sign up with email verification, log in, and your account and rooms persist — restarting the server doesn't wipe your data.
- **Built to handle real-world connections.** Brief wifi drops or a locked phone screen won't kick you out of a room or duplicate your strokes.

---

## 🛠️ Built with

- **Node.js** + **Express** — server and routing
- **Socket.IO** — the real-time engine behind every live stroke, cursor, and room event
- **Turso (libSQL)** — persistent, hosted database for accounts, rooms, and drawing history
- **Nodemailer** — email verification during signup
- **Vanilla JavaScript + the HTML5 Canvas API** — no frontend framework, no bloat. Every brush stroke, shape, and redraw is hand-built directly on `<canvas>`.

No shortcuts, no page builders — the whole thing is written from scratch.

---

## 🧱 How it's put together

```
├── server.js        → Express server, auth routes, Socket.IO event handling
├── db.js             → Database layer (users, rooms, strokes) via Turso/libSQL
├── canvas.html        → The drawing canvas, tools, and all client-side logic
├── auth.html / .css    → Sign up, verify, and log in
├── main-menu.html / .css → Solo / create room / join room
└── canvas.css          → Canvas page styling
```

The server keeps a fast in-memory cache of active rooms for smooth, low-latency drawing, while every account, room, and finished stroke is persisted to the database in the background — so performance stays snappy without sacrificing durability.

---

## 🚀 Getting started locally

**1. Clone the repo and install dependencies**

```bash
git clone <your-repo-url>
cd doodlebuds
npm install
```

**2. Set up your environment variables**

Create a `.env` file in the project root:

```
GMAIL=your-gmail-address
APP_KEY=your-gmail-app-password
TURSO_DATABASE_URL=libsql://your-database-url.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token
```

**3. Run it**

```bash
node server.js
```

Visit `http://localhost:3000` and you're in.

---

## ☁️ Deployment

DoodleBuds is built to deploy cleanly on platforms like **Render**, with **Turso** handling persistent storage — so there's no dependency on local disk, and restarts or redeploys never cost you your data.

**Live at:** `[your deployed URL here]`

---

## 📌 Project status

DoodleBuds is live and fully functional — accounts, rooms, and real-time collaborative drawing all work end to end, backed by a persistent database. This is **v1**: a complete, working foundation. From here, development continues with an eye toward hardening, polish, and new features.

---

## 🙋 About this project

DoodleBuds was built hands-on, feature by feature, not generated — every decision about how the canvas renders, how rooms sync, and how the pieces fit together was made deliberately along the way.

**Developed by Hassan Nawaz.**
