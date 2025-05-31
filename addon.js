// Seedr Stremio Addon with Device Auth, Persistent Storage, and Multi-User Support
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 10000;
const USERS_FILE = './users.json';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getUserList() {
  return users.map(user => ({ email: user.email, password: user.password }));
}

function isVideoFile(filename) {
  const extensions = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.ts', '.m2ts'];
  return extensions.some(ext => filename.toLowerCase().endsWith(ext));
}

app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'community.seedr.stremio.addon',
    version: '1.0.0',
    name: 'Seedr Stremio Addon',
    description: 'Stream from multiple Seedr accounts.',
    resources: ['catalog', 'stream'],
    types: ['movie', 'series'],
    catalogs: [{
      type: 'movie',
      id: 'seedr_movies',
      name: 'Seedr Files',
      extra: [{ name: 'search', isRequired: false }]
    }],
    behaviorHints: { configurable: true }
  });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  try {
    const catalog = [];
    for (const user of users) {
      const resp = await axios.get('https://www.seedr.cc/rest/folder', {
        auth: { username: user.email, password: user.password }
      });
      for (const item of resp.data.files || []) {
        catalog.push({
          id: `${user.email}::${item.id}`,
          type: item.is_folder ? 'series' : 'movie',
          name: item.name,
          poster: item.is_folder ? null : `https://www.seedr.cc/rest/file/${item.id}/thumbnail`,
        });
      }
    }
    res.json({ catalog });
  } catch (err) {
    console.error(err);
    res.status(500).json({ catalog: [] });
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const [email, fileId] = req.params.id.split('::');
    const user = users.find(u => u.email === email);
    if (!user) return res.json({ streams: [] });

    const fileResp = await axios.get(`https://www.seedr.cc/rest/file/${fileId}`, {
      auth: { username: user.email, password: user.password }
    });

    const stream = {
      name: fileResp.data.name,
      title: fileResp.data.name,
      url: `https://www.seedr.cc/rest/file/${fileId}/hls`,
      behaviorHints: { bingeGroup: `seedr-${fileId}` }
    };

    res.json({ streams: [stream] });
  } catch (err) {
    console.error(err);
    res.json({ streams: [] });
  }
});

app.get('/configure', (req, res) => {
  res.send(`
    <h2>Seedr Device Login</h2>
    <form method="POST" action="/add-user">
      <label>Email: <input type="email" name="email" required /></label><br>
      <label>Password: <input type="password" name="password" required /></label><br>
      <button type="submit">Save</button>
    </form>
    <p><a href="stremio://seedr-16fi.onrender.com/manifest.json">Install Addon in Stremio</a></p>
  `);
});

app.post('/add-user', (req, res) => {
  const { email, password } = req.body;
  if (!users.find(u => u.email === email)) {
    users.push({ email, password });
    saveUsers();
  }
  res.redirect('/configure');
});

app.get('/', (req, res) => {
  res.send('<h1>✅ Seedr Stremio Addon is running</h1><p><a href="/manifest.json">Manifest</a> | <a href="/configure">Configure (Login)</a></p>');
});

app.listen(PORT, () => console.log(`✅ Seedr Addon running on http://localhost:${PORT}`));
