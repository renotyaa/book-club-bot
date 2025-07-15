require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

// Настройка сервера для Render
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Book Club Bot is running'));
app.get('/ping', (req, res) => res.send('pong'));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});

// Инициализация бота с улучшенной обработкой ошибок
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, {
  polling: {
    autoStart: false,
    params: { timeout: 30 }
  },
  request: {
    timeout: 20000
  }
});

// Состояния бота
const botState = {
  genrePoll: null,
  bookSuggestions: {},
  bookPoll: null,
  timers: {},
  userSuggestions: {},
};

// Жанры с эмодзи
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

// Функция валидации предложения книги
function isValidBookSuggestion(text) {
  return /^[^\-]{2,} - [^\-]{2,}$/.test(text) && 
         !/\d{3,}/.test(text.split(' - ')[0]); // Блокируем числа типа "319."
}

// Запуск бота с защитой от конфликтов
const startBot = () => {
  bot.startPolling()
    .then(() => console.log('🤖 Бот запущен и готов к работе'))
    .catch(err => {
      console.error('Ошибка запуска:', err.message);
      setTimeout(startBot, 5000);
    });
};

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;
  
  bot.sendMessage(chatId, 
    `📚 <b>Привет, ${name}!</b> Я бот книжного клуба.\n\n` +
    '✨ <b>Основные команды:</b>\n' +
    '/selectgenre - Выбрать жанр для голосования\n' +
    '/help - Показать все команды\n\n' +
    '📝 <i>Формат предложения книги:</i>\n' +
    '<code>Автор - Название книги</code>\n\n' +
    '⏳ Каждое голосование длится 5 минут', {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Начать', callback_data: 'start_guide' }],
        [{ text: '📜 Правила', callback_data: 'show_rules' }]
      ]
    }
  });
});

// Обработка inline-кнопок
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  
  switch(query.data) {
    case 'start_guide':
      bot.sendMessage(chatId, 
        '1. Используйте /selectgenre в группе\n' +
        '2. Предложите книгу в ЛС бота\n' +
        '3. Голосуйте за лучший вариант');
      break;
      
    case 'show_rules':
      bot.sendMessage(chatId,
        '📜 <b>Правила книжного клуба:</b>\n\n' +
        '• Максимум 2 предложения на человека\n' +
        '• Формат: "Автор - Название"\n' +
        '• Запрещены детские и кулинарные книги\n' +
        '• Голосование длится 5 минут', {
        parse_mode: 'HTML'
      });
      break;
  }
});

// Команда выбора жанра
bot.onText(/\/selectgenre/, (msg) => {
  const chatId = msg.chat.id;
  
  if (botState.genrePoll) {
    return bot.sendMessage(chatId, '⏳ Опрос уже активен! Дождитесь его завершения.');
  }

  bot.sendPoll(
    chatId,
    '📚 Выберите жанр для следующей книги:',
    genres,
    { 
      is_anonymous: false, 
      allows_multiple_answers: false,
      explanation: 'Голосование закроется через 5 минут'
    }
  ).then(poll => {
    botState.genrePoll = {
      id: poll.poll.id,
      chatId: chatId,
      messageId: poll.message_id
    };

    botState.timers.genrePoll = setTimeout(() => {
      closeGenrePoll(chatId);
    }, 5 * 60 * 1000);

  }).catch(err => {
    console.error('Ошибка создания опроса:', err);
    bot.sendMessage(chatId, '❌ Не удалось создать опрос. Попробуйте позже.');
  });
});

// Закрытие опроса жанров
function closeGenrePoll(chatId) {
  if (!botState.genrePoll) return;

  clearTimeout(botState.timers.genrePoll);
  
  bot.stopPoll(botState.genrePoll.chatId, botState.genrePoll.messageId)
    .then(poll => {
      const winner = poll.options.reduce((prev, current, index) => 
        (current.voter_count > prev.votes) ? 
          { genre: genres[index], votes: current.voter_count } : prev, 
        { genre: '', votes: 0 }
      );

      if (winner.votes === 0) {
        bot.sendMessage(chatId, '❌ Никто не проголосовал! Используйте /selectgenre');
        return;
      }

      bot.sendMessage(
        chatId,
        `🎉 Выбран жанр: <b>${winner.genre}</b>!\n\n` +
        'Теперь присылайте книги в ЛС бота в формате:\n' +
        '<code>Автор - Название</code>\n\n' +
        '⏳ У вас есть 5 минут!', {
        parse_mode: 'HTML'
      });

      startBookCollection(chatId, winner.genre);
    })
    .finally(() => {
      botState.genrePoll = null;
    });
}

// Сбор предложений книг
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

// Обработка предложений книг
bot.on('message', (msg) => {
  if (!msg.text || msg.chat.type !== 'private') return;
  
  const userId = msg.from.id;
  const text = msg.text.trim();

  // Проверка формата
  if (!isValidBookSuggestion(text)) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Неверный формат. Используйте:\n\n' +
      '<code>Автор - Название книги</code>\n\n' +
      '• Минимум 2 символа с каждой стороны\n' +
      '• Без лишних дефисов\n' +
      'Пример: <code>Толстой - Война и мир</code>', {
      parse_mode: 'HTML'
    });
  }

  // Инициализация пользователя
  if (!botState.userSuggestions[userId]) {
    botState.userSuggestions[userId] = [];
  }

  // Проверка лимита
  if (botState.userSuggestions[userId].length >= 2) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Вы уже предложили 2 книги!\n' +
      'Дождитесь следующего голосования.'
    );
  }

  // Добавление предложения
  const [author, title] = text.split(' - ').map(s => s.trim());
  const bookEntry = `${author} - ${title}`;
  
  botState.userSuggestions[userId].push(bookEntry);
  botState.bookSuggestions.suggestions.push(bookEntry);

  bot.sendMessage(
    msg.chat.id,
    `✅ Книга "<i>${title}</i>" принята!\n` +
    `Автор: <b>${author}</b>\n\n` +
    `Можно предложить ещё ${2 - botState.userSuggestions[userId].length} книг.`, {
    parse_mode: 'HTML'
  });
});

// Создание опроса по книгам
function closeBookCollection(chatId) {
  if (!botState.bookSuggestions || botState.bookSuggestions.suggestions.length < 2) {
    return bot.sendMessage(
      chatId,
      '❌ Недостаточно предложений для голосования!\n' +
      'Нужно минимум 2 разные книги.'
    );
  }

  const { suggestions, genre } = botState.bookSuggestions;

  bot.sendPoll(
    chatId,
    `📚 Голосование за книгу (${genre}):`,
    suggestions,
    { 
      is_anonymous: false, 
      allows_multiple_answers: true,
      explanation: 'Можно выбрать несколько вариантов'
    }
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

  }).catch(err => {
    console.error('Ошибка создания опроса:', err);
    bot.sendMessage(chatId, '❌ Не удалось начать голосование. Попробуйте снова.');
  });
}

// Завершение голосования
function closeBookPoll(chatId) {
  if (!botState.bookPoll) return;

  clearTimeout(botState.timers.bookPoll);
  
  bot.stopPoll(botState.bookPoll.chatId, botState.bookPoll.messageId)
    .then(poll => {
      const results = poll.options.map((opt, idx) => ({
        book: botState.bookPoll.suggestions[idx],
        votes: opt.voter_count
      }));

      const winner = results.reduce((prev, curr) => 
        curr.votes > prev.votes ? curr : prev
      );

      if (winner.votes === 0) {
        bot.sendMessage(chatId, '❌ Никто не проголосовал! Начните заново с /selectgenre');
        return;
      }

      bot.sendMessage(
        chatId,
        `🏆 <b>Победитель голосования:</b>\n\n` +
        `<i>${winner.book}</i>\n\n` +
        `Набрано голосов: <b>${winner.votes}</b>\n\n` +
        `Следующее голосование через месяц!`, {
        parse_mode: 'HTML'
      });
    })
    .finally(() => {
      botState.bookPoll = null;
      botState.bookSuggestions = {};
      botState.userSuggestions = {};
    });
}

// Обработчики ошибок
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
  if (err.code === 409) {
    setTimeout(startBot, 5000);
  }
});

bot.on('webhook_error', (err) => {
  console.error('Webhook error:', err);
});

// Пинг для Render
setInterval(() => {
  axios.get(`${process.env.RENDER_EXTERNAL_URL}/ping`)
    .catch(err => console.log('Ping error:', err.message));
}, 5 * 60 * 1000);

// Корректное завершение
process.on('SIGTERM', () => {
  console.log('Завершение работы...');
  bot.stopPolling();
  server.close(() => process.exit(0));
});

// Запуск бота
startBot();