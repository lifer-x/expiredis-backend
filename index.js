import dotenv from 'dotenv';
import express from 'express';
import sqlite3 from 'sqlite3';
import bodyParser from 'body-parser';
import cors from 'cors';
import { body,  param, validationResult } from 'express-validator';
import passport from 'passport';
import passportJwt from 'passport-jwt';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {Resend} from 'resend';
import cron from 'node-cron';

dotenv.config({quiet:true});

const app = express();
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'db.db');
const db = new sqlite3.Database(dbPath);

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.EMAIL_FROM;

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const dbDelete = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this.changes); // возвращает количество удаленных строк
    });
});

const jwtSecret = process.env.JWT_SECRET_KEY;
if (!jwtSecret) {
    throw new Error('JWT_SECRET_KEY environment variable is required');
}

const jwtOptions = {
    jwtFromRequest: passportJwt.ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: jwtSecret
};

passport.use(new passportJwt.Strategy(jwtOptions, async(jwtPayload, done) => {
    try {
        const user = await dbGet('SELECT id, email FROM users WHERE email = ?', [jwtPayload.username]);
        if (user) return done(null, user);
        return done(null, false);
    } catch (err) {
        return done(err, false);
    }
}));


app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'PUT']
}));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(passport.initialize());


const handleValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        expire_date TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});






app.post('/register',
    body('email').isEmail().normalizeEmail().toLowerCase().withMessage('Invalid email'),
    body('password').isLength({ min: 8 }).withMessage('Password too short'),
    handleValidation,
    async(req, res) => {
        try {
            const { email, password } = req.body;
            const rounds = parseInt(process.env.SALTED_ROUNDS) || 10;
            const hashedPassword = await bcrypt.hash(password, rounds);
            await dbRun('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
            res.status(201).json({ success: true });
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: "Email already registered" });
            }
            res.status(400).json({ error: err.message });
        }
    }
);

app.post('/login',
    body('email').isEmail().normalizeEmail().toLowerCase().withMessage('Invalid email'),
    body('password').exists(),
    handleValidation,
    async(req, res) => {
        try {
            const { email, password } = req.body;
            const user = await dbGet('SELECT id,email,password FROM users WHERE email = ?', [email]);

            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({ error: 'Incorrect email or password' });
            }

            const token = jwt.sign({ username: user.email ,id: user.id}, jwtOptions.secretOrKey, { expiresIn: '24h' });
            res.json({ success: true, token });
        } catch (err) {
            res.status(500).json({ error: 'Server error' });
        }
    }
);


app.get('/items',
    passport.authenticate('jwt', { session: false }),
    async(req, res) => {
        try {
            const items = await dbAll(
                'SELECT id, name, expire_date FROM items WHERE user_id = ?', [req.user.id]
            );

            res.json({ items });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);


app.post('/items',
    body('name')
    .trim()
    .notEmpty()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name must be 1-200 characters'),
    body('expire_date').isISO8601().withMessage("Invalid date"),
    handleValidation,
    passport.authenticate('jwt', { session: false }),
    async(req, res) => {
        try {
            const { name, expire_date } = req.body;
            const result = await dbRun(
                'INSERT INTO items (user_id, name, expire_date) VALUES (?, ?, ?)', [req.user.id, name, expire_date]
            );
            res.status(201).json({ success: true, itemId: result.lastID });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

app.delete('/items/:id',
    param('id').isInt().toInt().withMessage('Invalid ID format'),
    handleValidation,
    passport.authenticate('jwt', { session: false }),
    async(req, res) => {
        try {
            const changes = await dbDelete('DELETE FROM items WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

            if (changes === 0) {
                return res.status(404).json({ error: 'Item not found or access denied' });
            }

            res.json({ message: 'Deleted successfully' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

const notifyUserAboutExpiration = async () => {
    console.log('Начало проверки сроков годности...');
    

    try {
        const items = await dbAll(`
        SELECT items.name, users.email, items.expire_date 
        FROM items 
        JOIN users ON items.user_id = users.id 
        WHERE items.expire_date <= DATE('now')
    `);

        if (items.length === 0) {
            return console.log('Просроченных товаров нет.');
        }

        for (const item of items) {
            const { data, error } = await resend.emails.send({
                from: from,
                to: item.email,
                subject: `⚠️ Срок годности истек: ${item.name}`,
                html: `
                    <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
                        <h2 style="color: #d9534f;">Внимание!</h2>
                        <p>У товара <b>${item.name}</b> истек срок годности.</p>
                        <p>Дата в базе: <span style="color: red;">${item.expire_date}</span></p>
                    </div>
                `
            });

            if (error) {
                console.error(`Ошибка при отправке на ${item.email}:`, error);
            } else {
                console.log(`Уведомление отправлено! ID: ${data.id}`);
            }
        }
    } catch (err) {
        console.error('Системная ошибка:', err);
    }
};

// Планировщик (каждый день в 00:00 по UTC)
cron.schedule('0 0 * * *', notifyUserAboutExpiration, {
    timezone: "UTC"
});



app.listen(process.env.PORT, () => console.log(`Server started on port ${process.env.PORT}`));
