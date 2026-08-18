import "dotenv/config";
import mysql from "mysql2/promise";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[init-db] DATABASE_URL not set — skipping table creation");
    return;
  }
  console.log("[init-db] connecting to", url.replace(/:\/\/[^@]+@/, "://***@"));
  const conn = await mysql.createConnection(url);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        openId VARCHAR(64) NOT NULL UNIQUE,
        name TEXT NULL,
        email VARCHAR(320) NULL,
        loginMethod VARCHAR(64) NULL,
        role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS dashboardUsers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        passwordHash VARCHAR(255) NOT NULL,
        role ENUM('admin', 'operator') NOT NULL DEFAULT 'operator',
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignedIn TIMESTAMP NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        entry_price DOUBLE NOT NULL,
        exit_price DOUBLE NOT NULL,
        quantity DOUBLE NOT NULL,
        virtual_usdt DOUBLE NOT NULL,
        pnl_usdt DOUBLE NOT NULL,
        pnl_pct DOUBLE NOT NULL,
        exit_reason VARCHAR(10) NOT NULL,
        opened_at BIGINT NOT NULL,
        closed_at BIGINT NOT NULL,
        duration_ms BIGINT NOT NULL,
        stop_loss_pct DOUBLE NOT NULL DEFAULT 0,
        take_profit_pct DOUBLE NOT NULL DEFAULT 0,
        momentum_trigger_pct DOUBLE NOT NULL DEFAULT 0,
        momentum_window_secs INT NOT NULL DEFAULT 0,
        volume_surge_multiplier DOUBLE NOT NULL DEFAULT 0,
        UNIQUE KEY uk_paper_trade (symbol, opened_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("[init-db] tables ready");
  } finally {
    await conn.end();
  }
}

async function startServer() {
  console.log("[server] starting, NODE_ENV=" + process.env.NODE_ENV + " PORT=" + process.env.PORT);
  try {
    await initDb();
  } catch (err) {
    console.error("[init-db] failed:", err);
    // Continue booting — the server can still serve the UI even without DB
  }
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
