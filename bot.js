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

// Инициализация бота
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
  rerunGenres: null
};

// Жанры
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
         !/\d{3,}/.test(text.split(' - ')[0]);
}

// Проверка на дубликаты книг
function hasDuplicateBooks(suggestions) {
  const unique = new Set(suggestions.map(s => s.toLowerCase()));
  return unique.size !== suggestions.length;
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
  
  bot.sendMessage(chatId, 
    `📚 <b>Привет! Я чат-бот Книжного клуба</b>\n\n` +
    '✨ <b>Основная команда:</b>\n' +
    '/selectgenre - Выбрать жанр для голосования\n' +
    '📝 <i>Формат предложения книги:</i>\n' +
    '<code>Автор - Название книги</code>\n\n' +
    '⏳ Голосование за жанр - 8 часов\n' +
    '⏳ Предложение книг и голосование - 24 часа', {
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
        '2. Предложите книгу в Личные Сообщения боту\n' +
        '3. Голосуйте за понравившийся вариант');
      break;
      
    case 'show_rules':
      bot.sendMessage(chatId,
        '📜 <b>Правила книжного клуба:</b>\n\n' +
        '• Расскажите всем о книжном клубе\n' +
        '• Максимум 2 предложения на человека\n' +
        '• Формат предложения книги обязательно: "Автор - Название"\n' +
        '• Наслаждайтесь чтением!\n' +
        '• Голосование за жанр: 8 часов\n' +
        '• Голосование за книгу: 24 часа', {
        parse_mode: 'HTML'
      });
      break;
  }
});

// Команда выбора жанра (сохранены ваши оригинальные тексты)
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
      explanation: 'Голосование закроется через 8 часов'
    }
  ).then(poll => {
    botState.genrePoll = {
      id: poll.poll.id,
      chatId: chatId,
      messageId: poll.message_id
    };

    botState.timers.genrePoll = setTimeout(() => {
      closeGenrePoll(chatId);
    }, 8 * 60 * 60 * 1000);

  }).catch(err => {
    console.error('Ошибка создания опроса:', err);
    bot.sendMessage(chatId, '❌ Не удалось создать опрос. Попробуйте позже.');
  });
});

// Обновленная функция closeGenrePoll с исправленной логикой повторного голосования
function closeGenrePoll(chatId) {
  if (!botState.genrePoll) return;

  clearTimeout(botState.timers.genrePoll);
  
  bot.stopPoll(botState.genrePoll.chatId, botState.genrePoll.messageId)
    .then(poll => {
      // Создаем массив с результатами
      const results = poll.options.map((opt, index) => ({
        genre: genres[index],
        votes: opt.voter_count
      }));

      // Находим максимальное количество голосов
      const maxVotes = Math.max(...results.map(r => r.votes));
      
      // Фильтруем победителей
      const winners = results.filter(r => r.votes === maxVotes);

      if (maxVotes === 0) {
        bot.sendMessage(chatId, '❌ Никто не проголосовал! Используйте /selectgenre');
        return;
      }

      // Если ничья (несколько победителей)
      if (winners.length > 1) {
        const winnerGenres = winners.map(w => w.genre);
        
        // Сохраняем оригинальные жанры для повторного голосования
        botState.rerunGenres = winnerGenres;
        
        bot.sendMessage(
          chatId,
          `⚖️ Ничья между жанрами: ${winnerGenres.join(', ')}\n` +
          `Начинаем повторное голосование только между этими жанрами!`
        );
        
        return bot.sendPoll(
          chatId,
          '📚 Выберите жанр (повторное голосование):',
          winnerGenres,
          {
            is_anonymous: false,
            allows_multiple_answers: false,
            explanation: 'Голосование закроется через 1 час'
          }
        ).then(newPoll => {
          botState.genrePoll = {
            id: newPoll.poll.id,
            chatId: chatId,
            messageId: newPoll.message_id,
            isRerun: true // Помечаем как повторное голосование
          };
          
          botState.timers.genrePoll = setTimeout(() => {
            closeGenrePoll(chatId);
          }, 1 * 60 * 60 * 1000);
        });
      }

      // Если один победитель
      const winner = winners[0];
      bot.sendMessage(
        chatId,
        `🎉 Выбран жанр: <b>${winner.genre}</b>!\n\n` +
        'Теперь присылайте книги в ЛС бота в формате:\n' +
        '<code>Автор - Название</code>\n\n' +
        '⏳ У вас есть 24 часа!', {
        parse_mode: 'HTML'
      });

      startBookCollection(chatId, winner.genre);
    })
    .catch(err => {
      console.error('Ошибка завершения опроса:', err);
      bot.sendMessage(chatId, '❌ Ошибка при обработке результатов');
    })
    .finally(() => {
      if (!botState.genrePoll?.isRerun) {
        botState.genrePoll = null;
      }
    });
}

// Функция для обработки повторного голосования
function handleRerunVoting(chatId, poll) {
  const results = poll.options.map((opt, index) => ({
    genre: botState.rerunGenres[index],
    votes: opt.voter_count
  }));

  const maxVotes = Math.max(...results.map(r => r.votes));
  const winners = results.filter(r => r.votes === maxVotes);

  // В повторном голосовании выбираем первый вариант при ничье
  const winner = winners[0];
  
  bot.sendMessage(
    chatId,
    `🎉 По результатам повторного голосования выбран жанр: <b>${winner.genre}</b>!\n\n` +
    'Теперь присылайте книги в Личные Сообщения боту в формате:\n' +
    '<code>Автор - Название</code>\n\n' +
    '⏳ У вас есть 24 часа!', {
    parse_mode: 'HTML'
  });

  startBookCollection(chatId, winner.genre);
  delete botState.rerunGenres;
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
  }, 24 * 60 * 60 * 1000);
}

// Обработка предложений книг (с проверкой дубликатов)
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

  // Проверка дубликатов
  const [author, title] = text.split(' - ').map(s => s.trim());
  const bookEntry = `${author} - ${title}`;
  
  if (botState.bookSuggestions.suggestions.some(s => s.toLowerCase() === bookEntry.toLowerCase())) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Эта книга уже была предложена!\n' +
      'Пожалуйста, предложите другую книгу.'
    );
  }

  // Добавление предложения
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

// Создание опроса по книгам (с проверкой дубликатов)
function closeBookCollection(chatId) {
  if (!botState.bookSuggestions) return;

  // Проверка на дубликаты перед созданием опроса
  if (hasDuplicateBooks(botState.bookSuggestions.suggestions)) {
    return bot.sendMessage(
      chatId,
      '❌ Обнаружены дубликаты книг!\n' +
      'Пожалуйста, начните процесс заново с /selectgenre'
    );
  }

  if (botState.bookSuggestions.suggestions.length < 2) {
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
    }, 24 * 60 * 60 * 1000);

  }).catch(err => {
    console.error('Ошибка создания опроса:', err);
    bot.sendMessage(chatId, '❌ Не удалось начать голосование. Попробуйте снова.');
  });
}

// Завершение голосования (с обработкой ничьи)
function closeBookPoll(chatId) {
  if (!botState.bookPoll) return;

  clearTimeout(botState.timers.bookPoll);
  
  bot.stopPoll(botState.bookPoll.chatId, botState.bookPoll.messageId)
    .then(poll => {
      const results = poll.options.map((opt, idx) => ({
        book: botState.bookPoll.suggestions[idx],
        votes: opt.voter_count
      })).sort((a, b) => b.votes - a.votes);

      const maxVotes = results[0].votes;
      
      // Проверка на ничью
      const winners = results.filter(r => r.votes === maxVotes);
      
      if (maxVotes === 0) {
        bot.sendMessage(chatId, '❌ Никто не проголосовал! Начните заново с /selectgenre');
        return;
      }

      if (winners.length > 1) {
        // Ничья - запускаем новый опрос только между победителями
        const winnerBooks = winners.map(w => w.book);
        bot.sendMessage(
          chatId,
          `⚖️ Ничья между книгами! Повторное голосование:\n` +
          `${winnerBooks.join('\n')}`
        );
        
        bot.sendPoll(
          chatId,
          '📚 Выберите книгу (повторное голосование):',
          winnerBooks,
          {
            is_anonymous: false,
            allows_multiple_answers: false,
            explanation: 'Голосование закроется через 1 час'
          }
        ).then(newPoll => {
          botState.bookPoll = {
            id: newPoll.poll.id,
            chatId: chatId,
            messageId: newPoll.message_id,
            suggestions: winnerBooks
          };
          
          botState.timers.bookPoll = setTimeout(() => {
            closeBookPoll(chatId);
          }, 1 * 60 * 60 * 1000);
        });
        
        return;
      }

      // Один победитель
      bot.sendMessage(
        chatId,
        `🏆 <b>Победитель голосования:</b>\n\n` +
        `<i>${results[0].book}</i>\n\n` +
        `Набрано голосов: <b>${results[0].votes}</b>\n\n` +
        `Следующее голосование через месяц! Приятного приключения в мир книги!`, {
        parse_mode: 'HTML'
      });
    })
    .finally(() => {
      if (botState.bookPoll && botState.bookPoll.chatId === chatId) {
        botState.bookPoll = null;
        botState.bookSuggestions = {};
        botState.userSuggestions = {};
      }
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
}, 4 * 60 * 1000);

// Корректное завершение
process.on('SIGTERM', () => {
  console.log('Завершение работы...');
  bot.stopPolling();
  server.close(() => process.exit(0));
});

// Запуск бота
startBot();