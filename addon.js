// Full code for Seedr Stremio Addon with:
// - Persistent token storage (JSON file-based)
// - Multi-user support
// - Public file listing from multiple Seedr accounts
// - Correct Stremio install link

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = './users.json';

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Read users from file
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

// Save users to file
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Check if file is a video
function isVideoFile(filename) {
  return ['.mp4', '.mkv', '.avi', '.mov', '.webm'].some(ext => filename.toLowerCase().endsWith(ext));
}

// Manifest
const manifest = {
  id: 'community.seedr.stremio.addon',
  version: '1.0.0',
  name: 'Seedr Stremio Addon',
  description: 'Stream public files from multiple Seedr accounts.',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'seedr_movies', name: 'Seedr Movies' },
    { type: 'series', id: 'seedr_series', name: 'Seedr Series' }
  ],
  behaviorHints: {
    configurable: true
  }
};

app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(manifest);
});

// Public file listing from all stored accounts
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const users = readUsers();
  let catalogItems = [];

  try {
    for (const user of users) {
      const auth = { auth: { username: user.email, password: user.password } };
      const response = await axios.get('https://www.seedr.cc/rest/folder', auth);
      const list = response.data.folders.concat(response.data.files || []);

      for (const item of list) {
        if (item.is_folder) {
          catalogItems.push({
            id: `folder-${user.email}::${item.id}`,
            type: 'series',
            name: item.name,
            poster: 'https://via.placeholder.com/150'
          });
        } else if (isVideoFile(item.name)) {
          catalogItems.push({
            id: `file-${user.email}::${item.id}`,
            type: 'movie',
            name: item.name,
            poster: `https://www.seedr.cc/rest/file/${item.id}/thumbnail`
          });
        }
      }
    }
    res.json({ catalog: catalogItems });
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.status(500).json({ catalog: [], error: 'Failed to load catalog' });
  }
});

// Stream
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const [type, rest] = req.params.id.split('-');
  const [email, itemId] = rest.split('::');
  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.json({ streams: [] });

  try {
    const auth = { auth: { username: user.email, password: user.password } };
    if (type === 'file') {
      const stream = {
        name: 'Seedr File Stream',
        url: `https://www.seedr.cc/rest/file/${itemId}/hls`,
        behaviorHints: { bingeGroup: `seedr-${itemId}` }
      };
      return res.json({ streams: [stream] });
    } else if (type === 'folder') {
      const folder = await axios.get(`https://www.seedr.cc/rest/folder/${itemId}`, auth);
      const videoFiles = (folder.data.files || []).filter(f => isVideoFile(f.name));
      const streams = videoFiles.map(f => ({
        name: f.name,
        url: `https://www.seedr.cc/rest/file/${f.id}/hls`,
        behaviorHints: { bingeGroup: `seedr-${itemId}` }
      }));
      return res.json({ streams });
    }
    res.json({ streams: [] });
  } catch (err) {
    console.error('Stream error:', err.message);
    res.json({ streams: [] });
  }
});

// Configure (Add account)
app.get('/configure', (req, res) => {
  res.send(`
    <h2>✅ Add Your Seedr Account</h2>
    <form method="POST" action="/configure">
      <input name="email" placeholder="Seedr Email" required/><br/><br/>
      <input type="password" name="password" placeholder="Password" required/><br/><br/>
      <button type="submit">Add Account</button>
    </form>
    <p><a href="stremio://seedr-16fi.onrender.com/manifest.json">📺 Install Addon in Stremio</a></p>
  `);
});

// Handle login form
app.post('/configure', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.send('Missing credentials');

  const users = readUsers();
  if (users.find(u => u.email === email)) return res.send('Account already added');

  users.push({ email, password });
  saveUsers(users);

  res.send('✅ Account added! You can now use the addon in Stremio.');
});

app.get('/', (req, res) => {
  res.send(`<h1>Seedr Stremio Addon</h1><p><a href="/manifest.json">Manifest</a></p><p><a href="/configure">Configure (Login to Seedr)</a></p>`);
});

app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running: http://localhost:${PORT}`);
});
