import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "aura-secret-key-2026";
let db: any;
try {
  db = new Database(":memory:");
  console.log("Using in-memory database.");
} catch (err) {
  console.error("Failed to initialize database:", err);
}

// Initialize Database
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      membership TEXT DEFAULT 'free',
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT,
      messages TEXT,
      updated_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      system_instruction TEXT,
      selected_model TEXT,
      theme TEXT,
      auto_save INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  console.log("Tables created successfully.");
} catch (err) {
  console.error("Failed to create tables:", err);
}

async function startServer() {
  console.log("startServer function called.");
  const app = express();
  const PORT = 3000;

  // Security Headers
  /*
  app.use(helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https://picsum.photos", "https://*.googleusercontent.com"],
        "connect-src": ["'self'", "https://generativelanguage.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      },
    },
  }));
  */

  // Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 login/signup attempts per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts, please try again in an hour." }
  });

  app.use("/api/", limiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/signup", authLimiter);

  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.aura_token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // Auth Routes
  app.post("/api/auth/signup", async (req, res) => {
    const { email, password } = req.body;
    
    // Basic Input Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = randomUUID();
      
      const insert = db.prepare("INSERT INTO users (id, email, password, created_at) VALUES (?, ?, ?, ?)");
      insert.run(userId, email, hashedPassword, Date.now());

      const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: "7d" });
      res.cookie("aura_token", token, { httpOnly: true, secure: true, sameSite: "none", maxAge: 7 * 24 * 60 * 60 * 1000 });
      
      res.json({ user: { id: userId, email, membership: "free" } });
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "Email already exists" });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("aura_token", token, { httpOnly: true, secure: true, sameSite: "none", maxAge: 7 * 24 * 60 * 60 * 1000 });
    
    res.json({ user: { id: user.id, email: user.email, membership: user.membership } });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("aura_token");
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const token = req.cookies.aura_token;
    if (!token) return res.json({ user: null });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const user = db.prepare("SELECT id, email, membership FROM users WHERE id = ?").get(decoded.id) as any;
      res.json({ user });
    } catch (err) {
      res.json({ user: null });
    }
  });

  // Session Routes
  app.get("/api/sessions", authenticate, (req: any, res) => {
    const sessions = db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC").all(req.user.id) as any[];
    res.json(sessions.map(s => ({
      ...s,
      messages: JSON.parse(s.messages)
    })));
  });

  app.post("/api/sessions", authenticate, (req: any, res) => {
    const { id, title, messages, updatedAt } = req.body;
    const upsert = db.prepare(`
      INSERT INTO sessions (id, user_id, title, messages, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        messages = excluded.messages,
        updated_at = excluded.updated_at
    `);
    upsert.run(id, req.user.id, title, JSON.stringify(messages), updatedAt);
    res.json({ success: true });
  });

  app.delete("/api/sessions/:id", authenticate, (req: any, res) => {
    db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ success: true });
  });

  app.delete("/api/sessions", authenticate, (req: any, res) => {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.user.id);
    res.json({ success: true });
  });

  // Settings Routes
  app.get("/api/settings", authenticate, (req: any, res) => {
    const settings = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id) as any;
    res.json(settings || {});
  });

  app.post("/api/settings", authenticate, (req: any, res) => {
    const { system_instruction, selected_model, theme, auto_save } = req.body;
    const upsert = db.prepare(`
      INSERT INTO settings (user_id, system_instruction, selected_model, theme, auto_save)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        system_instruction = excluded.system_instruction,
        selected_model = excluded.selected_model,
        theme = excluded.theme,
        auto_save = excluded.auto_save
    `);
    upsert.run(req.user.id, system_instruction, selected_model, theme, auto_save ? 1 : 0);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
