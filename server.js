const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const sql = require('sqlite3');
const db = new sql.Database('./users.db');
app.use(express.json());

let query = `
    CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    password TEXT
    )`;

db.run(query)




const port = 3000;

const server = http.createServer(app);
app.use(express.static(path.join(__dirname)));
app.get('/', function(req , res) {
    res.sendFile(path.join(__dirname, 'auth.html'))
    }
)

server.listen(port, ()=> {
    console.log('listening on port 3000 !!')
})

app.post('/register',function(req, res) {
    const { username, email, password } = req.body;

    let query = `INSERT INTO users (username, email, password) VALUES (?,?,?)`
    db.run(query, [username, email, password], function (err) {
        if (err) {
            return res.send("User already exists or error occurred");   
        }
        res.send("done!")

    })
        
        }); 


app.post('/login', function(req,res) {
    const {email, password} = req.body;
    let query = `SELECT * FROM users WHERE email = ?`;
    db.all(query,[email], function(err,rows){
        if (err){
            return res.send("Database Error!!")
        }
        if(rows.length===0){
            return res.send("Email Not Found!!")
        }
        let user = null;
        for(const a of rows){
            if (a.password === password){
                user=a;
                break;
            }
        }
        if (!user){
            return res.send("Invalid Password!!")
        }
        
        res.send('/main-menu.html')
        
    })

    
})