import express from "express";
import {pool} from "../config/db";
import {UserRow} from "../types/db";
import {signToken} from "../helpers/tokens";
import {ACCESS_TOKEN_TTL_MS} from "../config/constants";

const authRouter = express.Router();

authRouter.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Bad request, invalid shape" });
    }

    const [ userRows] = await pool.query<UserRow[]>(`select * from users where username= ? and password = ?`, [username, password]);

    if (!userRows || userRows.length === 0) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = userRows[0];

    const accessToken = signToken({
        username: user.username,
        displayName: user.displayName,
        userId: user.id,
        expireAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    });


    return res.status(200).json({
        accessToken,
    })
})

authRouter.get('/logout', async (req, res) => {
    return res.sendStatus(204)
})

export default authRouter;