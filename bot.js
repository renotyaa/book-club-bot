const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN; // Только через переменные окружения!

if (!token) {
  console.error('❌ Токен не найден!');
  console.error('1. Переменную TELEGRAM_BOT_TOKEN в Render')
  process.exit(1);
}

//экземпляр бота
const bot = new TelegramBot(token, { polling: true});

// Состояния бота
const BOT_STATES = {
  IDLE: 'idle',
  GENRE_VOTING: 'genre_voting',
  BOOK_COLLECTING: 'book_collecting',
  BOOK_VOTING: 'book_voting'
};

// Данные по чатам
const chatData = {};

// Список жанров
const genres = [
  'Фантастика', 'Фэнтези', 'Детектив', 'Роман', 'Нон-фикшн',
  'Биография', 'Исторический', 'Триллер', 'Ужасы', 'Приключения'
];

// Обработчик сообщений в группе
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  // Инициализация данных чата
  if (!chatData[chatId]) {
    chatData[chatId] = {
      state: BOT_STATES.IDLE,
      genrePoll: null,
      bookPoll: null,
      genreVotes: {},
      bookVotes: {},
      suggestedBooks: [],
      timers: {}
    };
  }

  const data = chatData[chatId];

  // Обработка команд
  if (msg.text && msg.text.startsWith('/')) {
    await handleCommand(chatId, msg);
  }
});

// Обработчик сообщений в личке
bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private') return;

  const userId = msg.from.id;
  const text = msg.text;

  // Ищем чат, где пользователь должен предложить книгу
  for (const chatId in chatData) {
    const data = chatData[chatId];
    if (data.state === BOT_STATES.BOOK_COLLECTING) {
      await handlePrivateBookSuggestion(chatId, userId, text);
      return;
    }
  }

  // Если не нашли активный сбор книг
  bot.sendMessage(msg.chat.id, 
    'Сейчас нет активного сбора книг. ' +
    'Дождитесь, когда в группе будет выбран жанр и бот попросит предложить книги.'
  );
});

// Обработчик результатов опроса жанров
bot.on('polling_answer', (answer) => {
  const chatId = answer.chat.id;
  if (!chatData[chatId]) return;

  const data = chatData[chatId];
  
  // Сохраняем голос за жанр
  if (data.state === BOT_STATES.GENRE_VOTING && answer.option_ids) {
    data.genreVotes[answer.user.id] = answer.option_ids[0];
  }
  
  // Сохраняем голос за книгу
  if (data.state === BOT_STATES.BOOK_VOTING && answer.option_ids) {
    data.bookVotes[answer.user.id] = answer.option_ids[0];
  }
});

// Команда старта
async function handleCommand(chatId, msg) {
  const data = chatData[chatId];
  
  if (msg.text === '/start' && data.state === BOT_STATES.IDLE) {
    // Создаем опрос по выбору жанра
    data.state = BOT_STATES.GENRE_VOTING;
    
    bot.sendPoll(
      chatId,
      'Выберите жанр для следующей книги:',
      genres,
      { is_anonymous: false }
    ).then((pollMsg) => {
      data.genrePoll = pollMsg.poll.id;
      
      // Таймер завершения голосования за жанр (10 минут для теста)
      data.timers.genre = setTimeout(() => finishGenreVoting(chatId), 10 * 60 * 1000);
    });
  }
}

// Завершение голосования за жанр
function finishGenreVoting(chatId) {
  const data = chatData[chatId];
  if (!data || data.state !== BOT_STATES.GENRE_VOTING) return;

  // Подсчет голосов
  const voteCount = Array(genres.length).fill(0);
  Object.values(data.genreVotes).forEach(option => {
    if (option >= 0 && option < genres.length) {
      voteCount[option]++;
    }
  });

  // Определение победителя
  let winnerIndex = 0;
  let maxVotes = 0;
  voteCount.forEach((count, index) => {
    if (count > maxVotes) {
      maxVotes = count;
      winnerIndex = index;
    }
  });

  const winnerGenre = genres[winnerIndex];
  
  // Сообщаем результаты
  bot.sendMessage(
    chatId,
    `🏆 По итогам опроса победил жанр: *${winnerGenre}*\n\n` +
    'Теперь каждый участник может предложить книгу этого жанра.\n' +
    'Для этого напишите боту в личку в формате:\n' +
    '"Автор - Название" или "Автор-Название"\n\n' +
    'У вас есть 10 минут!',
    { parse_mode: 'Markdown' }
  );

  // Переходим в режим сбора книг
  data.state = BOT_STATES.BOOK_COLLECTING;
  data.winnerGenre = winnerGenre;
  data.suggestedBooks = [];
  
  // Таймер сбора книг (10 минут для теста)
  data.timers.books = setTimeout(() => finishBookCollection(chatId), 10 * 60 * 1000);
}

// Обработка предложений книг в личке
async function handlePrivateBookSuggestion(chatId, userId, text) {
  const data = chatData[chatId];
  if (!data || data.state !== BOT_STATES.BOOK_COLLECTING) return;

  // Проверка формата
  const bookPattern = /^(.+?)\s*[-—]\s*(.+)$/;
  const match = text.match(bookPattern);
  
  if (!match) {
    bot.sendMessage(
      userId,
      '❌ Неверный формат. Используйте:\n' +
      '"Автор - Название" или "Автор-Название"'
    );
    return;
  }

  const author = match[1].trim();
  const title = match[2].trim();
  const book = `${author} - ${title}`;

  // Проверка на дубликаты
  if (data.suggestedBooks.some(b => b.toLowerCase() === book.toLowerCase())) {
    bot.sendMessage(userId, '❌ Эта книга уже была предложена!');
    return;
  }

  // Добавляем книгу
  data.suggestedBooks.push(book);
  bot.sendMessage(userId, `✅ Книга "${book}" добавлена!`);
}

// Завершение сбора книг
function finishBookCollection(chatId) {
  const data = chatData[chatId];
  if (!data || data.state !== BOT_STATES.BOOK_COLLECTING) return;

  if (data.suggestedBooks.length < 2) {
    bot.sendMessage(
      chatId,
      '⏳ Время вышло! Предложено недостаточно книг.\n' +
      `Получено книг: ${data.suggestedBooks.length}\n\n` +
      'Используйте /start для нового выбора.'
    );
    data.state = BOT_STATES.IDLE;
    return;
  }

  // Переходим к голосованию за книги
  data.state = BOT_STATES.BOOK_VOTING;
  
  bot.sendMessage(
    chatId,
    `📚 Выбираем книгу в жанре ${data.winnerGenre} из предложенных вариантов:`
  );

  // Создаем опрос
  bot.sendPoll(
    chatId,
    `Голосование за книгу в жанре ${data.winnerGenre}:`,
    data.suggestedBooks,
    { is_anonymous: false }
  ).then(() => {
    // Таймер завершения голосования (10 минут для теста)
    data.timers.bookVoting = setTimeout(() => finishBookVoting(chatId), 10 * 60 * 1000);
  });
}

// Завершение голосования за книгу
function finishBookVoting(chatId) {
  const data = chatData[chatId];
  if (!data || data.state !== BOT_STATES.BOOK_VOTING) return;

  // Подсчет голосов (исправлено)
  const voteCount = Array(data.suggestedBooks.length).fill(0);
  Object.values(data.bookVotes).forEach(userVote => {
    if (userVote !== undefined && userVote >= 0 && userVote < voteCount.length) {
      voteCount[userVote]++;
    }
  });

  // Определение победителя
  let winnerIndex = 0;
  let maxVotes = 0;
  voteCount.forEach((count, index) => {
    if (count > maxVotes) {
      maxVotes = count;
      winnerIndex = index;
    }
  });

  const winnerBook = data.suggestedBooks[winnerIndex];

  // Формируем результаты (с правильным склонением)
  const results = data.suggestedBooks.map((book, index) => {
    const votes = voteCount[index];
    const votesText = votes === 1 ? 'голос' : votes === 0 ? 'голосов' : 'голоса';
    return `${index + 1}. ${book} - ${votes} ${votesText}`;
  }).join('\n');

  // Отправляем результаты
  bot.sendMessage(
    chatId,
    `🏆 *Результаты голосования*:\n\n` +
    `Победила книга: *${winnerBook}*\n\n` +
    `Все варианты:\n${results}`,
    { parse_mode: 'Markdown' }
  );

  // Сбрасываем состояние
  data.state = BOT_STATES.IDLE;
  data.bookVotes = {}; // Очищаем голоса
}