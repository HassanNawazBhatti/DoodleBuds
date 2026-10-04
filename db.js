const { createClient } = require('@libsql/client');
require('dotenv').config();

// Local file by default (zero setup, works out of the box).
// Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN to point this at a hosted
// Turso database instead -- no other code change needed.
const client = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:./users.db',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined
});

async function init() {
    await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT
        )
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            creator_id INTEGER,
            creator_username TEXT,
            created_at INTEGER
        )
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS room_members (
            room_code TEXT,
            user_id INTEGER,
            username TEXT,
            PRIMARY KEY (room_code, user_id)
        )
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS strokes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT,
            owner_id INTEGER,
            owner_username TEXT,
            tool TEXT,
            shape TEXT,
            color TEXT,
            size REAL,
            points TEXT,
            seq INTEGER,
            status TEXT DEFAULT 'active'
        )
    `);
}

// ---------- users (same shape/behavior as before) ----------

async function getUserByEmailOrUsername(email, username) {
    const res = await client.execute({
        sql: 'SELECT * FROM users WHERE email = ? OR username = ?',
        args: [email, username]
    });
    return res.rows[0] || null;
}

async function getUserByEmail(email) {
    const res = await client.execute({
        sql: 'SELECT * FROM users WHERE email = ?',
        args: [email]
    });
    return res.rows[0] || null;
}

async function insertUser(username, email, password) {
    const res = await client.execute({
        sql: 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        args: [username, email, password]
    });
    return Number(res.lastInsertRowid);
}

// ---------- rooms ----------

async function createRoom(code, creator) {
    await client.execute({
        sql: 'INSERT INTO rooms (code, creator_id, creator_username, created_at) VALUES (?, ?, ?, ?)',
        args: [code, creator.id, creator.username, Date.now()]
    });
    await addMember(code, creator.id, creator.username);
}

async function getRoom(code) {
    const res = await client.execute({
        sql: 'SELECT * FROM rooms WHERE code = ?',
        args: [code]
    });
    return res.rows[0] || null;
}

async function deleteRoom(code) {
    await client.execute({ sql: 'DELETE FROM rooms WHERE code = ?', args: [code] });
    await client.execute({ sql: 'DELETE FROM room_members WHERE room_code = ?', args: [code] });
    await client.execute({ sql: 'DELETE FROM strokes WHERE room_code = ?', args: [code] });
}

async function addMember(code, userId, username) {
    await client.execute({
        sql: 'INSERT OR REPLACE INTO room_members (room_code, user_id, username) VALUES (?, ?, ?)',
        args: [code, userId, username]
    });
}

async function removeMember(code, userId) {
    await client.execute({
        sql: 'DELETE FROM room_members WHERE room_code = ? AND user_id = ?',
        args: [code, userId]
    });
}

async function getMembers(code) {
    const res = await client.execute({
        sql: 'SELECT user_id, username FROM room_members WHERE room_code = ?',
        args: [code]
    });
    return res.rows.map(r => ({ id: r.user_id, username: r.username }));
}

async function setCreatorUsername(code, username) {
    await client.execute({
        sql: 'UPDATE rooms SET creator_username = ? WHERE code = ?',
        args: [username, code]
    });
}

// ---------- strokes ----------

async function saveStroke(stroke) {
    await client.execute({
        sql: `INSERT INTO strokes
              (room_code, owner_id, owner_username, tool, shape, color, size, points, seq, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        args: [
            stroke.roomCode,
            stroke.owner,
            stroke.ownerName || null,
            stroke.tool || null,
            stroke.shape || null,
            stroke.color || null,
            stroke.size || null,
            JSON.stringify(stroke.points || []),
            stroke.seq
        ]
    });
    // finishing a new stroke discards that user's redo history, same as
    // the original in-memory behavior (room.history[owner] = [])
    await client.execute({
        sql: `DELETE FROM strokes WHERE room_code = ? AND owner_id = ? AND status = 'undone'`,
        args: [stroke.roomCode, stroke.owner]
    });
}

async function undoLastStroke(roomCode, ownerId) {
    const res = await client.execute({
        sql: `SELECT id FROM strokes WHERE room_code = ? AND owner_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        args: [roomCode, ownerId]
    });
    if (res.rows.length === 0) return false;
    await client.execute({
        sql: `UPDATE strokes SET status = 'undone' WHERE id = ?`,
        args: [res.rows[0].id]
    });
    return true;
}

async function redoLastStroke(roomCode, ownerId) {
    const res = await client.execute({
        sql: `SELECT id FROM strokes WHERE room_code = ? AND owner_id = ? AND status = 'undone' ORDER BY id DESC LIMIT 1`,
        args: [roomCode, ownerId]
    });
    if (res.rows.length === 0) return false;
    await client.execute({
        sql: `UPDATE strokes SET status = 'active' WHERE id = ?`,
        args: [res.rows[0].id]
    });
    return true;
}

async function clearRoomStrokes(roomCode) {
    await client.execute({ sql: 'DELETE FROM strokes WHERE room_code = ?', args: [roomCode] });
}

// reconstructs { strokes: {ownerId: [...]}, history: {ownerId: [...]} }
// exactly like the old in-memory room.strokes / room.history shape
async function getRoomState(roomCode) {
    const res = await client.execute({
        sql: `SELECT * FROM strokes WHERE room_code = ? ORDER BY id ASC`,
        args: [roomCode]
    });

    const strokes = {};
    const history = {};

    for (const row of res.rows) {
        const owner = String(row.owner_id);
        const stroke = {
            owner: row.owner_id,
            ownerName: row.owner_username,
            tool: row.tool,
            shape: row.shape,
            color: row.color,
            size: row.size,
            points: JSON.parse(row.points),
            seq: row.seq
        };

        if (row.status === 'active') {
            if (!strokes[owner]) strokes[owner] = [];
            strokes[owner].push(stroke);
        } else if (row.status === 'undone') {
            if (!history[owner]) history[owner] = [];
            history[owner].push(stroke);
        }
    }

    return { strokes, history };
}

module.exports = {
    client,
    init,
    getUserByEmailOrUsername,
    getUserByEmail,
    insertUser,
    createRoom,
    getRoom,
    deleteRoom,
    addMember,
    removeMember,
    getMembers,
    setCreatorUsername,
    saveStroke,
    undoLastStroke,
    redoLastStroke,
    clearRoomStrokes,
    getRoomState
};
