import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import BadRequestError from '../errors/bad-request-error'

export const uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!req.file) {
        return next(new BadRequestError('Файл не загружен или имеет неверный формат'))
    }
    if (req.file.size < 2048) {
        return next(new BadRequestError('Файл слишком маленький'))
    }
       
    try {
        const filePath = process.env.UPLOAD_PATH
            ? `/${process.env.UPLOAD_PATH}/${req.file.filename}`
            : `/${req.file?.filename}`
            
        return res.status(constants.HTTP_STATUS_CREATED).send({
            fileName: filePath,
            originalName: req.file?.originalname,
        })
    } catch (error: unknown) {
        return next(error)
    }
}

export default {}
