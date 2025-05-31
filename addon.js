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
    console.error(`API error at ${url}:`, e.message, e.response?.data || '');
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
    id: 'sidh3369.seedr.stremio.addon',
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
    const items = [];
    // Fetch root folder
    const rootData = await fetchJsonDictionary(`${API_URL}/folder?access_token=${accessToken}`);
    console.log('Root folder data:', JSON.stringify(rootData, null, 2));

    // Process root files
    const rootFiles = rootData.files || [];
    for (const file of rootFiles) {
      if (file.play_video || file.play_audio) {
        items.push({
          id: `seedr|${file.folder_file_id}`,
          name: file.name,
          type: 'movie',
          poster: `${API_URL}/thumbnail/${file.folder_file_id}?access_token=${accessToken}` || 'https://via.placeholder.com/150'
        });
      }
    }

    // Process folders
    const folders = rootData.folders || [];
    for (const folder of folders) {
      const folderData = await fetchJsonDictionary(`${API_URL}/folder/${folder.id}?access_token=${accessToken}`);
      console.log(`Folder ${folder.id} data:`, JSON.stringify(folderData, null, 2));
      const folderFiles = folderData.files || [];
      for (const file of folderFiles) {
        if (file.play_video || file.play_audio) {
          items.push({
            id: `seedr|${file.folder_file_id}`,
            name: file.name,
            type: 'movie',
            poster: `${API_URL}/thumbnail/${file.folder_file_id}?access_token=${accessToken}` || 'https://via.placeholder.com/150'
          });
        }
      }
    }

    console.log('Catalog items:', JSON.stringify(items, null, 2));
    res.json({ metas: items });
  } catch (e) {
    console.error('Catalog error:', e.message, e.response?.data || '');
    res.json({ metas: [] });
  }
});

// Route: Stream
app.get('/stream/:type/:id.json', async (req, res) => {
  const [prefix, fileId] = req.params.id.split('|');
  const users = loadUsers();
  const accessToken = users.access_token;
  if (!accessToken) {
    console.error('No access token found for stream request');
    return res.json({ streams: [] });
  }
  try {
    console.log(`Fetching stream for fileId: ${fileId}`);
    // Fetch file details to verify streamability
    const fileInfo = await fetchJsonDictionary(`${API_URL}/file/${fileId}?access_token=${accessToken}`);
    console.log(`File info for ${fileId}:`, JSON.stringify(fileInfo, null, 2));
    
    if (fileInfo && (fileInfo.play_video || fileInfo.play_audio)) {
      // Try HLS endpoint
      const hlsUrl = `${API_URL}/file/${fileId}/hls?access_token=${accessToken}`;
      const hlsResponse = await fetchJsonDictionary(hlsUrl);
      console.log(`HLS response for ${fileId}:`, JSON.stringify(hlsResponse, null, 2));
      
      if (hlsResponse && hlsResponse.url) {
        console.log(`Stream URL generated: ${hlsResponse.url}`);
        res.json({
          streams: [{
            title: 'Seedr Stream',
            url: hlsResponse.url,
            behaviorHints: { bingeGroup: `seedr-${fileId}` }
          }]
        });
        return;
      }
    }
    console.error(`No streamable URL for file ${fileId}`);
    res.json({ streams: [] });
  } catch (e) {
    console.error(`Stream error for ${fileId}:`, e.message, e.response?.data || '');
    res.json({ streams: [] });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Seedr Addon running on http://localhost:${PORT}`);
});
