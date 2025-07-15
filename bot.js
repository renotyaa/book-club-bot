// 1. Инициализация окружения и библиотек
require('dotenv').config(); // Загрузка переменных окружения (должен быть первым!)
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

// 2. Настройка сервера для Render
const app = express();
const PORT = process.env.PORT || 10000; // Render требует порт 10000

app.get('/', (req, res) => res.send('Book Club Bot is running!'));
app.get('/ping', (req, res) => res.send('Pong!'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});

// 3. Инициализация бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// 4. Состояния бота
const botState = {
  genrePoll: null,
  bookSuggestions: {},
  bookPoll: null,
  timers: {},
  userSuggestions: {},
};

// 5. Жанры с эмодзи
const genres = [
  '🚀 Фантастика',
  '🧙 Фэнтези',
  '🕵️ Детектив',
  '🔪 Триллер',
  '💘 Роман',
  '👻 Ужасы',
  '🏰 Исторический',
  '📜 Биография',
  '🔬 Научная литература',
  '🧠 Психология',
  '✒️ Поэзия',
  '🗺️ Приключения'
];

// 6. Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;
  
  bot.sendMessage(chatId, `📚 <b>Привет, ${name}!</b> Я бот книжного клуба.\n\n` +
    '✨ <b>Доступные команды:</b>\n' +
    '/start - Перезапустить бота\n' +
    '/selectgenre - Выбрать жанр книги\n' +
    '/help - Помощь\n\n' +
    '📝 <i>Предлагайте книги в ЛС бота в формате:</i>\n' +
    '<code>Автор - Название книги</code>', {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Выбрать жанр', callback_data: 'select_genre' }],
        [{ text: '📜 Правила', callback_data: 'show_rules' }]
      ]
    }
  });
});

// 7. Обработка inline-кнопок
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  
  if (query.data === 'select_genre') {
    bot.sendMessage(chatId, 'Используйте /selectgenre в групповом чате');
  }
  else if (query.data === 'show_rules') {
    bot.sendMessage(chatId, '📜 <b>Правила книжного клуба:</b>\n\n' +
      '1. Максимум 2 предложения на человека\n' +
      '2. Формат: "Автор - Книга"\n' +
      '3. Голосование длится 5 минут\n' +
      '4. Детские и кулинарные книги не принимаются', {
      parse_mode: 'HTML'
    });
  }
});

// 8. Команда выбора жанра
bot.onText(/\/selectgenre/, (msg) => {
  const chatId = msg.chat.id;
  
  if (botState.genrePoll) {
    return bot.sendMessage(chatId, '❌ Опрос уже запущен!');
  }

  bot.sendPoll(
    chatId,
    '📚 Выберите жанр для следующей книги:',
    genres,
    { is_anonymous: false, allows_multiple_answers: false }
  ).then(poll => {
    botState.genrePoll = {
      id: poll.poll.id,
      chatId: chatId,
      messageId: poll.message_id
    };

    botState.timers.genrePoll = setTimeout(() => {
      closeGenrePoll(chatId);
    }, 5 * 60 * 1000); // 5 минут

    bot.sendMessage(chatId, '⏳ У вас есть 5 минут на выбор жанра!');
  }).catch(err => {
    console.error('Poll error:', err);
    bot.sendMessage(chatId, '❌ Ошибка при создании опроса');
  });
});

// 9. Функция закрытия опроса жанров
function closeGenrePoll(chatId) {
  if (!botState.genrePoll) return;

  clearTimeout(botState.timers.genrePoll);
  
  bot.stopPoll(botState.genrePoll.chatId, botState.genrePoll.messageId)
    .then(poll => {
      let maxVotes = 0;
      let selectedGenre = '';
      
      poll.options.forEach((option, index) => {
        if (option.voter_count > maxVotes) {
          maxVotes = option.voter_count;
          selectedGenre = genres[index];
        }
      });

      const message = maxVotes > 0 
        ? `🎉 Выбран жанр: ${selectedGenre}!\nТеперь предлагайте книги в ЛС бота.`
        : '❌ Никто не проголосовал!';
        
      bot.sendMessage(chatId, message);
      
      if (maxVotes > 0) {
        startBookCollection(chatId, selectedGenre);
      }
    })
    .finally(() => {
      botState.genrePoll = null;
    });
}

// 10. Сбор предложений книг
function startBookCollection(chatId, genre) {
  botState.bookSuggestions = {
    chatId: chatId,
    genre: genre,
    suggestions: [],
    users: new Set()
  };

  botState.timers.bookCollection = setTimeout(() => {
    closeBookCollection(chatId);
  }, 5 * 60 * 1000);
}

// 11. Обработка предложений книг
bot.on('message', (msg) => {
  if (!msg.text || msg.chat.type !== 'private') return;
  
  const userId = msg.from.id;
  const text = msg.text.trim();

  if (!text.includes(' - ')) {
    return bot.sendMessage(msg.chat.id, '❌ Используйте формат: "Автор - Название книги"');
  }

  if (!botState.userSuggestions[userId]) {
    botState.userSuggestions[userId] = [];
  }

  if (botState.userSuggestions[userId].length >= 2) {
    return bot.sendMessage(msg.chat.id, '❌ Вы уже предложили 2 книги!');
  }

  botState.userSuggestions[userId].push(text);
  botState.bookSuggestions.suggestions.push(text);
  
  bot.sendMessage(msg.chat.id, `✅ Книга "${text}" принята!`);
});

// 12. Создание опроса по книгам
function closeBookCollection(chatId) {
  if (!botState.bookSuggestions) return;

  clearTimeout(botState.timers.bookCollection);
  
  const { suggestions, genre } = botState.bookSuggestions;
  
  if (suggestions.length < 2) {
    return bot.sendMessage(chatId, '❌ Недостаточно предложений!');
  }

  bot.sendPoll(
    chatId,
    `📚 Голосование за книгу (${genre}):`,
    suggestions,
    { is_anonymous: false, allows_multiple_answers: true }
  ).then(poll => {
    botState.bookPoll = {
      id: poll.poll.id,
      chatId: chatId,
      messageId: poll.message_id,
      suggestions: suggestions
    };

    botState.timers.bookPoll = setTimeout(() => {
      closeBookPoll(chatId);
    }, 5 * 60 * 1000);
  });
}

// 13. Завершение голосования
function closeBookPoll(chatId) {
  if (!botState.bookPoll) return;

  clearTimeout(botState.timers.bookPoll);
  
  bot.stopPoll(botState.bookPoll.chatId, botState.bookPoll.messageId)
    .then(poll => {
      let maxVotes = 0;
      let winner = '';
      
      poll.options.forEach((option, index) => {
        if (option.voter_count > maxVotes) {
          maxVotes = option.voter_count;
          winner = botState.bookPoll.suggestions[index];
        }
      });

      const message = maxVotes > 0
        ? `🏆 Победитель: ${winner}`
        : '❌ Никто не проголосовал!';
        
      bot.sendMessage(chatId, message);
    })
    .finally(() => {
      botState.bookPoll = null;
    });
}

// 14. Обработка ошибок
bot.on('polling_error', console.error);
bot.on('webhook_error', console.error);

// 15. Пинг для Render (чтобы не засыпал)
setInterval(() => {
  axios.get(`${process.env.RENDER_EXTERNAL_URL}/ping`)
    .catch(err => console.log('Ping error:', err.message));
}, 5 * 60 * 1000); // Каждые 5 минут

console.log('🤖 Бот запущен!');