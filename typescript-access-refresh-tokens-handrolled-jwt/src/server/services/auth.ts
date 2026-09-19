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
        const familyUuid = randomUUID();
        const now = Date.now();
        const absoluteExpireAt = now + REFRESH_TOKEN_TTL_MS;
        await sessionRepository.insertSession(sessionUuid, absoluteExpireAt, user.id, familyUuid)

        return { accessToken, sessionUuid, duration: REFRESH_TOKEN_TTL_MS }
    },

    async logout(sessionUuid: string) {
        await sessionRepository.revokeSession(sessionUuid, Date.now())
    },

    async refresh(sessionUuid: string) {
        const session = await sessionRepository.findSession(sessionUuid)
        if (!session) {
            return null
        }

        const user = await userRepository.findUserById(session.userId)
        if (!user) {
            return null
        }

        // session is active and has expired
        const now = Date.now();
        if (session.revokedAt === null && session.absoluteExpireAt < now) {
            await sessionRepository.revokeSession(sessionUuid, now);
            return null;
        }

        // session is not active and has already been revoked
        // TODO add grace period rotation
        if (session.revokedAt !== null) {
            await sessionRepository.revokeFamily(session.familyUuid, now)
            return null;
        }


        // session is active but not expired
        const deadline = Math.min(ACCESS_TOKEN_TTL_MS + now, session.absoluteExpireAt)
        const accessToken = signToken({
            username: user.username,
            displayName: user.displayName,
            userId: user.id,
            expireAt: deadline,
        })

        await sessionRepository.revokeSession(session.sessionUuid, now)
        const newSessionUuid = randomUUID();
        await sessionRepository.insertSession(newSessionUuid, session.absoluteExpireAt, session.userId, session.familyUuid)

        return {
            accessToken,
            sessionDuration: session.absoluteExpireAt - now,
            sessionUuid: newSessionUuid,
        }
    }
}