// Dependencies
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 10000;

// Data file for storing users
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
if (!fs.existsSync(path.dirname(USERS_FILE))) fs.mkdirSync(path.dirname(USERS_FILE));
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

// Load users
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle login via username/password
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const auth = Buffer.from(`${email}:${password}`).toString('base64');

  try {
    const response = await axios.get('https://www.seedr.cc/rest/user', {
      headers: { Authorization: `Basic ${auth}` }
    });

    const users = loadUsers();
    users[email] = { auth, email, username: response.data.username };
    saveUsers(users);

    res.send(`
      <h2>✅ Login Success</h2>
      <p>Welcome ${response.data.username}</p>
      <p><a href="stremio://your-app.onrender.com/manifest.json">Install in Stremio</a></p>
    `);
  } catch (err) {
    res.send(`<h2>❌ Login Failed. Please try again.</h2><a href="/">Go Back</a>`);
  }
});

// Device auth endpoint (start)
app.get('/device', (req, res) => {
  const deviceCode = crypto.randomBytes(4).toString('hex');
  const pendingFile = path.join(__dirname, 'data', 'pending', deviceCode);
  if (!fs.existsSync(path.dirname(pendingFile))) fs.mkdirSync(path.dirname(pendingFile));
  fs.writeFileSync(pendingFile, '');
  res.send(`
    <h2>📱 Device Code</h2>
    <p>Use this code on another device: <code>${deviceCode}</code></p>
    <p>Then go to <a href="/activate?code=${deviceCode}">/activate?code=${deviceCode}</a> on another device to login.</p>
  `);
});

// Activation page
app.get('/activate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'activate.html'));
});

// POST device login
app.post('/activate', async (req, res) => {
  const { email, password, code } = req.body;
  const auth = Buffer.from(`${email}:${password}`).toString('base64');

  try {
    const response = await axios.get('https://www.seedr.cc/rest/user', {
      headers: { Authorization: `Basic ${auth}` }
    });

    const pendingFile = path.join(__dirname, 'data', 'pending', code);
    if (!fs.existsSync(pendingFile)) return res.send('<h2>❌ Invalid code.</h2>');

    const users = loadUsers();
    users[email] = { auth, email, username: response.data.username };
    saveUsers(users);
    fs.unlinkSync(pendingFile);

    res.send(`<h2>✅ Device Linked. Welcome ${response.data.username}</h2>`);
  } catch (err) {
    res.send(`<h2>❌ Login Failed.</h2>`);
  }
});

// Manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    id: "community.seedr.stremio.addon",
    version: "1.0.0",
    name: "Seedr Stremio Addon",
    description: "Stream your Seedr.cc library",
    resources: ["catalog", "stream"],
    types: ["movie", "series"],
    catalogs: [{
      type: "movie",
      id: "seedr_catalog",
      name: "Seedr Library",
      extra: [{ name: "search", isRequired: false }]
    }],
    behaviorHints: { configurable: true }
  });
});

// Catalog route
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  const users = loadUsers();
  let items = [];

  for (const user of Object.values(users)) {
    try {
      const files = await axios.get('https://www.seedr.cc/rest/folder', {
        headers: { Authorization: `Basic ${user.auth}` }
      });

      for (const file of files.data.files || []) {
        if (file.name && file.id) {
          items.push({
            id: `${user.email}-${file.id}`,
            name: file.name,
            type: file.folder ? "series" : "movie",
            poster: 'https://via.placeholder.com/150?text=Seedr'
          });
        }
      }
    } catch (e) {
      console.error(`Failed loading for ${user.email}`);
    }
  }

  res.json({ metas: items });
});

// Stream route
app.get('/stream/:type/:id.json', async (req, res) => {
  const [email, id] = req.params.id.split('-');
  const users = loadUsers();
  const user = users[email];

  if (!user) return res.json({ streams: [] });

  try {
    const file = await axios.get(`https://www.seedr.cc/rest/file/${id}`, {
      headers: { Authorization: `Basic ${user.auth}` }
    });

    res.json({
      streams: [{
        name: file.data.name,
        url: `https://www.seedr.cc/rest/file/${id}/hls`,
        title: file.data.name
      }]
    });
  } catch (e) {
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running on http://localhost:${PORT}`);
});
