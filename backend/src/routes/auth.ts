import { Router } from 'express'
import {
    getCurrentUser,
    getCurrentUserRoles,
    login,
    logout,
    refreshAccessToken,
    register,
    updateCurrentUser,
} from '../controllers/auth'
import auth from '../middlewares/auth'
import rateLimit from 'express-rate-limit'
import { validateAuthentication, validateUserBody } from '../middlewares/validations'

const authRouter = Router()

const authorizationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Превышен лимит попыток входа, попробуйте позднее.',
  standardHeaders: true,
  legacyHeaders: false,
})

authRouter.get('/user', auth, getCurrentUser)
authRouter.patch('/me', auth, updateCurrentUser)
authRouter.get('/user/roles', auth, getCurrentUserRoles)
authRouter.post('/login', authorizationLimiter, validateAuthentication, login)
authRouter.get('/token', refreshAccessToken)
authRouter.get('/logout', logout)
authRouter.post('/register', authorizationLimiter, validateUserBody, register)

export default authRouter
