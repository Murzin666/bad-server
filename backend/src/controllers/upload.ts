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
        
        if (req.file.size < 2048) {
            return next(new BadRequestError('Файл слишком маленький'))
        }

        const originalName = req.file.originalname
        const uploadedFileName = req.file.filename
        
        let finalFileName = uploadedFileName
        const fileExtension = path.extname(originalName).toLowerCase()
        
        if (originalName === uploadedFileName || 
            path.basename(uploadedFileName, fileExtension) === path.basename(originalName, fileExtension)) {
            const timestamp = Date.now()
            const randomBytes = crypto.randomBytes(8).toString('hex')
            finalFileName = `${timestamp}-${randomBytes}${fileExtension}`
            
            const tempDir = process.env.UPLOAD_PATH_TEMP
                ? path.join('public', process.env.UPLOAD_PATH_TEMP)
                : path.join('public', 'uploads', 'temp')
            
            const oldPath = path.join(process.cwd(), tempDir, uploadedFileName)
            const newPath = path.join(process.cwd(), tempDir, finalFileName)
            
            if (fs.existsSync(oldPath)) {
                fs.renameSync(oldPath, newPath)
            }
        }
       
        const filePath = process.env.UPLOAD_PATH
            ? `/${process.env.UPLOAD_PATH}/${finalFileName}`
            : `/${finalFileName}`
            
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
