const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Book Club Bot is running!');
});

// Ping endpoint to keep Render alive
app.get('/ping', (req, res) => {
  res.send('Pong!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Ping self every 5 minutes to prevent Render from sleeping
if (process.env.RENDER_EXTERNAL_URL) {
  const axios = require('axios');
  setInterval(() => {
    axios.get(`${process.env.RENDER_EXTERNAL_URL}/ping`)
      .then(() => console.log('Pinged self to stay awake'))
      .catch(err => console.error('Error pinging self:', err.message));
  }, 5 * 60 * 1000); // 5 minutes
}