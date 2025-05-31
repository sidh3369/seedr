// addon.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const basicAuth = require('basic-auth');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));

const manifest = {
  id: 'community.seedr.stremio.addon',
  version: '1.0.0',
  name: 'Seedr Stremio Addon',
  description: 'Stream content directly from your Seedr.cc account.',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'seedr_movies', name: 'Seedr Movies', extra: [{ name: 'search', isRequired: false }] },
    { type: 'series', id: 'seedr_series', name: 'Seedr Series', extra: [{ name: 'search', isRequired: false }] }
  ],
  behaviorHints: { configurable: true }
};

app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(manifest);
});

app.get('/configure', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const auth = Buffer.from(`${email}:${password}`).toString('base64');
    const result = await axios.get('https://www.seedr.cc/rest/user', {
      headers: { Authorization: `Basic ${auth}` }
    });
    if (result.data && result.data.id) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE));
      users[email] = password;
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      return res.json({ success: true });
    }
  } catch (err) {
    console.error(err.message);
  }
  res.status(401).json({ success: false });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  const { type } = req.params;
  const users = JSON.parse(fs.readFileSync(USERS_FILE));
  const allFiles = [];

  for (const [email, password] of Object.entries(users)) {
    const auth = Buffer.from(`${email}:${password}`).toString('base64');
    try {
      const result = await axios.get('https://www.seedr.cc/rest/folder', {
        headers: { Authorization: `Basic ${auth}` }
      });
      result.data.files?.forEach(file => {
        allFiles.push({
          id: file.id.toString(),
          type: file.name.toLowerCase().includes('s') ? 'series' : 'movie',
          name: file.name,
          poster: `https://www.seedr.cc/rest/file/${file.id}/thumbnail`,
          seedr: { email, password }
        });
      });
    } catch (e) {
      console.error(`Failed for ${email}: ${e.message}`);
    }
  }
  res.json({ catalog: allFiles });
});

app.get('/stream/:type/:id.json', async (req, res) => {
  const { id } = req.params;
  const users = JSON.parse(fs.readFileSync(USERS_FILE));
  for (const [email, password] of Object.entries(users)) {
    const auth = Buffer.from(`${email}:${password}`).toString('base64');
    try {
      const response = await axios.get(`https://www.seedr.cc/rest/file/${id}`, {
        headers: { Authorization: `Basic ${auth}` }
      });
      if (response.data) {
        return res.json({
          streams: [
            {
              title: response.data.name,
              name: 'Seedr',
              url: `https://www.seedr.cc/rest/file/${id}/hls`,
              behaviorHints: { bingeGroup: `seedr-${id}` }
            }
          ]
        });
      }
    } catch (e) {
      continue;
    }
  }
  res.json({ streams: [] });
});

app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running on http://localhost:${PORT}`);
});
