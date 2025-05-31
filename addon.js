require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Seedr = require('seedr');
const app = express();
const PORT = process.env.PORT || 3000;

// Helper: is video file
function isVideoFile(filename) {
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.m2ts'];
  return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

// Helper: Seedr device auth flow (simple memory store)
let deviceAuth = null;
let seedrAccessToken = null;

async function getSeedrClient() {
  if (!seedrAccessToken) throw new Error('Not authenticated with Seedr. Click Configure to login.');
  return new Seedr({ access_token: seedrAccessToken });
}

// Manifest
const manifest = {
  id: 'community.seedr.stremio.addon',
  version: '1.0.0',
  name: 'Seedr Stremio Addon',
  description: 'Stream content directly from your Seedr.cc account on Stremio.',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'seedr_movies',
      name: 'Seedr Movies',
      extra: [ { name: 'search' }, { name: 'skip' }, { name: 'genre' } ]
    },
    {
      type: 'series',
      id: 'seedr_series',
      name: 'Seedr Series',
      extra: [ { name: 'search' }, { name: 'skip' }, { name: 'genre' } ]
    }
  ],
  behaviorHints: {
    configurable: true
  }
};

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// Manifest route
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Catalog route
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  try {
    const seedrClient = await getSeedrClient();
    const files = await seedrClient.getFiles();
    const catalogItems = files.list.map(item => ({
      id: item.id.toString(),
      type: item.is_folder ? 'series' : 'movie',
      name: item.name,
      poster: item.is_folder ? null : 'https://via.placeholder.com/150'
    }));
    res.json({ metas: catalogItems });
  } catch (error) {
    console.error('[Catalog Error]', error);
    res.status(500).json({ metas: [], error: error.message });
  }
});

// Stream route
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const seedrClient = await getSeedrClient();
    const file = await seedrClient.getFile(req.params.id);
    if (!file) return res.json({ streams: [] });

    if (file.is_folder) {
      const folder = await seedrClient.getFiles(file.id);
      const streams = folder.list.filter(f => !f.is_folder && isVideoFile(f.name)).map(f => ({
        name: `Seedr - ${f.name}`,
        title: f.name,
        url: f.download_url,
        behaviorHints: { bingeGroup: `seedr-${file.id}` }
      }));
      return res.json({ streams });
    }

    if (isVideoFile(file.name)) {
      return res.json({
        streams: [{
          name: `Seedr - ${file.name}`,
          title: file.name,
          url: file.download_url,
          behaviorHints: { bingeGroup: `seedr-${file.id}` }
        }]
      });
    }
    res.json({ streams: [] });
  } catch (error) {
    console.error('[Stream Error]', error);
    res.status(500).json({ streams: [] });
  }
});

// Configure UI route
app.get('/configure', async (req, res) => {
  try {
    if (!deviceAuth) {
      const response = await axios.post('https://www.seedr.cc/oauth_test/device/code.php', {
        client_id: process.env.SEEDR_CLIENT_ID,
        response_type: 'device_code'
      });
      deviceAuth = response.data;
      console.log('Visit:', deviceAuth.verification_url, 'Code:', deviceAuth.user_code);
    }

    res.send(`
      <h1>Seedr Device Auth</h1>
      <p>Visit: <a href="${deviceAuth.verification_url}" target="_blank">${deviceAuth.verification_url}</a></p>
      <p>Code: <strong>${deviceAuth.user_code}</strong></p>
      <p><a href="/poll">Click here to complete authentication</a></p>
    `);
  } catch (err) {
    console.error('[Configure Error]', err);
    res.status(500).send('Failed to initiate device authentication.');
  }
});

// Polling for token
app.get('/poll', async (req, res) => {
  try {
    const pollResponse = await axios.post('https://www.seedr.cc/oauth_test/token.php', {
      client_id: process.env.SEEDR_CLIENT_ID,
      grant_type: 'device_code',
      code: deviceAuth.device_code
    });
    seedrAccessToken = pollResponse.data.access_token;
    deviceAuth = null;
    res.send(`<p>✅ Authenticated successfully. You can now use the addon in Stremio.</p>`);
  } catch (err) {
    console.error('[Poll Error]', err);
    res.status(500).send('Authentication failed or still pending.');
  }
});

// Home route
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ Seedr Stremio Addon</h1>
    <p><a href="/manifest.json">View Manifest</a></p>
    <p><a href="/configure">Configure (Login to Seedr)</a></p>
    <p><a href="stremio://community.seedr.stremio.addon">Install Addon in Stremio</a></p>
  `);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Unexpected internal server error' });
});

app.listen(PORT, () => {
  console.log(`✔ Seedr Stremio Addon running at http://localhost:${PORT}`);
});
