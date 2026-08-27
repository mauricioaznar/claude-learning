import {pool} from "../config/db";
import {ResultSetHeader} from "mysql2";

async function insertSession(sessionUuid: string, absoluteExpireAt: number, userId: number): Promise<boolean> {
    const [resultsHeader] = await pool.query<ResultSetHeader>(`insert into sessions (sessionUuid, absoluteExpireAt, userId) values(?, ?, ?)`, [sessionUuid, absoluteExpireAt, userId]);

    return resultsHeader.affectedRows > 0;
}

async function deleteSession(sessionUuid: string): Promise<boolean> {
    const [ resultHeader ] = await pool.query<ResultSetHeader>(`delete from sessions where sessionUuid = ?`, [sessionUuid]);
    return resultHeader.affectedRows >  0;
}

export default {
    insertSession,
    deleteSession
}