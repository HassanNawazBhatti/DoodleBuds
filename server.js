const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const db = require('./db');
require('dotenv').config();



app.use(express.json());

// session middleware - lets us know who is logged in on every request
app.use(session({
    secret: 'doodlebuds-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));


// signups that haven't been verified yet live here in memory,
// keyed by email. Nothing goes into the database until verification succeeds.
let pendingSignups = {};

const port = process.env.PORT !! 3000;

// Fast in-memory cache of active rooms. The database (db.js) is the
// durable source of truth; this Map just avoids round-tripping to the
// DB on every draw event. If a room isn't cached (e.g. right after a
// server restart), getOrLoadRoom() rehydrates it from the DB on demand.
let rooms = new Map();

// Grace window for socket disconnects (page refresh, brief network drop)
// before we treat someone as having actually left the room.
const DISCONNECT_GRACE_MS = 20000;
let pendingDisconnects = new Map();

const server = http.createServer(app);
const io = new Server(server);

// this route MUST come before express.static, otherwise static
// would serve main-menu.html directly without checking the session
app.get('/main-menu.html', function(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/');
    }


    next();
});
app.get('/canvas.html', function(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/');
    }
    
    next();
});

app.use(express.static(path.join(__dirname)));

app.get('/', function(req , res) {
    if(req.session.user) {
    }
    res.sendFile(path.join(__dirname, 'auth.html'));
});

db.init().then(() => {
    server.listen(port, '0.0.0.0' ()=> {
        console.log('ohh yeah!! listening on port 3000 !!')
    })
}).catch((err) => {
    console.log("Failed to initialize database:", err);
    process.exit(1);
});

// configure this with your real email + an app password (not your normal password)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL,
        pass: process.env.APP_KEY
    }
});

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sendVerificationCode(email, code) {
    transporter.sendMail({
        from: process.env.GMAIL,
        to: email,
        subject: 'DoodleBuds Verification Code',
        text: `Your verification code is ${code}. It expires in 10 minutes.
        Verify Your Account, and Start Doodlifying Your Day.`
    }, function(err) {
        if (err) console.log("Email error:", err);
    });
}

async function generateRoomCode() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const digits = "0123456789";

    let code = "";

    for (let i = 0; i < 2; i++) {
        code += letters[Math.floor(Math.random() * letters.length)];
    }

    for (let i = 0; i < 2; i++) {
        code += digits[Math.floor(Math.random() * digits.length)];
    }

    if (rooms.has(code)) {
        return generateRoomCode();
    }

    // also check the database, in case a room exists there but hasn't
    // been loaded into the in-memory cache yet (e.g. right after a restart)
    const existing = await db.getRoom(code);
    if (existing) {
        return generateRoomCode();
    }

    return code;
}

function ensureRoomUser(room, owner) {
    if (!room.strokes[owner]) room.strokes[owner] = [];
    if (!room.history[owner]) room.history[owner] = [];
}

// Loads a room into the in-memory cache from the database if it isn't
// already cached. Returns null if the room doesn't exist anywhere.
async function getOrLoadRoom(code) {
    if (rooms.has(code)) return rooms.get(code);

    const dbRoom = await db.getRoom(code);
    if (!dbRoom) return null;

    const members = await db.getMembers(code);
    const { strokes, history } = await db.getRoomState(code);

    const room = {
        code,
        creator: { id: dbRoom.creator_id, username: dbRoom.creator_username },
        members,
        strokes,
        history
    };

    rooms.set(code, room);
    return room;
}

// Shared cleanup used both when a user explicitly leaves (logout, solo,
// creating/joining another room) and when a socket disconnect's grace
// period expires without a reconnect.
async function removeMemberFromRoom(roomCode, userId) {
    const room = rooms.get(roomCode) || await getOrLoadRoom(roomCode);
    if (!room) return;

    if (room.creator && room.creator.id === userId && !room.creator.username.endsWith(" (left)")) {
        room.creator.username = room.creator.username + " (left)";
        db.setCreatorUsername(roomCode, room.creator.username).catch(err => console.log("DB error:", err));
    }

    room.members = room.members.filter(m => m.id !== userId);
    db.removeMember(roomCode, userId).catch(err => console.log("DB error:", err));

    if (room.members.length === 0) {
        rooms.delete(roomCode);
        db.deleteRoom(roomCode).catch(err => console.log("DB error:", err));
    }
}

async function leaveRoom(user){

    if(!user || !user.inRoom) return;

    await removeMemberFromRoom(user.roomCode, user.id);

    user.inRoom = false;
    user.roomCode = null;
}

io.on("connection", (socket) => {

    console.log("Socket connected:", socket.id);

    socket.on("disconnect", () => {

        console.log("Socket disconnected:", socket.id);

        if (socket.roomCode && socket.userId) {
            socket.to(socket.roomCode).emit("remote-stroke", { owner: socket.userId, points: [] });

            // don't immediately drop the user from the room -- a page
            // refresh or brief network blip also fires "disconnect", and
            // the client reconnects and re-joins within a second or two.
            // Only finalize the leave if they don't come back in time.
            const key = socket.roomCode + ":" + socket.userId;
            const timer = setTimeout(() => {
                pendingDisconnects.delete(key);
                removeMemberFromRoom(socket.roomCode, socket.userId).catch(err => console.log("DB error:", err));
            }, DISCONNECT_GRACE_MS);
            pendingDisconnects.set(key, timer);
        }

    });

    socket.on("join-room", async ({ roomCode, userId }) => {

        socket.join(roomCode);

        socket.roomCode = roomCode;
        socket.userId = userId;

        console.log(
            `User ${userId} joined socket room ${roomCode}`
        );

        // reconnecting to the same room cancels any pending "they left" cleanup
        const key = roomCode + ":" + userId;
        if (pendingDisconnects.has(key)) {
            clearTimeout(pendingDisconnects.get(key));
            pendingDisconnects.delete(key);
        }

        const room = await getOrLoadRoom(roomCode);
        if (room) {
            socket.emit("room-state", { strokes: room.strokes, history: room.history });
        }

    });

    socket.on("stroke-finished", (stroke) => {

        const room = rooms.get(socket.roomCode);
        if (room && stroke.points && stroke.points.length > 0) {
            stroke.seq = Date.now();
            ensureRoomUser(room, stroke.owner);
            room.strokes[stroke.owner].push(stroke);
            room.history[stroke.owner] = [];

            // persist in the background -- don't hold up the broadcast below
            db.saveStroke({ ...stroke, roomCode: socket.roomCode }).catch(err => console.log("DB error:", err));
        }

        io.to(socket.roomCode).emit("remote-stroke", stroke);

    });

    socket.on("live-stroke", (data) => {
        socket.to(socket.roomCode).emit("remote-live-stroke", data);
    });

    socket.on("live-segment", (data) => {
        socket.to(socket.roomCode).emit("remote-live-segment", data);
    });

    socket.on("user-undo", (data) => {
        const room = rooms.get(socket.roomCode);
        if (room) {
            ensureRoomUser(room, data.owner);
            if (room.strokes[data.owner].length > 0) {
                const last = room.strokes[data.owner].pop();
                room.history[data.owner].push(last);
                db.undoLastStroke(socket.roomCode, data.owner).catch(err => console.log("DB error:", err));
            }
        }
        socket.to(socket.roomCode).emit("remote-user-undo", data);
    });

    socket.on("user-redo", (data) => {
        const room = rooms.get(socket.roomCode);
        if (room) {
            ensureRoomUser(room, data.owner);
            if (room.history[data.owner].length > 0) {
                const next = room.history[data.owner].pop();
                room.strokes[data.owner].push(next);
                db.redoLastStroke(socket.roomCode, data.owner).catch(err => console.log("DB error:", err));
            }
        }
        socket.to(socket.roomCode).emit("remote-user-redo", data);
    });

    socket.on("clear-canvas", () => {
        const room = rooms.get(socket.roomCode);
        if (room) {
            room.strokes = {};
            room.history = {};
            db.clearRoomStrokes(socket.roomCode).catch(err => console.log("DB error:", err));
        }
        socket.to(socket.roomCode).emit("remote-clear-canvas");
    });

});

app.post('/register', async function(req, res) {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.json({ success: false, message: "All fields are required!", redirect: null });
    }
    if (username.length < 3) {
        return res.json({ success: false, message: "Username must be at least 3 characters!", redirect: null });
    }
    if (!isValidEmail(email)) {
        return res.json({ success: false, message: "Invalid email format!", redirect: null });
    }
    if (password.length < 6) {
        return res.json({ success: false, message: "Password must be at least 6 characters!", redirect: null });
    }

    try {
        const existingUser = await db.getUserByEmailOrUsername(email, username);
        if (existingUser) {
            return res.json({ success: false, message: "Username or email already registered. Please login.", redirect: null });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

        // already has an unverified signup in progress -> just refresh the code
        // and pop the verification UI again instead of erroring out
        pendingSignups[email] = { username, email, password, code, expires };

        sendVerificationCode(email, code);

        res.json({ success: true, message: "Signup successful! Check your email for the verification code.", redirect: null });
    } catch (err) {
        return res.json({ success: false, message: "Database Error!!", redirect: null });
    }
}); 

app.post('/resend-code', function(req, res) {
    const { email } = req.body;
    const pending = pendingSignups[email];

    if (!pending) {
        return res.json({ success: false, message: "No pending signup found. Please sign up again.", redirect: null });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000;
    pending.code = code;
    pending.expires = expires;

    sendVerificationCode(email, code);

    res.json({ success: true, message: "Verification code resent!", redirect: null });
});

app.post('/verify', async function(req, res) {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.json({ success: false, message: "All fields are required!", redirect: null });
    }

    const pending = pendingSignups[email];

    if (!pending) {
        return res.json({ success: false, message: "No pending signup found. Please sign up again.", redirect: null });
    }
    if (Date.now() > pending.expires) {
        delete pendingSignups[email];
        return res.json({ success: false, message: "Code expired! Please sign up again.", redirect: null });
    }
    if (pending.code !== code) {
        return res.json({ success: false, message: "Invalid code!", redirect: null });
    }

    try {
        const newId = await db.insertUser(pending.username, pending.email, pending.password);

        delete pendingSignups[email];

        // log the user in immediately, no need to visit /login after verifying
        req.session.user = { id: newId, username: pending.username, email: pending.email, inRoom: false, roomCode: null };

        res.json({ success: true, message: "Verified!", redirect: "/main-menu.html" });
    } catch (err) {
        return res.json({ success: false, message: "User already exists or error occurred", redirect: null });
    }
});


app.post('/login', async function(req,res) {
    const {email, password} = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: "All fields are required!", redirect: null });
    }

    try {
        const user = await db.getUserByEmail(email);

        if(!user){
            return res.json({ success: false, message: "Email Not Found!!", redirect: null })
        }
        if (user.password !== password){
            return res.json({ success: false, message: "Invalid Password!!", redirect: null })
        }

        req.session.user = { id: user.id, username: user.username, email: user.email, inRoom: false, roomCode: null };

        res.json({ success: true, message: "Login successful!", redirect: "/main-menu.html" })
    } catch (err) {
        return res.json({ success: false, message: "Database Error!!", redirect: null })
    }
})

// main-menu.html (or any future page) can call this to get the current user's data
app.get('/session-user', function(req, res) {
    if (!req.session.user) {
        return res.json({ success: false, message: "Not logged in" });
    }
    res.json({ success: true, user: req.session.user });
});

app.post('/logout', async function(req, res) {
    await leaveRoom(req.session.user);
    req.session.destroy(function(err){
        if (err){
            return res.json({ success: false, message: "Could not log out" });
        }
        res.json({ success: true, message: "Logged out", redirect: "/" });
    });
});

app.post('/solo', async function(req, res) {
    await leaveRoom(req.session.user);
    res.json({ success: true, message: "Starting solo game", redirect: "/canvas.html" });
})

app.post('/create-room', async function(req, res) {
    await leaveRoom(req.session.user);
    const roomCode = await generateRoomCode();
    let user = req.session.user;

    const creator = { id: user.id, username: user.username };
    rooms.set(roomCode, {
        code: roomCode,
        creator,
        members: [{ id: user.id, username: user.username }],
        strokes: {},
        history: {}
    })
    user.inRoom = true;
    user.roomCode = roomCode;

    db.createRoom(roomCode, creator).catch(err => console.log("DB error:", err));

    res.json({ success: true, message: "Creating room", redirect: "/canvas.html" });
})

app.post('/join-room', async function(req, res) {
    await leaveRoom(req.session.user);
    const roomCode = req.body.code.toUpperCase();

    const room = await getOrLoadRoom(roomCode);

    if (room) {
        let user = req.session.user;
        if (!room.members.some(m => m.id === user.id)) {
            room.members.push({ id: user.id, username: user.username });
        }
        user.inRoom = true;
        user.roomCode = roomCode;
        if(room.creator && room.creator.id === user.id){
            room.creator.username = room.creator.username.replace(" (left)", "");
            db.setCreatorUsername(roomCode, room.creator.username).catch(err => console.log("DB error:", err));
        }

        db.addMember(roomCode, user.id, user.username).catch(err => console.log("DB error:", err));

        return res.json({ success: true, message: "Joining room", redirect: "/canvas.html" }); 
    }
    else {
        return res.json({ success: false, message: "Room not found", redirect: null });
    }
})

app.get('/session-room', async function(req, res) {
    if (!req.session.user || !req.session.user.inRoom) {
        return res.json({ success: false, message: "Not in a room" });
    }

    const code = req.session.user.roomCode;
    const room = await getOrLoadRoom(code);

    if (!room) {
        return res.json({ success: false, message: "Room not found" });
    }

    res.json({
        success: true,
        room: room
    });
});
