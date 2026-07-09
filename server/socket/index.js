const jwt = require("jsonwebtoken");
const pool = require("../db");

module.exports = function setupSocket(io) {
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;

        if (!token) {
            return next(new Error("Токен не передан"));
        }

        try {
            const user = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = user;
            next();
        } catch {
            next(new Error("Недействительный токен"));
        }
    });
    io.on("connection", async function(socket) {
        console.log("Пользователь подключился:", socket.user.username || socket.user.login);

        const chats = await pool.query(
            "SELECT chat_id FROM chat_members WHERE user_id = $1",
            [socket.user.id]
        );

        chats.rows.forEach(chat => {
            socket.join("chat:" + chat.chat_id);
        });

        socket.on("send_message", async function(data) {
            const chatId = data.chatId;
            const text = data.text;

            if (!chatId || !text || text.trim() === "") {
                return;
            }

            const member = await pool.query(
                "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
                [chatId, socket.user.id]
            );
            if (!member.rows.length) {
                return socket.emit("error", { message: "Нет доступа" });
            }
            const result = await pool.query(
                `
                INSERT INTO messages (chat_id, sender_id, text)
                VALUES ($1, $2, $3)
                RETURNING id, chat_id, sender_id, text, created_at
                `,
                [chatId, socket.user.id, text.trim()]
            );
            const message = {
                ...result.rows[0],
                sender_name: socket.user.username || socket.user.login
            };
            io.to("chat:" + chatId).emit("new_message", message);
        });
        socket.on("disconnect", function() {
            console.log("Пользователь отключился");
        });
    });
};