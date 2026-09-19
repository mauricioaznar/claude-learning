import {pool} from "../config/db";
import {ResultSetHeader} from "mysql2";
import {SessionRow} from "../types/db";

async function insertSession(sessionUuid: string, absoluteExpireAt: number, userId: number, familyUuid: string): Promise<boolean> {
    const [resultsHeader] = await pool.query<ResultSetHeader>(`insert into sessions (sessionUuid, absoluteExpireAt, userId, familyUuid) values(?, ?, ?, ?)`, [sessionUuid, absoluteExpireAt, userId, familyUuid]);

    return resultsHeader.affectedRows > 0;
}

async function revokeSession(sessionUuid: string, revokedAt: number): Promise<boolean> {
    const [ resultHeader ] = await pool.query<ResultSetHeader>(`update sessions set revokedAt = ? where sessionUuid = ?`, [revokedAt, sessionUuid]);
    return resultHeader.affectedRows >  0;
}

async function revokeFamily(familyUuid: string, revokedAt: number): Promise<boolean> {
    const [ resultHeader ] = await pool.query<ResultSetHeader>(`update sessions set revokedAt = ? where familyUuid = ? and revokedAt is null`, [revokedAt, familyUuid]);
    return resultHeader.affectedRows >  0;
}

async function findSession(sessionUuid: string): Promise<SessionRow | null> {
    const [sessionRows] = await pool.query<SessionRow[]>(`select * from sessions where sessionUuid = ?`, [sessionUuid])
    if (sessionRows.length === 0) {
        return null
    }
    return sessionRows[0]
}

export default {
    insertSession,
    revokeSession,
    revokeFamily,
    findSession
}