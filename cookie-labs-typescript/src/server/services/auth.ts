import userRepository from "../repository/user";
import {signToken} from "../helpers/tokens";
import {ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS} from "../config/constants";
import {randomUUID} from "crypto";
import sessionRepository from "../repository/session";

export default {
    async login(username: string, password: string){
        const user = await userRepository.findUserByUsernamePassword(username, password)

        if (!user) {
            return null;
        }

        const accessToken = signToken({
            username: user.username,
            displayName: user.displayName,
            userId: user.id,
            expireAt: Date.now() + ACCESS_TOKEN_TTL_MS,
        });


        const sessionUuid = randomUUID();
        const now = Date.now();
        const absoluteExpireAt = now + REFRESH_TOKEN_TTL_MS;
        await sessionRepository.insertSession(sessionUuid, absoluteExpireAt, user.id)

        return { accessToken, sessionUuid, duration: REFRESH_TOKEN_TTL_MS }
    },

    async logout(sessionUuid: string) {
        await sessionRepository.deleteSession(sessionUuid, Date.now())
    },

    async refresh(sessionUuid: string) {
        const session = await sessionRepository.findSession(sessionUuid)
        if (!session) {
            return null
        }
        const now = Date.now();
        if (session.absoluteExpireAt < now) {
            await sessionRepository.deleteSession(sessionUuid, now);
            return null;
        }

        const user = await userRepository.findUserById(session.userId)
        if (!user) {
            return null
        }
        const deadline = Math.min(ACCESS_TOKEN_TTL_MS + now, session.absoluteExpireAt)
        const accessToken = signToken({
            username: user.username,
            displayName: user.displayName,
            userId: user.id,
            expireAt: deadline,
        })

        return {
            accessToken,
            duration: deadline - now,
        }
    }
}