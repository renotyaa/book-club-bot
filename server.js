const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000; // Render использует порт 10000

// Обязательный эндпоинт для проверки
app.get('/', (req, res) => {
  res.send('Book Club Bot is running!');
});

// Эндпоинт для пингов (чтобы не засыпал)
app.get('/ping', (req, res) => {
  res.send('Pong!');
});

// Явно указываем 0.0.0.0 для Render
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});

// Обработка ошибок
server.on('error', (err) => {
  console.error('Server error:', err);
});