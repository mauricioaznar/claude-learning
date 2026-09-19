import { Router } from "express";

const router = Router();

router.get('/', (req, res) => {
    const  { displayName, userId , username} = req.user!
    // blacklist { expireAt, ...safe } = req.user
    return res.status(200).send({
        displayName,
        userId,
        username
    })
})

export default router;

