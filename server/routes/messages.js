const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// GET /chats/:id/messages — история с пагинацией
router.get('/:id/messages', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;

  if (!chatId) return res.status(400).json({ error: 'Некорректный id чата' });

  const member = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, req.user.id]
  );
  if (!member.rows.length) {
    return res.status(403).json({ error: 'Нет доступа к этому чату' });
  }

  try {
    let result;
    if (before) {
      result = await pool.query(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.created_at, m.is_read,
               u.username AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1 AND m.id < $2
        ORDER BY m.id DESC LIMIT $3
      `, [chatId, before, limit]);
    } else {
      result = await pool.query(`
        SELECT m.id, m.chat_id, m.sender_id, m.text, m.created_at, m.is_read,
               u.username AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1
        ORDER BY m.id DESC LIMIT $2
      `, [chatId, limit]);
    }

    // Отмечаем чужие сообщения как прочитанные
    await pool.query(`
      UPDATE messages
      SET is_read = TRUE
      WHERE chat_id = $1 AND sender_id != $2 AND is_read = FALSE
    `, [chatId, req.user.id]);

    res.json(result.rows.reverse());
  } catch (err) {
    console.error('Ошибка получения сообщений:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /chats/:id/search — поиск
router.get('/:id/search', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const q = req.query.q || '';

  if (!chatId) return res.status(400).json({ error: 'Некорректный id чата' });
  if (!q.trim()) return res.status(400).json({ error: 'Введите текст поиска' });

  const member = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, req.user.id]
  );
  if (!member.rows.length) {
    return res.status(403).json({ error: 'Нет доступа к этому чату' });
  }

  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.text, m.created_at, u.username AS sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1 AND m.text ILIKE $2
      ORDER BY m.created_at DESC LIMIT 50
    `, [chatId, `%${q}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /chats/:id/messages/:messageId — удалить сообщение
router.delete('/:id/messages/:messageId', async (req, res) => {
  const chatId    = parseInt(req.params.id);
  const messageId = parseInt(req.params.messageId);

  try {
    const check = await pool.query(
      'SELECT sender_id FROM messages WHERE id = $1 AND chat_id = $2',
      [messageId, chatId]
    );
    if (!check.rows.length) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }
    if (check.rows[0].sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
    }
    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
    res.json({ message: 'Сообщение удалено' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;