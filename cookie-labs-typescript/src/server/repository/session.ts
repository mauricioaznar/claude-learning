import {pool} from "../config/db";
import {ResultSetHeader} from "mysql2";
import {SessionRow} from "../types/db";

async function insertSession(sessionUuid: string, absoluteExpireAt: number, userId: number): Promise<boolean> {
    const [resultsHeader] = await pool.query<ResultSetHeader>(`insert into sessions (sessionUuid, absoluteExpireAt, userId) values(?, ?, ?)`, [sessionUuid, absoluteExpireAt, userId]);

    return resultsHeader.affectedRows > 0;
}

async function deleteSession(sessionUuid: string, revokedAt: number): Promise<boolean> {
    const [ resultHeader ] = await pool.query<ResultSetHeader>(`update sessions set revokedAt = ? where sessionUuid = ?`, [revokedAt, sessionUuid]);
    return resultHeader.affectedRows >  0;
}

async function findSession(sessionUuid: string): Promise<SessionRow | null> {
    const [sessionRows] = await pool.query<SessionRow[]>(`select * from sessions where sessionUuid = ? and revokedAt is null`, [sessionUuid])
    if (sessionRows.length === 0) {
        return null
    }
    return sessionRows[0]
}

export default {
    insertSession,
    deleteSession,
    findSession
}