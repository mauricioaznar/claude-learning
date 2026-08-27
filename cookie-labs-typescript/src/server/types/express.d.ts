import {AccessTokenPayload} from "./db";

declare global  {
    namespace Express {
        interface Request {
            user?: AccessTokenPayload;
        }
    }
}