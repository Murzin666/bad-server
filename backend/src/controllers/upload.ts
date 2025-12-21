import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import BadRequestError from '../errors/bad-request-error'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export const uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.file) {
            return next(new BadRequestError('Файл не загружен или имеет неверный формат'))
        }
        
        // УБЕРИТЕ проверку размера здесь - она уже в middleware!
        // if (req.file.size < 2048) {
        //     return next(new BadRequestError('Файл слишком маленький'))
        // }

        const originalName = req.file.originalname
        const uploadedFileName = req.file.filename
        
        // Для отладки
        console.log('DEBUG UPLOAD:');
        console.log('  Original name:', originalName);
        console.log('  Uploaded filename:', uploadedFileName);
        console.log('  File size:', req.file.size);
        console.log('  File path:', req.file.path);
        
        // Проверяем, что имя файла безопасное
        // Просто используем то, что сгенерировал multer
        // Он уже должен генерировать безопасное имя
        
        const filePath = process.env.UPLOAD_PATH
            ? `/${process.env.UPLOAD_PATH}/${uploadedFileName}`
            : `/${uploadedFileName}`
            
        return res.status(constants.HTTP_STATUS_CREATED).send({
            fileName: filePath,
            originalName: originalName,
        })
    } catch (error: unknown) {
        console.error('Upload error:', error)
        return next(error)
    }
}

export default {}
