import mysql from "mysql2/promise";
import {DB_CONFIG_CONNECTION_PARAMS} from "./config";

// A *pool* is a set of reusable TCP connections to MySQL. You never open or
// close a connection per query: the pool lends one for the duration of a query
// and reclaims it automatically. Created once here at module load, shared by
// every route.
//
// createPool is lazy: it does not dial MySQL until the first query runs, so
// importing this file is safe even before the database exists.
export const pool = mysql.createPool({
  ...DB_CONFIG_CONNECTION_PARAMS,
  waitForConnections: true, // queue queries when all connections are busy
  connectionLimit: 10, // max simultaneous connections the pool will open
  multipleStatements: true, // needed to run schema.sql (several statements) in one call
});
