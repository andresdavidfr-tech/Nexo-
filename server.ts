import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";
import Database from "better-sqlite3";

dotenv.config();

const db_sqlite = new Database("educonnect.db");

// Initialize Database
db_sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    avatar TEXT,
    role TEXT,
    tokens INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    userId TEXT,
    amount INTEGER,
    type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Mock Session (In a real app, use express-session or JWT)
  let currentUser: any = null;

  // Google OAuth Configuration
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/google/callback`
  );

  // Auth Routes
  app.post("/api/auth/signup", (req, res) => {
    const { email, password, name } = req.body;
    try {
      const id = Math.random().toString(36).substr(2, 9);
      const stmt = db_sqlite.prepare("INSERT INTO users (id, email, password, name, avatar, role) VALUES (?, ?, ?, ?, ?, ?)");
      stmt.run(id, email, password, name, name.substring(0, 2).toUpperCase(), "Usuario");
      currentUser = { id, email, name, tokens: 0, role: "Usuario", avatar: name.substring(0, 2).toUpperCase() };
      res.json(currentUser);
    } catch (error) {
      res.status(400).json({ error: "El email ya está registrado" });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = db_sqlite.prepare("SELECT * FROM users WHERE email = ? AND password = ?").get(email, password) as any;
    if (user) {
      currentUser = user;
      res.json(user);
    } else {
      res.status(401).json({ error: "Credenciales inválidas" });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    res.json(currentUser);
  });

  app.post("/api/auth/logout", (req, res) => {
    currentUser = null;
    res.json({ success: true });
  });

  // Token Routes
  app.post("/api/tokens/buy", (req, res) => {
    if (!currentUser) return res.status(401).json({ error: "No autenticado" });
    const { amount } = req.body;
    
    db_sqlite.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ?").run(amount, currentUser.id);
    const transactionId = Math.random().toString(36).substr(2, 9);
    db_sqlite.prepare("INSERT INTO transactions (id, userId, amount, type) VALUES (?, ?, ?, ?)").run(transactionId, currentUser.id, amount, "compra");
    
    currentUser = db_sqlite.prepare("SELECT * FROM users WHERE id = ?").get(currentUser.id);
    res.json(currentUser);
  });

  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      prompt: "consent",
    });
    res.json({ url });
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      let user = db_sqlite.prepare("SELECT * FROM users WHERE email = ?").get(data.email) as any;
      if (!user) {
        const id = Math.random().toString(36).substr(2, 9);
        db_sqlite.prepare("INSERT INTO users (id, email, name, avatar, role) VALUES (?, ?, ?, ?, ?)")
          .run(id, data.email, data.name, data.name?.substring(0, 2).toUpperCase(), "Usuario");
        user = db_sqlite.prepare("SELECT * FROM users WHERE id = ?").get(id);
      }
      currentUser = user;

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user: ${JSON.stringify(user)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).send("Error de autenticación");
    }
  });

  // Mock API for Calendar Events
  app.get("/api/calendar/events", (req, res) => {
    res.json([
      {
        id: "1",
        title: "Reunión de Padres - Jardín",
        start: new Date(new Date().setHours(10, 0)).toISOString(),
        end: new Date(new Date().setHours(11, 0)).toISOString(),
        description: "Discusión sobre el próximo evento escolar.",
        type: "meeting",
        meetLink: "https://meet.google.com/abc-defg-hij"
      },
      {
        id: "2",
        title: "Entrega de Notas - Primaria",
        start: new Date(new Date().setDate(new Date().getDate() + 1)).toISOString(),
        end: new Date(new Date().setDate(new Date().getDate() + 1)).toISOString(),
        description: "Revisión de desempeño académico del primer trimestre.",
        type: "academic",
      }
    ]);
  });

  // Mock Data for Messaging
  const mockUsers = [
    { id: "u1", name: "María García", role: "Madre (4to A)", avatar: "MG" },
    { id: "u2", name: "Juan Pérez", role: "Director", avatar: "JP" },
    { id: "u3", name: "Lucía Fernández", role: "Docente Inglés", avatar: "LF" },
    { id: "u4", name: "Carlos Ruiz", role: "Padre (5to B)", avatar: "CR" },
  ];

  let mockMessages = [
    { id: "m1", conversationId: "c1", senderId: "u1", text: "Hola Andrés, ¿podrías confirmarme la fecha del examen?", timestamp: new Date(Date.now() - 3600000).toISOString() },
    { id: "m2", conversationId: "c1", senderId: "me", text: "Hola María, es el próximo jueves a las 9:00.", timestamp: new Date(Date.now() - 1800000).toISOString() },
  ];

  app.get("/api/users", (req, res) => {
    res.json(mockUsers);
  });

  app.get("/api/conversations", (req, res) => {
    // Simplified: each mock user is a conversation
    const conversations = mockUsers.map(user => {
      const lastMessage = mockMessages.filter(m => m.conversationId === `c-${user.id}`).pop() || 
                         (user.id === "u1" ? mockMessages[1] : null);
      return {
        id: user.id === "u1" ? "c1" : `c-${user.id}`,
        user,
        lastMessage: lastMessage?.text || "Inicia una conversación",
        timestamp: lastMessage?.timestamp || new Date().toISOString()
      };
    });
    res.json(conversations);
  });

  app.get("/api/messages/:conversationId", (req, res) => {
    const { conversationId } = req.params;
    const messages = mockMessages.filter(m => m.conversationId === conversationId);
    res.json(messages);
  });

  app.post("/api/messages", (req, res) => {
    const { conversationId, text } = req.body;
    const newMessage = {
      id: `m${mockMessages.length + 1}`,
      conversationId,
      senderId: "me",
      text,
      timestamp: new Date().toISOString()
    };
    mockMessages.push(newMessage);
    res.json(newMessage);
  });

  // Mock Data for Authorizations
  let mockAuthorizations = [
    { id: "a1", studentName: "Mateo García", parentName: "María García", authorizedPerson: "Roberto García (Abuelo)", date: new Date().toISOString(), status: "Aprobado" },
  ];

  app.get("/api/authorizations", (req, res) => {
    res.json(mockAuthorizations);
  });

  app.post("/api/authorizations", (req, res) => {
    const newAuth = {
      id: `a${mockAuthorizations.length + 1}`,
      ...req.body,
      date: new Date().toISOString(),
      status: "Pendiente"
    };
    mockAuthorizations.push(newAuth);
    res.json(newAuth);
  });

  app.get("/api/config/whatsapp", (req, res) => {
    res.json({ number: "5491123456789", message: "Hola! Necesito hacer una consulta sobre EduConnect." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
