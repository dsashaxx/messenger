const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/:id/messages', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;

  const member = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, req.user.id]
  );
  if (!member.rows.length) {
    return res.status(403).json({ error: 'Нет доступа к этому чату' });
  }

  try {
    let query, params;
    if (before) {
      query = `
        SELECT m.id, m.text, m.created_at,
               u.id AS sender_id, u.username AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1 AND m.id < $2
        ORDER BY m.created_at DESC LIMIT $3
      `;
      params = [chatId, before, limit];
    } else {
      query = `
        SELECT m.id, m.text, m.created_at,
               u.id AS sender_id, u.username AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1
        ORDER BY m.created_at DESC LIMIT $2
      `;
      params = [chatId, limit];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows.reverse());
  } catch (err) {
    console.error('Ошибка получения сообщений:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id/search', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const q = req.query.q || '';

  if (!q.trim()) {
    return res.status(400).json({ error: 'Параметр q обязателен' });
  }

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
    console.error('Ошибка поиска:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;