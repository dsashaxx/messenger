CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  avatar     TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
  id         SERIAL PRIMARY KEY,
  type VARCHAR(10) NOT NULL CHECK (type IN ('private', 'group', 'saved')),
  name       VARCHAR(100),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id    INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(10) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at  TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  chat_id    INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  sender_id  INTEGER REFERENCES users(id),
  text       TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);