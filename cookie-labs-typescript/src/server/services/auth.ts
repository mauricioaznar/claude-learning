import userRepository from "../repository/user";
import {signToken} from "../helpers/tokens";
import {ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS} from "../config/constants";
import {randomUUID} from "crypto";
import sessionRepository from "../repository/session";

export default {
    async login(username: string, password: string){
        const users = await userRepository.findUserByUsernamePassword(username, password)

        if (!users || users.length === 0) {
            return null;
        }

        const user = users[0];

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

        return { accessToken, absoluteExpireAt, sessionUuid }
    },

    async logout(sessionUuid: string) {
        await sessionRepository.deleteSession(sessionUuid)
    }
}