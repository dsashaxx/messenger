const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// пагинация
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

// поиск
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

// удаление смс( PS только автор может удалять)
router.delete('/:id/messages/:messageId', async (req, res) => {
  const chatId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const userId = Number(req.user.id);

  if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) {
    return res.status(400).json({
      error: 'Некорректный идентификатор'
    });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM messages
      WHERE id = $1
        AND chat_id = $2
        AND sender_id = $3
      RETURNING id
      `,
      [messageId, chatId, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'Сообщение не найдено или принадлежит другому пользователю'
      });
    }

    res.json({
      message: 'Сообщение удалено',
      messageId: result.rows[0].id
    });
  } catch (err) {
    console.error('Ошибка удаления сообщения:', err);

    res.status(500).json({
      error: 'Ошибка сервера'
    });
  }
});
module.exports = router;