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
    
    console.log(`Пользователь подключился: ${socket.user.username}`);
    socket.join("user:" + socket.user.id);
    try {
      const { rows } = await pool.query(
        'SELECT chat_id FROM chat_members WHERE user_id = $1',
        [socket.user.id]
      );
      rows.forEach(row => socket.join(`chat:${row.chat_id}`));
    } catch (err) {
      console.error('Ошибка подписки на чаты:', err);
    }

    socket.on('join_chat', async (chatId) => {
      try {
        const member = await pool.query(
          'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [chatId, socket.user.id]
        );
        if (!member.rows.length) {
          return socket.emit('error', { message: 'Нет доступа к этому чату' });
        }
        socket.join(`chat:${chatId}`);
      } catch (err) {
        socket.emit('error', { message: 'Ошибка входа в чат' });
      }
    });

    socket.on('send_message', async ({ chatId, text }) => {
      if (!chatId || !text || !text.trim()) return;
      try {
        const member = await pool.query(
          'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [chatId, socket.user.id]
        );
        if (!member.rows.length) {
          return socket.emit('error', { message: 'Нет доступа' });
        }
        const result = await pool.query(`
          INSERT INTO messages (chat_id, sender_id, text, is_read)
          VALUES ($1, $2, $3, FALSE)
          RETURNING id, text, created_at, is_read
        `, [chatId, socket.user.id, text.trim()]);

        const message = {
          ...result.rows[0],
          sender_id:   socket.user.id,
          sender_name: socket.user.username,
          chat_id:     chatId,
        };
        io.to(`chat:${chatId}`).emit('new_message', message);
      } catch (err) {
        console.error('Ошибка отправки:', err);
        socket.emit('error', { message: 'Ошибка при отправке' });
      }
    });

    // уведомление о прочтении
    socket.on('read_messages', async ({ chatId }) => {
      try {
        const unread = await pool.query(`
          SELECT DISTINCT sender_id FROM messages
          WHERE chat_id = $1 AND sender_id != $2 AND is_read = FALSE
        `, [chatId, socket.user.id]);
        await pool.query(`
          UPDATE messages SET is_read = TRUE
          WHERE chat_id = $1 AND sender_id != $2 AND is_read = FALSE
        `, [chatId, socket.user.id]);
        unread.rows.forEach(row => {
          io.to(`user:${row.sender_id}`).emit('messages_read', { chatId });
        });
      } catch (err) {
        console.error('Ошибка отметки прочтения:', err);
      }
    });
    socket.join(`user:${socket.user.id}`);

    // печатает
    socket.on('typing', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing', {
        username: socket.user.username,
        chatId,
      });
    });

    socket.on('stop_typing', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('stop_typing', {
        username: socket.user.username,
        chatId,
      });
    });

    socket.on('disconnect', () => {
      console.log(`Пользователь отключился: ${socket.user.username}`);
    });
  });
};