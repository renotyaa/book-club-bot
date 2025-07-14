require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Ошибка: Не указан TELEGRAM_BOT_TOKEN!');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Простой обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Привет! Я книжный бот. Используй /help для списка команд');
});

// Обработчик команды /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Доступные команды:\n/start - начать работу\n/help - помощь');
});

console.log('Бот запущен и работает...');