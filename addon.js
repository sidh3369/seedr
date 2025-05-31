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
const API_URL = 'https://www.seedr.cc/api';
const DEVICE_CODE_URL = 'https://www.seedr.cc/api/device/code';
const AUTHENTICATION_URL = 'https://www.seedr.cc/api/device/authorize';
const CLIENT_ID = 'seedr_xbmc';

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

// API request helper
async function fetchJsonDictionary(url, postParams = null) {
  try {
    if (postParams) {
      const r = await axios.post(url, postParams);
      return r.data;
    } else {
      const r = await axios.get(url);
      return r.data;
    }
  } catch (e) {
    console.error(`API error at ${url}:`, e.message);
    throw e;
  }
}

// Route: Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Route: Get Device Code
app.post('/get-device-code', async (req, res) => {
  try {
    const deviceCodeDict = await fetchJsonDictionary(`${DEVICE_CODE_URL}?client_id=${CLIENT_ID}`);
    if (deviceCodeDict && deviceCodeDict.device_code && deviceCodeDict.user_code) {
      const users = loadUsers();
      users.tempDeviceCode = deviceCodeDict.device_code;
      users.deviceCodeDict = deviceCodeDict;
      saveUsers(users);
      console.log('Device code generated:', deviceCodeDict.user_code);
      res.json({
        success: true,
        user_code: deviceCodeDict.user_code,
        device_code: deviceCodeDict.device_code
      });
    } else {
      console.log('Failed to get device code');
      res.json({ success: false, error: 'Failed to get device code' });
    }
  } catch (e) {
    console.error('Error getting device code:', e.message);
    res.json({ success: false, error: 'Server error. Try again.' });
  }
});

// Route: Check Authorization and Get Token
app.post('/check-auth', async (req, res) => {
  const users = loadUsers();
  const deviceCode = users.tempDeviceCode;
  if (!deviceCode) {
    console.error('No device code found');
    return res.json({ success: false, error: 'No device code. Request a new one.' });
  }
  try {
    const tokenDict = await fetchJsonDictionary(`${AUTHENTICATION_URL}?device_code=${deviceCode}&client_id=${CLIENT_ID}`);
    if (tokenDict && !tokenDict.error && tokenDict.access_token) {
      users.access_token = tokenDict.access_token;
      delete users.tempDeviceCode; // Clean up
      delete users.deviceCodeDict;
      saveUsers(users);
      console.log('Authorization successful, token:', tokenDict.access_token);
      res.json({ success: true, message: 'Authorization successful' });
    } else {
      console.log('Authorization not complete:', tokenDict.error || 'No token');
      res.json({ success: false, error: 'Authorization not complete. Enter code at seedr.cc/devices.' });
    }
  } catch (e) {
    console.error('Error checking auth:', e.message);
    res.json({ success: false, error: 'Server error. Try again.' });
  }
});

// Route: Manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    idtypename: 'sidh3369.seedr.stremio.addon', // Unique ID
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
  const accessToken = users.access_token;
  if (!accessToken) {
    console.error('No access token found');
    return res.json({ metas: [] });
  }
  try {
    const data = await fetchJsonDictionary(`${API_URL}/folder?access_token=${accessToken}`);
    const items = [];
    const folders = data.folders || [];
    const files = data.files || [];
    for (const folder of folders) {
      const folderData = await fetchJsonDictionary(`${API_URL}/folder/${folder.id}?access_token=${accessToken}`);
      const folderFiles = folderData.files || [];
      for (const file of folderFiles) {
        if (!file.name.toLowerCase().match(/\.(mp4|mkv|avi)$/)) continue;
        items.push({
          id: `seedr|${file.folder_file_id}`,
          name: file.name,
          type: 'movie',
          poster: `${API_URL}/thumbnail/${file.folder_file_id}?access_token=${accessToken}` || 'https://via.placeholder.com/150'
        });
      }
    }
    for (const file of files) {
      if (!file.name.toLowerCase().match(/\.(mp4|mkv|avi)$/)) continue;
      items.push({
        id: `seedr|${file.folder_file_id}`,
        name: file.name,
        type: 'movie',
        poster: `${API_URL}/thumbnail/${file.folder_file_id}?access_token=${accessToken}` || 'https://via.placeholder.com/150'
      });
    }
    res.json({ metas: items });
  } catch (e) {
    console.error('Catalog error:', e.message);
    res.json({ metas: [] });
  }
});

// Route: Stream
app.get('/stream/:type/:id.json', async (req, res) => {
  const [prefix, fileId] = req.params.id.split('|');
  const users = loadUsers();
  const accessToken = users.access_token;
  if (!accessToken) {
    console.error('No access token found');
    return res.json({ streams: [] });
  }
  try {
    const url = `${API_URL}/media/hls/${fileId}?access_token=${accessToken}`;
    const response = await fetchJsonDictionary(url);
    if (response && response.url) {
      res.json({
        streams: [{
          title: 'Seedr Stream',
          url: response.url, // HLS (M3U) URL for streaming
          behaviorHints: { bingeGroup: `seedr-${fileId}` }
        }]
      });
    } else {
      console.error(`No stream URL for file ${fileId}`);
      res.json({ streams: [] });
    }
  } catch (e) {
    console.error(`Stream error for ${fileId}:`, e.message);
    res.json({ streams: [] });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running on http://localhost:${PORT}`);
});
