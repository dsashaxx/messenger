const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const router = express.Router();

router.use(auth);
router.get("/:id/messages", async function(req, res) {
    const chatId = parseInt(req.params.id);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const before = req.query.before ? parseInt(req.query.before) : null;
    const member = await pool.query(
        "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
        [chatId, req.user.id]
    );
    if (!member.rows.length) {
        return res.status(403).json({ error: "Нет доступа" });
    }
    try {let result;
        if (before) {
            result = await pool.query(
                `
                SELECT m.id,m.chat_id,m.sender_id,m.text, m.created_at,u.username AS sender_name
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.chat_id = $1 AND m.id < $2
                ORDER BY m.id DESC
                LIMIT $3`,[chatId, before, limit]
            );
        } else {
            result = await pool.query(`
                SELECT  m.id, m.chat_id, m.sender_id,m.text,m.created_at,u.username AS sender_name
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.chat_id = $1
                ORDER BY m.id DESC
                LIMIT $2
                `,
                [chatId, limit]
            );
        }

        res.json(result.rows.reverse());

    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});
router.get("/:id/search", async function(req, res) {
    const chatId = parseInt(req.params.id);
    const q = req.query.q || "";

    if (!q.trim()) {
        return res.status(400).json({ error: "Введите текст поиска" });
    }

    const member = await pool.query(
        "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
        [chatId, req.user.id]
    );

    if (!member.rows.length) {
        return res.status(403).json({ error: "Нет доступа" });
    }
    try {
        const result = await pool.query(`
            SELECT m.id,m.chat_id,m.sender_id,m.text,m.created_at,u.username AS sender_name
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.chat_id = $1 AND m.text ILIKE $2
            ORDER BY m.created_at DESC
            LIMIT 50
            `,
            [chatId, "%" + q + "%"]);
        res.json(result.rows);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Ошибка сервера" });}
});

//удаление смс P.S. удалять может только пользователь,написавший его
router.delete("/:id/messages/:messageId", async function(req, res) {
    const chatId = parseInt(req.params.id);
    const messageId = parseInt(req.params.messageId);
    const userId = req.user.id;
  
    try {
      const message = await pool.query(
        `
        SELECT id
        FROM messages
        WHERE id = $1
          AND chat_id = $2
          AND sender_id = $3
        `,
        [messageId, chatId, userId]
      );
  
      if (!message.rows.length) {
        return res.status(403).json({
          error: "Можно удалить только своё сообщение"
        });
      }
  
      await pool.query(
        "DELETE FROM messages WHERE id = $1",
        [messageId]
      );
  
      res.json({
        message: "Сообщение удалено"
      });
  
    } catch (error) {
      console.error("Ошибка удаления сообщения:", error);
  
      res.status(500).json({
        error: "Ошибка сервера"
      });
    }
  });
module.exports = router;