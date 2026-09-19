import {NextFunction, Request, Response} from "express";
import {verifyToken} from "../helpers/tokens";

export function authMiddleware (req: Request, res: Response, next: NextFunction ) {
    const authorizationHeader = req.headers['authorization'];
    if (!authorizationHeader) return res.status(401).send({
        error: 'Unauthorized',
    })

    const accessToken = authorizationHeader.replace('Bearer ', '')

    const payload = verifyToken(accessToken)

    if (!payload) return res.status(401).send({
        error: 'Unauthorized',
    })

    req.user = payload

    next()
}