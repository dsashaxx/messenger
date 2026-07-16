const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

//список чатов
router.get("/", async function(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT
        c.id,
        c.type,

        CASE
          WHEN c.type = 'private' THEN (
            SELECT u.username
            FROM users u
            JOIN chat_members cm2
              ON cm2.user_id = u.id
            WHERE cm2.chat_id = c.id
              AND u.id != $1
            LIMIT 1
          )
          WHEN c.type = 'saved' THEN 'Избранное'
          ELSE c.name
        END AS name,

        CASE
          WHEN c.type = 'private' THEN (
            SELECT u.avatar
            FROM users u
            JOIN chat_members cm2
              ON cm2.user_id = u.id
            WHERE cm2.chat_id = c.id
              AND u.id != $1
            LIMIT 1
          )
          ELSE NULL
        END AS avatar,

        (
          SELECT text
          FROM messages
          WHERE chat_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_message,

        (
          SELECT created_at
          FROM messages
          WHERE chat_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_message_at

      FROM chats c

      JOIN chat_members cm
        ON cm.chat_id = c.id

      WHERE cm.user_id = $1

      ORDER BY last_message_at DESC NULLS LAST
      `,
      [req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Ошибка получения чатов:", error);

    res.status(500).json({
      error: "Ошибка сервера"
    });
  }
});

//создание чата
router.post('/private', async (req, res) => {
  const userId = Number(req.body.userId);
  const myId   = Number(req.user.id);

  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (!userCheck.rows.length) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (userId === myId) {
      const existing = await client.query(`
        SELECT c.id FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id
        WHERE c.type = 'saved' AND cm.user_id = $1 LIMIT 1
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
    const existing = await client.query(`
      SELECT c.id FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
      JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = $2
      WHERE c.type = 'private' LIMIT 1
    `, [myId, userId]);

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
    
      const chat = {
        id: existing.rows[0].id,
        type: 'private'
      };
    
      const io = req.app.get('io');
    
      if (io) {
        io.to(`user:${myId}`).emit('chat_created', chat);
        io.to(`user:${userId}`).emit('chat_created', chat);
      }
    
      return res.json(chat);
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

const chat = {
  id: chatId,
  type: 'private'
};

const io = req.app.get('io');

if (io) {
  io.to(`user:${myId}`).emit('chat_created', chat);
  io.to(`user:${userId}`).emit('chat_created', chat);
}

res.status(201).json(chat);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ошибка создания чата:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

//создание группы
router.post("/group", async function(req, res) {
  const name = req.body.name;
  const memberIds = req.body.memberIds || [];
  const myId = Number(req.user.id);

  if (!name || !name.trim()) {
    return res.status(400).json({
      error: "Название группы обязательно"
    });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const chatResult = await client.query(
      `
      INSERT INTO chats (type, name, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, type, name
      `,
      ["group", name.trim(), myId]
    );

    const chat = chatResult.rows[0];
    await client.query(
      `
      INSERT INTO chat_members (chat_id, user_id, role)
      VALUES ($1, $2, $3)
      `,
      [chat.id, myId, "admin"]
    );
    for (let userId of memberIds) {
      const memberId = Number(userId);
      if (memberId !== myId) {
        await client.query(
          `
          INSERT INTO chat_members (chat_id, user_id, role)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
          `,
          [chat.id, memberId, "member"]
        );
      }
    }

    await client.query("COMMIT");
    const io = req.app.get("io");
    if (io) {
      const allMemberIds = [
        myId,
        ...memberIds.map(Number)
      ];
      const uniqueMemberIds = [
        ...new Set(allMemberIds)
      ];
      for (let userId of uniqueMemberIds) {
        io
          .to("user:" + userId)
          .emit("group_created", {
            id: chat.id,
            type: chat.type,
            name: chat.name
          });
      }
    }
    res.status(201).json(chat);
  } catch (error) {
    await client.query("ROLLBACK").catch(function() {});

    console.error("Ошибка создания группы:", error);

    res.status(500).json({
      error: "Ошибка создания группы"
    });

  } finally {
    client.release();
  }
});

//список юзеров
router.get('/:id/members', async (req, res) => {
  const chatId = parseInt(req.params.id);
  const member = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, req.user.id]
  );
  if (!member.rows.length) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.avatar, cm.role
      FROM chat_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = $1
      ORDER BY cm.role DESC, u.username
    `, [chatId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
//добавление юзера
// Добавление пользователя в существующую группу
router.post('/:id/members', async (req, res) => {
  const chatId = Number(req.params.id);
  const userId = Number(req.body.userId);
  const currentUserId = Number(req.user.id);

  if (!Number.isInteger(chatId) || !Number.isInteger(userId)) {
    return res.status(400).json({
      error: 'Некорректный идентификатор'
    });
  }

  try {
    // Проверяем, что действие выполняет администратор группы
    const adminCheck = await pool.query(
      `
      SELECT role
      FROM chat_members
      WHERE chat_id = $1
        AND user_id = $2
      `,
      [chatId, currentUserId]
    );

    if (
      !adminCheck.rows.length ||
      adminCheck.rows[0].role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Только администратор может добавлять участников'
      });
    }

    // Получаем информацию о группе
    const chatResult = await pool.query(
      `
      SELECT id, type, name
      FROM chats
      WHERE id = $1
        AND type = 'group'
      `,
      [chatId]
    );

    if (!chatResult.rows.length) {
      return res.status(404).json({
        error: 'Группа не найдена'
      });
    }

    const chat = chatResult.rows[0];

    // Добавляем пользователя в группу
    const insertResult = await pool.query(
      `
      INSERT INTO chat_members (chat_id, user_id, role)
      VALUES ($1, $2, 'member')
      ON CONFLICT (chat_id, user_id) DO NOTHING
      RETURNING chat_id, user_id
      `,
      [chatId, userId]
    );

    if (!insertResult.rows.length) {
      return res.status(409).json({
        error: 'Пользователь уже состоит в группе'
      });
    }

    const io = req.app.get('io');

    if (io) {
      // Подключаем все открытые вкладки пользователя
      // к Socket.IO-комнате этой группы
      io.in(`user:${userId}`).socketsJoin(`chat:${chatId}`);

      // Сообщаем пользователю, что ему стала доступна новая группа
      io.to(`user:${userId}`).emit('group_created', {
        id: chat.id,
        type: chat.type,
        name: chat.name
      });
    }

    res.status(201).json({
      message: 'Участник добавлен'
    });

  } catch (err) {
    console.error('Ошибка добавления участника:', err);

    res.status(500).json({
      error: 'Ошибка сервера'
    });
  }
});

//удаление 
// Удаление пользователя из группы
router.delete('/:id/members/:userId', async (req, res) => {
  const chatId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  const currentUserId = Number(req.user.id);

  if (!Number.isInteger(chatId) || !Number.isInteger(targetUserId)) {
    return res.status(400).json({
      error: 'Некорректный идентификатор'
    });
  }

  try {
    const adminCheck = await pool.query(
      `
      SELECT role
      FROM chat_members
      WHERE chat_id = $1
        AND user_id = $2
      `,
      [chatId, currentUserId]
    );

    if (
      !adminCheck.rows.length ||
      adminCheck.rows[0].role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Только администратор может удалять участников'
      });
    }

    if (targetUserId === currentUserId) {
      return res.status(400).json({
        error: 'Администратор не может удалить самого себя'
      });
    }

    const result = await pool.query(
      `
      DELETE FROM chat_members
      WHERE chat_id = $1
        AND user_id = $2
      RETURNING user_id
      `,
      [chatId, targetUserId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'Пользователь не состоит в группе'
      });
    }

    const io = req.app.get('io');

    if (io) {
      io.in(`user:${targetUserId}`)
        .socketsLeave(`chat:${chatId}`);
      io.to(`user:${targetUserId}`).emit('removed_from_group', {
        chatId
      });
    }

    res.json({
      message: 'Участник удалён'
    });

  } catch (error) {
    console.error('Ошибка удаления участника:', error);

    res.status(500).json({
      error: 'Ошибка сервера'
    });
  }
});

//удаление чата
router.delete("/:id", async function(req, res) {
  const chatId = Number(req.params.id);
  const currentUserId = Number(req.user.id);

  try {
    const accessResult = await pool.query(
      `
      SELECT c.type, cm.role
      FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE c.id = $1
        AND cm.user_id = $2
      `,
      [chatId, currentUserId]
    );

    if (!accessResult.rows.length) {
      return res.status(403).json({
        error: "Нет доступа к этому чату"
      });
    }

    const chat = accessResult.rows[0];
    if (
      chat.type === "group" &&
      chat.role !== "admin"
    ) {
      return res.status(403).json({
        error: "Группу может удалить только администратор"
      });
    }
    const membersResult = await pool.query(
      `
      SELECT user_id
      FROM chat_members
      WHERE chat_id = $1
      `,
      [chatId]
    );

    const memberIds = membersResult.rows.map(function(row) {
      return Number(row.user_id);
    });
    await pool.query(
      `
      DELETE FROM chats
      WHERE id = $1
      `,
      [chatId]
    );
    const io = req.app.get("io");
    if (io) {
      for (let userId of memberIds) {
        io
          .to("user:" + userId)
          .emit("chat_deleted", {
            chatId: chatId
          });
      }
    }
    res.json({
      message: "Чат удалён"
    });
  } catch (error) {
    console.error("Ошибка удаления чата:", error);

    res.status(500).json({
      error: "Ошибка сервера"
    });
  }
});

module.exports = router;