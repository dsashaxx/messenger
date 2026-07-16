const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();
router.use(auth);

router.get("/", async function(req, res) {
    try {
        const result = await pool.query(
            `
            SELECT id, username
            FROM users
            WHERE id != $1
            ORDER BY username
            `,
            [req.user.id]
        );

        res.json(result.rows);

    } catch (error) {
        console.error("Ошибка получения пользователей:", error);

        res.status(500).json({
            error: "Ошибка сервера"
        });
    }
});
//удаление акка
router.delete("/me", async function(req, res) {
    const userId = Number(req.user.id);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(
            "DELETE FROM messages WHERE sender_id = $1",
            [userId]
        );
        await client.query(
            "DELETE FROM chat_members WHERE user_id = $1",
            [userId]
        );
        await client.query(
            `
            DELETE FROM chats
            WHERE NOT EXISTS (
                SELECT 1
                FROM chat_members
                WHERE chat_members.chat_id = chats.id
            )
            `
        );
        await client.query(
            `
            UPDATE chats
            SET created_by = NULL
            WHERE created_by = $1
            `,
            [userId]
        );

        await client.query(
            "DELETE FROM users WHERE id = $1",
            [userId]
        );

        await client.query("COMMIT");

        res.json({
            message: "Аккаунт удалён"
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Ошибка удаления аккаунта:", error);

        res.status(500).json({
            error: "Ошибка удаления аккаунта"
        });

    } finally {
        client.release();
    }
});
// смена авы
router.put('/me/avatar', async (req, res) => {
    const userId = Number(req.user.id);
    const avatar = req.body.avatar;
  
    if (!avatar) {
      return res.status(400).json({
        error: 'Изображение не передано'
      });
    }
  
    try {
      const result = await pool.query(
        `
        UPDATE users
        SET avatar = $1
        WHERE id = $2
        RETURNING id, username, avatar
        `,
        [avatar, userId]
      );
  
      const updatedUser = result.rows[0];
  
      const io = req.app.get('io');
  
      if (io) {
        io.emit('avatar_updated', {
          userId: updatedUser.id,
          username: updatedUser.username,
          avatar: updatedUser.avatar
        });
      }
  
      res.json({
        message: 'Аватар сохранён',
        avatar: updatedUser.avatar
      });
  
    } catch (error) {
      console.error('Ошибка сохранения аватара:', error);
  
      res.status(500).json({
        error: 'Ошибка сервера'
      });
    }
  });
  module.exports = router;