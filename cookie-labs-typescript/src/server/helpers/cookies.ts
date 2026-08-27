import {COOKIE_NAME} from "../config/constants";
import {CookieOptions, Response, Request} from 'express'

export function setCookie(res: Response, sessionUuid: string, duration: number): void {
    res.cookie(COOKIE_NAME, sessionUuid, getCookiesOptions(duration));
}

export function clearCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME);
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
    }
}