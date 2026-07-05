const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const sql = require('sqlite3');
const session = require('express-session');
const nodemailer = require('nodemailer');
const db = new sql.Database('./users.db');

app.use(express.json());

// session middleware - lets us know who is logged in on every request
app.use(session({
    secret: 'doodlebuds-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

let query = `
    CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT
    )`;

db.run(query)

// signups that haven't been verified yet live here in memory,
// keyed by email. Nothing goes into SQLite until verification succeeds.
let pendingSignups = {};

const port = 3000;

const server = http.createServer(app);

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
    res.sendFile(path.join(__dirname, 'auth.html'))
    }
)

server.listen(port, ()=> {
    console.log('listening on port 3000 !!')
})

// configure this with your real email + an app password (not your normal password)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'hax****21@gmail.com',
        pass: 'your-app-key'
    }
});

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sendVerificationCode(email, code) {
    transporter.sendMail({
        from: 'haxa****1@gmail.com',
        to: email,
        subject: 'DoodleBuds Verification Code',
        text: `Your verification code is ${code}. It expires in 10 minutes.
        Verify Your Account, and Start Doodlifying Your Day.`
    }, function(err) {
        if (err) console.log("Email error:", err);
    });
}

app.post('/register',function(req, res) {
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

    let query = `SELECT * FROM users WHERE email = ? OR username = ?`;
    db.get(query, [email, username], function(err, existingUser) {
        if (err) {
            return res.json({ success: false, message: "Database Error!!", redirect: null });
        }
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
    })

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

app.post('/verify', function(req, res) {
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

    let query = `INSERT INTO users (username, email, password) VALUES (?,?,?)`;
    db.run(query, [pending.username, pending.email, pending.password], function(err) {
        if (err) {
            return res.json({ success: false, message: "User already exists or error occurred", redirect: null });
        }

        delete pendingSignups[email];

        // log the user in immediately, no need to visit /login after verifying
        req.session.user = { id: this.lastID, username: pending.username, email: pending.email };

        res.json({ success: true, message: "Verified!", redirect: "/main-menu.html" });
    });
});


app.post('/login', function(req,res) {
    const {email, password} = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: "All fields are required!", redirect: null });
    }

    let query = `SELECT * FROM users WHERE email = ?`;
    db.get(query,[email], function(err,user){
        if (err){
            return res.json({ success: false, message: "Database Error!!", redirect: null })
        }
        if(!user){
            return res.json({ success: false, message: "Email Not Found!!", redirect: null })
        }
        if (user.password !== password){
            return res.json({ success: false, message: "Invalid Password!!", redirect: null })
        }

        req.session.user = { id: user.id, username: user.username, email: user.email };

        res.json({ success: true, message: "Login successful!", redirect: "/main-menu.html" })
    })

    
})

// main-menu.html (or any future page) can call this to get the current user's data
app.get('/session-user', function(req, res) {
    if (!req.session.user) {
        return res.json({ success: false, message: "Not logged in" });
    }
    res.json({ success: true, user: req.session.user });
});

app.post('/logout', function(req, res) {
    req.session.destroy(function(err){
        if (err){
            return res.json({ success: false, message: "Could not log out" });
        }
        res.json({ success: true, message: "Logged out", redirect: "/" });
    });
});

app.post('/solo', function(req, res) {
    res.json({ success: true, message: "Starting solo game", redirect: "/canvas.html" });
})
