import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { Error as MongooseError } from 'mongoose'
import { REFRESH_TOKEN } from '../config'
import BadRequestError from '../errors/bad-request-error'
import ConflictError from '../errors/conflict-error'
import NotFoundError from '../errors/not-found-error'
import UnauthorizedError from '../errors/unauthorized-error'
import User from '../models/user'
import { isMongooseDuplicateKeyError } from '../utils/error-helpers'

// POST /auth/login
const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = req.body
        const user = await User.findUserByCredentials(email, password)
        const accessToken = user.generateAccessToken()
        const refreshToken = await user.generateRefreshToken()
        res.cookie(
            REFRESH_TOKEN.cookie.name,
            refreshToken,
            {
                ...REFRESH_TOKEN.cookie.options,
                sameSite: 'strict' as const
            }
        )        
        return res.json({
            success: true,
            user,
            accessToken,
        })
    } catch (err: unknown) {
        return next(err)
    }
}

// POST /auth/register
const register = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password, name } = req.body
        const newUser = new User({ email, password, name })
        await newUser.save()
        const accessToken = newUser.generateAccessToken()
        const refreshToken = await newUser.generateRefreshToken()

        res.cookie(
            REFRESH_TOKEN.cookie.name,
            refreshToken,
            {
                ...REFRESH_TOKEN.cookie.options,
                sameSite: 'strict' as const
            }
        ) 
        return res.status(constants.HTTP_STATUS_CREATED).json({
            success: true,
            user: newUser,
            accessToken,
        })
    } catch (error: unknown) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (isMongooseDuplicateKeyError(error)) {
            return next(
                new ConflictError('Пользователь с таким email уже существует')
            )
        }    
        return next(error)
    }
}

// GET /auth/user
const getCurrentUser = async (
    _req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        const user = await User.findById(userId).orFail(
            () =>
                new NotFoundError(
                    'Пользователь по заданному id отсутствует в базе'
                )
        )
        res.json({ user, success: true })
    } catch (error: unknown) {
        next(error)
    }
}

// GET  /auth/logout
const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { cookies } = req
        const rfTkn = cookies[REFRESH_TOKEN.cookie.name]

        if (rfTkn) {
            try {
                const decoded = jwt.verify(rfTkn, REFRESH_TOKEN.secret) as JwtPayload
                
                const rTknHash = crypto
                    .createHmac('sha256', REFRESH_TOKEN.secret)
                    .update(rfTkn)
                    .digest('hex')

                await User.findByIdAndUpdate(
                    decoded._id || decoded.sub,
                    { $pull: { tokens: { token: rTknHash } } },
                    { new: true }
                )
            } catch (jwtError) {
                console.warn('Invalid JWT during logout:', jwtError)
            }
        }

        res.clearCookie(REFRESH_TOKEN.cookie.name, {
            ...REFRESH_TOKEN.cookie.options,
            maxAge: -1,
        })
        
        return res.status(200).json({
            success: true,
            message: 'Выход выполнен'
        })
    } catch (error: unknown) {
        res.clearCookie(REFRESH_TOKEN.cookie.name, {
            ...REFRESH_TOKEN.cookie.options,
            maxAge: -1,
        })
        next(error)
    }
}

// GET  /auth/token
const refreshAccessToken = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { cookies } = req
        const rfTkn = cookies[REFRESH_TOKEN.cookie.name]

        if (!rfTkn) {
            throw new UnauthorizedError('Refresh токен отсутствует')
        }
        const decoded = jwt.verify(rfTkn, REFRESH_TOKEN.secret) as JwtPayload
        const userId = decoded._id || decoded.sub
        const user = await User.findById(userId).orFail(
            () => new UnauthorizedError('Пользователь не найден в базе')
        )

        const rTknHash = crypto
            .createHmac('sha256', REFRESH_TOKEN.secret)
            .update(rfTkn)
            .digest('hex')
        
        const tokenExists = user.tokens.some(
            (tokenObj) => tokenObj.token === rTknHash
        )
        
        if (!tokenExists) {
            throw new UnauthorizedError('Токен отозван или недействителен')
        }

        await User.findByIdAndUpdate(
            userId,
            { $pull: { tokens: { token: rTknHash } } },
            { new: true }
        )

        const accessToken = user.generateAccessToken()
        const newRefreshToken = await user.generateRefreshToken()

        res.cookie(
            REFRESH_TOKEN.cookie.name,
            newRefreshToken,
            {
                ...REFRESH_TOKEN.cookie.options,
                sameSite: 'strict' as const
            }
        )
        return res.json({
            success: true,
            user,
            accessToken,
        })
    } catch (error: unknown) {
        res.clearCookie(REFRESH_TOKEN.cookie.name, {
            ...REFRESH_TOKEN.cookie.options,
            maxAge: -1,
        })
        
        return next(
            new UnauthorizedError('Ошибка авторизации, пожалуйста, войдите снова')
        )
    }
}

const getCurrentUserRoles = async (
    _req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        const user = await User.findById(userId).orFail(
            () =>
                new NotFoundError(
                    'Пользователь по заданному id отсутствует в базе'
                )
        )
        res.status(200).json(user.roles)
    } catch (error: unknown) {
        next(error)
    }
}

const updateCurrentUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        
        const { name, email } = req.body
        const updateData = { name, email }
        
        const updatedUser = await User.findByIdAndUpdate(
            userId, 
            updateData, 
            {
                new: true,
                runValidators: true
            }
        ).orFail(
            () =>
                new NotFoundError(
                    'Пользователь по заданному id отсутствует в базе'
                )
        )
        res.status(200).json(updatedUser)
    } catch (error: unknown) {
        if (isMongooseDuplicateKeyError(error)) {
            return next(
                new ConflictError('Пользователь с таким email уже существует')
            )
        }
        
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        
        next(error)
    }
}

export {
    getCurrentUser,
    getCurrentUserRoles,
    login,
    logout,
    refreshAccessToken,
    register,
    updateCurrentUser,
}
