import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (!pool) {
    pool = mysql.createPool({ uri: url, waitForConnections: true, connectionLimit: 5 });
  }
  return pool;
}
