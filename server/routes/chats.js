const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.type,
        CASE
          WHEN c.type = 'private' THEN (
            SELECT u.username FROM users u
            JOIN chat_members cm2 ON cm2.user_id = u.id
            WHERE cm2.chat_id = c.id AND u.id != $1
            LIMIT 1
          )
          WHEN c.type = 'saved' THEN 'Избранное'
          ELSE c.name
        END AS name,
        (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
      FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE cm.user_id = $1
      ORDER BY last_message_at DESC NULLS LAST
    `, [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения чатов:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/private', async (req, res) => {
  const { userId } = req.body;
  const myId = req.user.id;

  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (userId === myId) {
      // Ищем существующее Избранное
      const existing = await client.query(`
        SELECT c.id FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id
        WHERE c.type = 'saved' AND cm.user_id = $1
        LIMIT 1
      `, [myId]);

      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.json(existing.rows[0]);
      }

      const chatRes = await client.query(
        'INSERT INTO chats (type, name, created_by) VALUES ($1, $2, $3) RETURNING id',
        ['saved', 'Избранное', myId]
      );
      const chatId = chatRes.rows[0].id;
      await client.query(
        'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
        [chatId, myId, 'admin']
      );
      await client.query('COMMIT');
      return res.status(201).json({ id: chatId, type: 'saved' });
    }

    // Обычный личный чат
    const existing = await client.query(`
      SELECT c.id FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
      JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = $2
      WHERE c.type = 'private' LIMIT 1
    `, [myId, userId]);

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.json(existing.rows[0]);
    }

    const chatRes = await client.query(
      'INSERT INTO chats (type, created_by) VALUES ($1, $2) RETURNING id',
      ['private', myId]
    );
    const chatId = chatRes.rows[0].id;
    await client.query(
      'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $3)',
      [chatId, myId, 'member', userId]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: chatId, type: 'private' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ошибка создания чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

router.post('/group', async (req, res) => {
  const { name, memberIds = [] } = req.body;
  const myId = req.user.id;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Название группы обязательно' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chatRes = await client.query(
      'INSERT INTO chats (type, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      ['group', name.trim(), myId]
    );
    const chatId = chatRes.rows[0].id;
    await client.query(
      'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
      [chatId, myId, 'admin']
    );
    for (const uid of memberIds) {
      if (uid !== myId) {
        await client.query(
          'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
          [chatId, uid, 'member']
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ id: chatId, type: 'group', name });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

router.post('/:id/members', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const { userId } = req.body;
  const adminCheck = await pool.query(
    'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, req.user.id]
  );
  if (!adminCheck.rows[0] || adminCheck.rows[0].role !== 'admin') {
    return res.status(403).json({ error: 'Только администратор может добавлять участников' });
  }
  try {
    await pool.query(
      'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [chatId, userId, 'member']
    );
    res.json({ message: 'Участник добавлен' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id/members/:userId', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const targetUserId = parseInt(req.params.userId);
  const adminCheck = await pool.query(
    'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, req.user.id]
  );
  if (!adminCheck.rows[0] || adminCheck.rows[0].role !== 'admin') {
    return res.status(403).json({ error: 'Только администратор может удалять участников' });
  }
  try {
    await pool.query(
      'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, targetUserId]
    );
    res.json({ message: 'Участник удалён' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;