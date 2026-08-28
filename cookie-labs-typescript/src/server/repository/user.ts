import {pool} from "../config/db";
import {UserRow} from "../types/db";

async function findUserByUsernamePassword (username: string, password: string) {
    const [ userRows] = await pool.query<UserRow[]>(`select * from users where username= ? and password = ?`, [username, password]);
    return userRows.length > 0 ? userRows[0] : null;
}

async function findUserById (userId: number) {
    const [ userRows] = await pool.query<UserRow[]>(`select * from users where id = ?`, [userId]);
    return userRows.length > 0 ? userRows[0] : null;
}

export default {
    findUserByUsernamePassword,
    findUserById
}