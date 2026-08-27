import express from "express";
import {clearCookie, getCookie, setCookie} from "../helpers/cookies";
import authService from '../services/auth'

const authRouter = express.Router();

authRouter.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Bad request, invalid shape" });
    }

    const loginResponse = await authService.login(username, password)
    if(!loginResponse) return res.status(401).json({ error: "Unauthorized" });

    const { accessToken, sessionUuid, absoluteExpireAt } = loginResponse

    setCookie(res, sessionUuid, absoluteExpireAt)
    return res.status(200).json({
        accessToken,
    })
})

authRouter.post('/logout', async (req, res) => {
    const cookie = getCookie(req)
    if (!cookie) {
        return res.sendStatus(204);
    }
    await authService.logout(cookie)
    clearCookie(res)
    return res.sendStatus(204)
})

export default authRouter;