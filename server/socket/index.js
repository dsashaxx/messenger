const jwt  = require('jsonwebtoken');
const pool = require('../db');

module.exports = function setupSocket(io) {

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Токен не передан'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch {
      next(new Error('Недействительный токен'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`🔌 Подключился: ${socket.user.username}`);

    try {
      const { rows } = await pool.query(
        'SELECT chat_id FROM chat_members WHERE user_id = $1',
        [socket.user.id]
      );
      rows.forEach(row => socket.join(`chat:${row.chat_id}`));
    } catch (err) {
      console.error('Ошибка подписки на чаты:', err);
    }

    socket.on('send_message', async ({ chatId, text }) => {
      if (!chatId || !text || !text.trim()) return;

      try {
        const memberCheck = await pool.query(
          'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [chatId, socket.user.id]
        );
        if (!memberCheck.rows.length) {
          return socket.emit('error', { message: 'Нет доступа' });
        }

        const result = await pool.query(`
          INSERT INTO messages (chat_id, sender_id, text)
          VALUES ($1, $2, $3)
          RETURNING id, text, created_at
        `, [chatId, socket.user.id, text.trim()]);

        const message = {
          ...result.rows[0],
          sender_id:   socket.user.id,
          sender_name: socket.user.username,
          chat_id:     chatId,
        };

        io.to(`chat:${chatId}`).emit('new_message', message);

      } catch (err) {
        console.error('Ошибка отправки сообщения:', err);
        socket.emit('error', { message: 'Ошибка при отправке' });
      }
    });

    socket.on('join_chat', (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Отключился: ${socket.user.username}`);
    });
  });
};