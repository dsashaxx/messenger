const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

router.use(auth);
router.post("/group", async function(req, res) {
    const name = req.body.name;
    const memberIds = req.body.memberIds || [];
    const myId = req.user.id;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Название группы обязательно" }); }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const chatResult = await client.query(`
            INSERT INTO chats (type, name, created_by)
            VALUES ($1, $2, $3)
            RETURNING id, type, name`,["group", name.trim(), myId]
        );
        const chat = chatResult.rows[0];
        await client.query( ` INSERT INTO chat_members (chat_id, user_id, role)
            VALUES ($1, $2, $3)`,[chat.id, myId, "admin"]
        );
        for (let userId of memberIds) {
            if (Number(userId) !== Number(myId)) {
                await client.query( `
                    INSERT INTO chat_members (chat_id, user_id, role)
                    VALUES ($1, $2, $3)
                    ON CONFLICT DO NOTHING`,[chat.id, userId, "member"]);} }
        await client.query("COMMIT");
        res.status(201).json(chat);
    } catch (error) {
        await client.query("ROLLBACK");
        console.log(error);
        res.status(500).json({ error: "Ошибка создания группы" });
    } finally {
        client.release();
    }
});
router.get("/:id/members", async function(req, res) {
    const chatId = parseInt(req.params.id);
    try {const member = await pool.query(
            "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",[chatId, req.user.id]
        );
        if (!member.rows.length) {
            return res.status(403).json({ error: "Нет доступа" });
        }
        const result = await pool.query( `
            SELECT u.id,u.username,cm.role
            FROM chat_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.chat_id = $1
            ORDER BY u.username`,[chatId]);
        res.json(result.rows);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Ошибка получения участников" });
    }
});
router.post("/:id/members", async function(req, res) {
    const chatId = parseInt(req.params.id);
    const userId = req.body.userId;
    const myId = req.user.id;

    try {const admin = await pool.query(
            `SELECT role 
            FROM chat_members 
            WHERE chat_id = $1 AND user_id = $2`,[chatId, myId]
        );
        if (!admin.rows[0] || admin.rows[0].role !== "admin") {
            return res.status(403).json({ error: "Только администратор" });
        }
        await pool.query(`
            INSERT INTO chat_members (chat_id, user_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING`,[chatId, userId, "member"]
        );
        res.json({ message: "Участник добавлен" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Ошибка добавления участника" });
    }
});
router.delete("/:id/members/:userId", async function(req, res) {
    const chatId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    const myId = req.user.id;
    try {const admin = await pool.query(
            `
            SELECT role 
            FROM chat_members 
            WHERE chat_id = $1 AND user_id = $2
            `,[chatId, myId]
        );

        if (!admin.rows[0] || admin.rows[0].role !== "admin") {
            return res.status(403).json({ error: "Только администратор" });
        }
        if (targetUserId === myId) {
            return res.status(400).json({ error: "Нельзя удалить самого себя" });
        }
        await pool.query(
            `
            DELETE FROM chat_members
            WHERE chat_id = $1 AND user_id = $2
            `,
            [chatId, targetUserId]
        );
        res.json({ message: "Участник удалён" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Ошибка удаления участника" });
    }
});
module.exports = router;