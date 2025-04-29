// save-transparent-gif.js
const fs = require('fs');

// This is a base64-encoded 1x1 transparent GIF
const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

fs.writeFileSync('transparent.gif', transparentGif);
console.log('Transparent GIF created successfully');