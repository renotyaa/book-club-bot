require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Инициализация бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Состояния бота
const botState = {
  genrePoll: null,
  bookSuggestions: {},
  bookPoll: null,
  timers: {},
  userSuggestions: {},
};

// Жанры книг (12 жанров, исключая кулинарию и детскую литературу)
const genres = [
  'Фантастика',
  'Фэнтези',
  'Детектив',
  'Триллер',
  'Роман',
  'Ужасы',
  'Исторический',
  'Биография',
  'Научная литература',
  'Психология',
  'Поэзия',
  'Приключения'
];

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Добро пожаловать в книжный клуб! Используйте /selectgenre для выбора жанра.');
});

// Команда для выбора жанра
bot.onText(/\/selectgenre/, (msg) => {
  const chatId = msg.chat.id;
  
  // Проверяем, не активен ли уже опрос
  if (botState.genrePoll) {
    bot.sendMessage(chatId, 'Опрос по выбору жанра уже запущен!');
    return;
  }

  // Создаем опрос
  bot.sendPoll(
    chatId,
    'Выберите жанр для следующей книги:',
    genres,
    { is_anonymous: false, allows_multiple_answers: false }
  ).then((poll) => {
    botState.genrePoll = {
      id: poll.poll.id,
      chatId: chatId,
      messageId: poll.message_id
    };

    // Устанавливаем таймер на 5 минут
    botState.timers.genrePoll = setTimeout(() => {
      closeGenrePoll(chatId);
    }, 5 * 60 * 1000);

    bot.sendMessage(chatId, 'У вас есть 5 минут, чтобы выбрать жанр!');
  }).catch((err) => {
    console.error('Error creating poll:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при создании опроса. Попробуйте снова.');
  });
});

// Функция закрытия опроса по жанрам
function closeGenrePoll(chatId) {
  if (!botState.genrePoll) return;

  // Останавливаем таймер
  if (botState.timers.genrePoll) {
    clearTimeout(botState.timers.genrePoll);
    delete botState.timers.genrePoll;
  }

  // Получаем результаты опроса
  bot.stopPoll(botState.genrePoll.chatId, botState.genrePoll.messageId)
    .then((poll) => {
      // Находим жанр с максимальным количеством голосов
      let maxVotes = 0;
      let selectedGenre = '';
      
      poll.options.forEach((option, index) => {
        if (option.voter_count > maxVotes) {
          maxVotes = option.voter_count;
          selectedGenre = genres[index];
        }
      });

      if (maxVotes === 0) {
        bot.sendMessage(chatId, 'Никто не проголосовал! Начните заново с /selectgenre');
      } else {
        bot.sendMessage(chatId, `Выбран жанр: ${selectedGenre}! Теперь предлагайте книги в ЛС бота в формате "Автор - Название книги". У вас есть 5 минут.`);
        
        // Запускаем сбор предложений
        startBookCollection(chatId, selectedGenre);
      }
    })
    .catch((err) => {
      console.error('Error stopping poll:', err);
      bot.sendMessage(chatId, 'Произошла ошибка при подсчете голосов. Попробуйте снова.');
    })
    .finally(() => {
      botState.genrePoll = null;
    });
}

// Запуск сбора предложений книг
function startBookCollection(chatId, genre) {
  botState.bookSuggestions = {
    chatId: chatId,
    genre: genre,
    suggestions: [],
    users: new Set()
  };

  // Устанавливаем таймер на 5 минут
  botState.timers.bookCollection = setTimeout(() => {
    closeBookCollection(chatId);
  }, 5 * 60 * 1000);

  // Инициализируем объект для отслеживания предложений пользователей
  botState.userSuggestions = {};
}

// Обработка предложений книг в ЛС
bot.on('message', (msg) => {
  if (!msg.text || !botState.bookSuggestions.chatId) return;
  if (msg.chat.type !== 'private') return;

  const userId = msg.from.id;
  const text = msg.text.trim();

  // Проверяем формат "Автор - Книга"
  if (!text.includes(' - ')) {
    bot.sendMessage(msg.chat.id, 'Пожалуйста, используйте формат: "Автор - Название книги"');
    return;
  }

  // Проверяем, сколько предложений уже сделал пользователь
  if (!botState.userSuggestions[userId]) {
    botState.userSuggestions[userId] = [];
  }

  if (botState.userSuggestions[userId].length >= 2) {
    bot.sendMessage(msg.chat.id, 'Вы уже предложили максимальное количество книг (2).');
    return;
  }

  // Добавляем предложение
  botState.userSuggestions[userId].push(text);
  botState.bookSuggestions.suggestions.push(text);
  botState.bookSuggestions.users.add(userId);

  bot.sendMessage(msg.chat.id, `Ваше предложение "${text}" принято! ${botState.userSuggestions[userId].length < 2 ? 'Вы можете предложить еще одну книгу.' : 'Вы достигли лимита предложений.'}`);
});

// Закрытие сбора предложений
function closeBookCollection(chatId) {
  if (!botState.bookSuggestions.chatId) return;

  // Останавливаем таймер
  if (botState.timers.bookCollection) {
    clearTimeout(botState.timers.bookCollection);
    delete botState.timers.bookCollection;
  }

  const suggestions = botState.bookSuggestions.suggestions;
  const genre = botState.bookSuggestions.genre;

  if (suggestions.length < 2) {
    bot.sendMessage(chatId, `Получено недостаточно предложений книг (${suggestions.length}). Нужно как минимум 2. Начните заново с /selectgenre`);
    botState.bookSuggestions = {};
    return;
  }

  // Создаем опрос с предложенными книгами
  bot.sendPoll(
    chatId,
    `Голосуем за книгу в жанре ${genre}:`,
    suggestions,
    { is_anonymous: false, allows_multiple_answers: true }
  ).then((poll) => {
    botState.bookPoll = {
      id: poll.poll.id,
      chatId: chatId,
      messageId: poll.message_id,
      suggestions: suggestions
    };

    // Устанавливаем таймер на 5 минут
    botState.timers.bookPoll = setTimeout(() => {
      closeBookPoll(chatId);
    }, 5 * 60 * 1000);

    bot.sendMessage(chatId, 'У вас есть 5 минут, чтобы проголосовать за книгу!');
  }).catch((err) => {
    console.error('Error creating book poll:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при создании опроса. Попробуйте снова.');
  }).finally(() => {
    botState.bookSuggestions = {};
    botState.userSuggestions = {};
  });
}

// Закрытие опроса по книгам
function closeBookPoll(chatId) {
  if (!botState.bookPoll) return;

  // Останавливаем таймер
  if (botState.timers.bookPoll) {
    clearTimeout(botState.timers.bookPoll);
    delete botState.timers.bookPoll;
  }

  // Получаем результаты опроса
  bot.stopPoll(botState.bookPoll.chatId, botState.bookPoll.messageId)
    .then((poll) => {
      // Подсчитываем голоса
      let maxVotes = 0;
      let winningIndex = -1;
      let totalVotes = 0;
      
      poll.options.forEach((option, index) => {
        totalVotes += option.voter_count;
        if (option.voter_count > maxVotes) {
          maxVotes = option.voter_count;
          winningIndex = index;
        }
      });

      if (totalVotes === 0) {
        bot.sendMessage(chatId, 'Никто не проголосовал! Начните заново с /selectgenre');
      } else {
        const winningBook = botState.bookPoll.suggestions[winningIndex];
        bot.sendMessage(chatId, `Победила книга: ${winningBook}! Спасибо за участие!`);
      }
    })
    .catch((err) => {
      console.error('Error stopping book poll:', err);
      bot.sendMessage(chatId, 'Произошла ошибка при подсчете голосов. Попробуйте снова.');
    })
    .finally(() => {
      botState.bookPoll = null;
    });
}

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
  console.error('Webhook error:', error);
});

// Запуск бота
console.log('Bot is running...');