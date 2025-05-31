// Required Modules
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, 'data', 'users.json');

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, 'data'))){
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// Load users from file
function loadUsers() {
    if (!fs.existsSync(DATA_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE));
    } catch (err) {
        console.error('Failed to parse users.json:', err);
        return [];
    }
}

// Save users to file
function saveUsers(users) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// Add or update a Seedr account
function saveSeedrAccount(email, password) {
    const users = loadUsers();
    const existing = users.find(u => u.email === email);
    if (existing) {
        existing.password = password;
    } else {
        users.push({ email, password });
    }
    saveUsers(users);
}

// Verify Seedr login
async function verifySeedrLogin(email, password) {
    try {
        const response = await axios.get('https://www.seedr.cc/rest/user', {
            auth: { username: email, password: password }
        });
        return response.status === 200;
    } catch (err) {
        return false;
    }
}

// UI Page
app.get('/', (req, res) => {
    res.send(`
    <html>
    <head>
        <title>Seedr Stremio Addon</title>
        <style>
            body { font-family: sans-serif; background: #f9f9f9; padding: 2rem; text-align: center; }
            form { margin: 2rem auto; max-width: 400px; background: #fff; padding: 1rem; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            input, button { padding: 0.5rem; margin-top: 1rem; width: 100%; }
            a.install { display: inline-block; margin-top: 2rem; background: #4CAF50; color: white; padding: 1rem; border-radius: 10px; text-decoration: none; }
        </style>
    </head>
    <body>
        <h1>✅ Seedr Stremio Addon</h1>
        <form method="POST" action="/login">
            <h3>Login to Seedr</h3>
            <input name="email" placeholder="Seedr Email" required><br>
            <input name="password" placeholder="Seedr Password" type="password" required><br>
            <button type="submit">Login & Save</button>
        </form>
        <a class="install" href="stremio://$(req.headers.host)/manifest.json">Install in Stremio</a>
    </body>
    </html>
    `);
});

// Handle login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const ok = await verifySeedrLogin(email, password);
    if (ok) {
        saveSeedrAccount(email, password);
        res.send(`<p>✅ Login Successful. You may now <a href="stremio://${req.headers.host}/manifest.json">Install the Addon</a></p>`);
    } else {
        res.send('<p>❌ Login Failed. Please try again.</p><a href="/">Back</a>');
    }
});

// Manifest
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'community.seedr.stremio.addon',
        version: '1.0.0',
        name: 'Seedr Stremio Addon',
        description: 'Stream content from your Seedr.cc account',
        resources: ['catalog', 'stream'],
        types: ['movie', 'series'],
        catalogs: [{ id: 'seedr_all', type: 'movie', name: 'Seedr Library' }],
        behaviorHints: { configurable: true }
    });
});

// Catalog
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const users = loadUsers();
    let catalog = [];

    for (const u of users) {
        try {
            const response = await axios.get('https://www.seedr.cc/rest/folder', {
                auth: { username: u.email, password: u.password }
            });

            const list = response.data.folders.concat(response.data.files);
            catalog.push(...list.map(item => ({
                id: item.id.toString(),
                type: 'movie',
                name: item.name,
                poster: 'https://via.placeholder.com/150',
                description: item.size ? `${(item.size / 1024 / 1024).toFixed(2)} MB` : 'Folder'
            })));
        } catch (e) {
            console.warn(`Failed to load files for ${u.email}`);
        }
    }

    res.json({ metas: catalog });
});

// Stream route
app.get('/stream/:type/:id.json', async (req, res) => {
    const id = req.params.id;
    const users = loadUsers();
    for (const u of users) {
        try {
            const r = await axios.get(`https://www.seedr.cc/rest/file/${id}`, {
                auth: { username: u.email, password: u.password }
            });

            if (r.status === 200) {
                const url = r.data.hls || r.data.download_url || `https://www.seedr.cc/rest/file/${id}`;
                return res.json({
                    streams: [{
                        name: r.data.name,
                        title: r.data.name,
                        url: url
                    }]
                });
            }
        } catch {}
    }
    res.json({ streams: [] });
});

app.listen(PORT, () => {
    console.log(`✅ Seedr Addon running: http://localhost:${PORT}`);
});
