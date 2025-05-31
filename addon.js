// Updated addon.js for Seedr + Stremio with login, token saving, and catalog streaming
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

const USERS_FILE = path.join(__dirname, 'users.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Load or init users
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE));
  } catch (e) {
    return {};
  }
}
function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// API login and test helper
async function testLogin(email, password) {
  try {
    const res = await axios.get('https://www.seedr.cc/rest/user', {
      auth: { username: email, password: password }
    });
    return res.data;
  } catch {
    return null;
  }
}

// Route: Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Route: Manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'community.seedr.stremio.addon',
    version: '1.0.0',
    name: 'Seedr Addon',
    description: 'Stream from your Seedr.cc cloud.',
    resources: ['catalog', 'stream'],
    types: ['movie'],
    catalogs: [{ type: 'movie', id: 'seedr_catalog' }],
    behaviorHints: { configurable: true },
  });
});

// Route: Catalog
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  const users = loadUsers();
  let items = [];

  for (const [email, password] of Object.entries(users)) {
    try {
      const resp = await axios.get('https://www.seedr.cc/rest/folder', {
        auth: { username: email, password }
      });
      const list = resp.data?.folders || [];

      for (const file of list) {
        if (!file.name.toLowerCase().match(/\.(mp4|mkv|avi)$/)) continue;
        items.push({
          id: `${email}|${file.id}`,
          name: file.name,
          type: 'movie',
          poster: `https://www.seedr.cc/rest/file/${file.id}/thumbnail`,
        });
      }
    } catch (e) {
      console.error(`Failed user ${email}`);
    }
  }

  res.json({ metas: items });
});

// Route: Stream
app.get('/stream/:type/:id.json', async (req, res) => {
  const [email, fileId] = req.params.id.split('|');
  const users = loadUsers();
  const password = users[email];

  if (!password) return res.json({ streams: [] });

  const stream = {
    title: 'Seedr Stream',
    url: `https://${email}:${password}@www.seedr.cc/rest/file/${fileId}/hls`,
    behaviorHints: { bingeGroup: `seedr-${fileId}` }
  };
  res.json({ streams: [stream] });
});

// Route: Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await testLogin(email, password);
  if (result) {
    const users = loadUsers();
    users[email] = password;
    saveUsers(users);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\u2705 Seedr Addon running on http://localhost:${PORT}`);
});
