require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

const USERS_FILE = path.join(__dirname, 'users.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Middleware
app.use(cors()); // Enable CORS for Stremio
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

// Seedr API request helper
async function seedrRequest(email, password, endpoint, method = 'GET', data = {}) {
  try {
    const config = {
      method: method,
      url: `https://www.seedr.cc/rest/${endpoint}`,
      auth: { username: email, password: password },
      headers: { 'Content-Type': 'application/json' }
    };
    if (method === 'POST') {
      config.data = data;
    }
    const resp = await axios(config);
    return resp.data;
  } catch (e) {
    console.error(`Seedr API error at ${endpoint}:`, e.message);
    throw e;
  }
}

// Route: Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Route: Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await seedrRequest(email, password, 'user');
    if (result && result.user_id) { // Check for valid user data
      const users = loadUsers();
      users[email] = password; // Store password for personal use (secure over HTTPS)
      saveUsers(users);
      console.log(`Login successful for ${email}, user_id: ${result.user_id}`);
      res.json({ success: true, message: 'Login successful' });
    } else {
      console.log(`Login failed for ${email}: Invalid response`);
      res.json({ success: false, error: 'Invalid email or password' });
    }
  } catch (e) {
    console.error(`Login error for ${email}:`, e.message);
    res.json({ success: false, error: 'Login failed. Check credentials or connection.' });
  }
});

// Route: Manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'sidh3369.seedr.stremio.addon', // Unique ID
    version: '1.0.0',
    name: 'Seedr Addon',
    description: 'Stream from your Seedr.cc cloud.',
    resources: ['catalog', 'stream'],
    types: ['movie'],
    catalogs: [{ type: 'movie', id: 'seedr_catalog' }],
    behaviorHints: { configurable: true }
  });
});

// Route: Catalog
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  const users = loadUsers();
  let items = [];

  for (const [email, password] of Object.entries(users)) {
    try {
      // Get root folder
      const root = await seedrRequest(email, password, 'folder');
      const folders = root.folders || [];
      for (const folder of folders) {
        // Get files in each folder
        const folderData = await seedrRequest(email, password, `folder/${folder.id}`);
        const files = folderData.files || [];
        for (const file of files) {
          if (!file.name.toLowerCase().match(/\.(mp4|mkv|avi)$/)) continue;
          items.push({
            id: `${email}|${file.id}`,
            name: file.name,
            type: 'movie',
            poster: `https://www.seedr.cc/rest/file/${file.id}/thumbnail` || 'https://via.placeholder.com/150'
          });
        }
      }
      // Check root files too
      const rootFiles = root.files || [];
      for (const file of rootFiles) {
        if (!file.name.toLowerCase().match(/\.(mp4|mkv|avi)$/)) continue;
        items.push({
          id: `${email}|${file.id}`,
          name: file.name,
          type: 'movie',
          poster: `https://www.seedr.cc/rest/file/${file.id}/thumbnail` || 'https://via.placeholder.com/150'
        });
      }
    } catch (e) {
      console.error(`Catalog failed for user ${email}:`, e.message);
    }
  }
  res.json({ metas: items });
});

// Route: Stream
app.get('/stream/:type/:id.json', async (req, res) => {
  const [email, fileId] = req.params.id.split('|');
  const users = loadUsers();
  const password = users[email];

  if (!password) {
    console.error(`No credentials for user ${email}`);
    return res.json({ streams: [] });
  }

  try {
    const hlsData = await seedrRequest(email, password, `file/${fileId}/hls`);
    if (hlsData && hlsData.url) {
      res.json({
        streams: [{
          title: 'Seedr Stream',
          url: hlsData.url, // HLS URL for streaming
          behaviorHints: { bingeGroup: `seedr-${fileId}` }
        }]
      });
    } else {
      console.error(`No HLS URL for file ${fileId}`);
      res.json({ streams: [] });
    }
  } catch (e) {
    console.error(`Stream error for ${fileId} by ${email}:`, e.message);
    res.json({ streams: [] });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running on http://localhost:${PORT}`);
});
