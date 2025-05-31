require('dotenv').config();
const express = require('express');
const Seedr = require('seedr'); // Import the seedr package
const app = express();
const PORT = process.env.PORT || 3000;

// Define the manifest for the Stremio addon
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
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
        { name: 'genre', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'seedr_series',
      name: 'Seedr Series',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
        { name: 'genre', isRequired: false }
      ]
    }
  ],
  behaviorHints: {
    configurable: true
  }
};

// Serve the manifest
  app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

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
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
          { name: 'genre', isRequired: false }
        ]
      },
      {
        type: 'series',
        id: 'seedr_series',
        name: 'Seedr Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
          { name: 'genre', isRequired: false }
        ]
      }
    ],
    behaviorHints: {
      configurable: true
    }
  };

  res.json(manifest);
});

// Route for catalog
app.get('/catalog/:type/:id/:extra?', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const { type, id } = req.params;
  const config = req.query; // Stremio passes config as query parameters

  try {
    const seedrClient = await getSeedrClient(config);

    // Fetch files from Seedr
    const files = await seedrClient.getFiles(); // This fetches the root folder contents

    // Transform Seedr files into Stremio catalog items
    const catalogItems = files.list.map(item => ({
      id: item.id.toString(), // Use Seedr file/folder ID as Stremio item ID
      type: item.is_folder ? 'series' : 'movie', // Simple mapping: folders are series, files are movies
      name: item.name,
      poster: item.is_folder ? null : 'https://via.placeholder.com/150', // Placeholder poster for files
      // Add other relevant properties like description, year, etc. if available from Seedr API
    }));

    res.json({ catalog: catalogItems });

  } catch (error) {
    console.error('Error in catalog route:', error.message);
    // Return an empty catalog and an error message to Stremio
    res.status(500).json({ catalog: [], error: error.message });
  }
});

// Route for streams
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const { type, id } = req.params;
  const config = req.query; // Stremio passes config as query parameters

  try {
    const seedrClient = await getSeedrClient(config);
    
    // Get file details from Seedr
    const fileDetails = await seedrClient.getFile(id);
    
    if (!fileDetails) {
      return res.json({ streams: [] });
    }

    // If it's a folder, get the files inside
    if (fileDetails.is_folder) {
      const folderContents = await seedrClient.getFiles(id);
      const videoFiles = folderContents.list.filter(file => 
        !file.is_folder && isVideoFile(file.name)
      );
      
      const streams = videoFiles.map(file => ({
        name: `Seedr - ${file.name}`,
        title: file.name,
        url: file.download_url || `https://www.seedr.cc/download/${file.id}`,
        behaviorHints: {
          bingeGroup: `seedr-${id}`
        }
      }));
      
      return res.json({ streams });
    } else {
      // Single file
      if (isVideoFile(fileDetails.name)) {
        const stream = {
          name: `Seedr - ${fileDetails.name}`,
          title: fileDetails.name,
          url: fileDetails.download_url || `https://www.seedr.cc/download/${fileDetails.id}`,
          behaviorHints: {
            bingeGroup: `seedr-${id}`
          }
        };
        
        return res.json({ streams: [stream] });
      }
    }
    
    res.json({ streams: [] });
  } catch (error) {
    console.error('Error in stream route:', error.message);
    res.json({ streams: [] });
  }
});

// Helper function to check if a file is a video file
function isVideoFile(filename) {
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.m2ts'];
  return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ Seedr Stremio Addon</h1>
    <p>This is a custom Stremio addon.</p>
    <p><a href="/manifest.json">View Manifest</a></p>
  `);
});
app.listen(PORT, () => {
  console.log(`Seedr Stremio Addon listening at http://localhost:${PORT}`);
});