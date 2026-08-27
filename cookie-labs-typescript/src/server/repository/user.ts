import {pool} from "../config/db";
import {UserRow} from "../types/db";

async function findUserByUsernamePassword (username: string, password: string) {
    const [ userRows] = await pool.query<UserRow[]>(`select * from users where username= ? and password = ?`, [username, password]);
    return userRows
}

export default {
    findUserByUsernamePassword,
}