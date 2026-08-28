import {COOKIE_NAME, COOKIE_PATH} from "../config/constants";
import {CookieOptions, Response, Request} from 'express'

export function setCookie(res: Response, sessionUuid: string, duration: number): void {
    res.cookie(COOKIE_NAME, sessionUuid, getCookiesOptions(duration));
}

export function clearCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {path: COOKIE_PATH, signed: true});
}

export function getCookie(req: Request): string | null {
    const cookie = req.signedCookies[COOKIE_NAME]
    return cookie ?? null;
}

function getCookiesOptions(duration: number): CookieOptions {
    return {
        maxAge: duration,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        path: COOKIE_PATH,
    }
}