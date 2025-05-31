// addon.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const USERS_FILE = 'users.json';
function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- Manifest ---
const manifest = {
  id: 'community.seedr.stremio.addon',
  version: '1.0.0',
  name: 'Seedr Stremio Addon',
  description: 'Stream content directly from your Seedr.cc accounts.',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [{
    type: 'movie',
    id: 'seedr_movies',
    name: 'Seedr Public',
    extra: [{ name: 'search', isRequired: false }]
  }],
  behaviorHints: { configurable: true }
};

app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(manifest);
});

// --- Catalog ---
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const users = readUsers();
  const catalog = [];

  for (const [email, password] of Object.entries(users)) {
    try {
      const auth = { auth: { username: email, password } };
      const { data } = await axios.get('https://www.seedr.cc/rest/folder', auth);
      data.files.filter(file => isVideoFile(file.name)).forEach(file => {
        catalog.push({
          id: `${email}:${file.id}`,
          name: file.name,
          type: 'movie',
          poster: `https://www.seedr.cc/rest/file/${file.id}/thumbnail`,
        });
      });
    } catch (err) {
      console.warn(`Failed for ${email}:`, err.message);
    }
  }

  res.json({ metas: catalog });
});

// --- Stream ---
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const [email, fileId] = req.params.id.split(':');
  const users = readUsers();
  const password = users[email];

  if (!password) return res.json({ streams: [] });

  try {
    const auth = { auth: { username: email, password } };
    const { data } = await axios.get(`https://www.seedr.cc/rest/file/${fileId}`, auth);
    const stream = {
      title: data.name,
      name: 'Seedr',
      url: `https://www.seedr.cc/rest/file/${fileId}/hls`,
    };
    res.json({ streams: [stream] });
  } catch (err) {
    console.error('Stream error:', err.message);
    res.json({ streams: [] });
  }
});

// --- Login Form ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  axios.get('https://www.seedr.cc/rest/user', { auth: { username: email, password } })
    .then(() => {
      const users = readUsers();
      users[email] = password; // Overwrite if already exists
      saveUsers(users);
      res.send('✅ Login successful! You can now install: <a href="stremio://seedr-16fi.onrender.com/manifest.json">Install Addon</a>');
    })
    .catch(() => {
      res.send('❌ Login Failed. Please try again.');
    });
});

function isVideoFile(name) {
  return ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv'].some(ext => name.endsWith(ext));
}

app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running on http://localhost:${PORT}`);
});
