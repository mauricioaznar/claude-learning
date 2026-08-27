// Exercise 0 — Express under TypeScript. This file is yours to write.
//
// Goal for this file right now: a minimal Express app that
//   1. reads and runs schema.sql on boot (import { pool } from "./db"),
//   2. serves the SPA out of ../../public (index.html, styles.css, app.js),
//   3. has one health route (e.g. GET /api/health -> { ok: true }),
//   4. listens on a port and logs the URL.
//
// The token routes (/api/login, /api/me, /api/logout, /api/refresh) come in
// Phase 1 and 2 — leave them out for now.
//
// See cookie-labs-typescript/CLAUDE.md → "Exercise 0" for the TypeScript-specific
// setup notes (what @types give you, how req/res get typed, the dev loop).
import express from 'express';
import path from 'path'
import {readFile} from "fs/promises";
import { pool } from './config/db'
import authRouter  from "./routes/auth";

const PORT = process.env.PORT || 3000;
const SCHEMA_PATH = path.join(import.meta.dirname ,'../../', 'schema.sql');
const PUBLIC_PATH = path.join(import.meta.dirname, '../../','public');


export const app = express();

app.use(express.json());
app.use(express.static(PUBLIC_PATH));

app.get('/health', (req: express.Request, res: express.Response) => {
    return res.status(200).send({
        ok: true,
    })
})

app.use('/api/auth', authRouter);
const temporaryResourcesRouter = express.Router();
app.use('/api/resources', temporaryResourcesRouter);

app.use('/api', (req, res) => {
    return res.status(404).send({
        error: 'Not Found',
    })
})

app.get('/*splat', (_, res) => {
    return res.sendFile(PUBLIC_PATH + '/index.html');
})

const server = app.listen(PORT, async () => {
    console.log('App listening on port localhost::', PORT);

    try {
        const schemaFile = await readFile(SCHEMA_PATH, 'utf8');
        await pool.query(schemaFile, [])
    } catch (
        error
        ) {
        console.error(error);
    }
})

async function cleanup() {
    server.close(async () => {
        await pool.end()
    })
}

server.on('SIGINT', cleanup)

server.on('SIGTERM', cleanup)