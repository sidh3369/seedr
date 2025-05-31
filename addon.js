require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Seedr = require('seedr');
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

// Route: Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Route: Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const seedr = new Seedr();
    const response = await seedr.login({ email, password });
    if (response.token) {
      const users = loadUsers();
      users[email] = response.token; // Store token, not password
      saveUsers(users);
      console.log(`Login successful for ${email}, token: ${response.token}`);
      res.json({ success: true, message: 'Token acquired' });
    } else {
      console.log(`Login failed for ${email}: No token in response`);
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

  for (const [email, token] of Object.entries(users)) {
    try {
      const seedr = new Seedr({ token });
      const contents = await seedr.listContents();
      const files = contents.files || [];
      for (const file of files) {
        if (!file.name.toLowerCase().match(/\.(mp4|mkv|avi)$/)) continue;
        items.push({
          id: `${email}|${file.id}`,
          name: file.name,
          type: 'movie',
          poster: file.thumbnail || 'https://via.placeholder.com/150', // Fallback poster
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
  const token = users[email];

  if (!token) {
    console.error(`No token for user ${email}`);
    return res.json({ streams: [] });
  }

  try {
    const seedr = new Seedr({ token });
    const file = await seedr.getFile(fileId);
    if (file.url) {
      res.json({
        streams: [{
          title: 'Seedr Stream',
          url: file.url, // Streamable URL from Seedr
          behaviorHints: { bingeGroup: `seedr-${fileId}` }
        }]
      });
    } else {
      console.error(`No stream URL for file ${fileId}`);
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
