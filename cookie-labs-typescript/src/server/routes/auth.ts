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

    const { accessToken, sessionUuid, duration } = loginResponse

    setCookie(res, sessionUuid, duration)
    return res.status(200).json({
        accessToken,
    })
})

authRouter.post('/session/logout', async (req, res) => {
    const cookie = getCookie(req);
    if (!cookie) {
        return res.sendStatus(204);
    }
    await authService.logout(cookie)
    clearCookie(res)
    return res.sendStatus(204)
})

authRouter.post('/session/refresh', async (req, res) => {
    const cookie = getCookie(req);
    if (!cookie) {
        clearCookie(res)
        return res.status(401).json({error: "Unauthorized"});
    }
    const refreshResult = await authService.refresh(cookie)

    if (!refreshResult){
        clearCookie(res)
        return res.status(401).json({error: "Unauthorized"});
    }

    const { accessToken, sessionUuid, sessionDuration} = refreshResult
    setCookie(res, sessionUuid, sessionDuration)
    return res.status(200).json({
        accessToken,
    })

})

export default authRouter;