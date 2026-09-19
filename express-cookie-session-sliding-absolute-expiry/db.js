import mysql from "mysql2/promise";

// A *pool* is a set of reusable TCP connections to MySQL. You never open or
// close a connection per query: the pool lends one for the duration of a query
// and reclaims it automatically. Created once here at module load, shared by
// every route — the same lifetime SESSION_MAP had.
//
// createPool is lazy: it does not dial MySQL until the first query runs, so
// importing this file is safe even before the database exists.
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true, // queue queries when all connections are busy
  connectionLimit: 10, // max simultaneous connections the pool will open
  multipleStatements: true // allow to run multiple statemetns on the query function
});
