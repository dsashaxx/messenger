require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');

const authRoutes     = require('./routes/auth');
const chatsRoutes    = require('./routes/chats');
const messagesRoutes = require('./routes/messages');
const usersRoutes    = require('./routes/users');
const setupSocket    = require('./socket');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' }
});
app.set("io", io);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({

  limit: "3mb"

}));
app.use(express.static(path.join(__dirname, '..', 'client')));

app.use('/auth',  authRoutes);
app.use('/chats', chatsRoutes);
app.use('/chats', messagesRoutes);
app.use('/users', usersRoutes);

setupSocket(io);

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});