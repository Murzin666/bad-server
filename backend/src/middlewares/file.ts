import { Request, Response } from 'express'
import multer, { FileFilterCallback, MulterError } from 'multer'
import { join, extname, resolve } from 'path'
import crypto from 'crypto'
import fs from 'fs'
import { fileTypeFromBuffer } from 'file-type'

type DestinationCallback = (error: Error | null, destination: string) => void
type FileNameCallback = (error: Error | null, filename: string) => void

const ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpg',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'image/webp',
    'image/bmp',
    'image/tiff'
] as const

type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number]

const ensureDirectoryExists = (dirPath: string): void => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
    }
}

const generateSafeFilename = (originalName: string): string => {
    const randomBytes = crypto.randomBytes(16).toString('hex')
    const timestamp = Date.now()
    const extension = extname(originalName).toLowerCase()
    
    return `${timestamp}-${randomBytes}${extension || '.bin'}`
}

class FileUploadError extends Error {
    constructor(
        message: string,
        public code?: string,
        public field?: string
    ) {
        super(message)
        this.name = 'FileUploadError'
    }
}

const storage = multer.diskStorage({
    destination: (
        _req: Request,
        _file: Express.Multer.File,
        cb: DestinationCallback
    ) => {
        try {
            const uploadPath = process.env.UPLOAD_PATH_TEMP
                ? join('public', process.env.UPLOAD_PATH_TEMP)
                : join('public', 'uploads', 'temp')
            
            const absolutePath = resolve(process.cwd(), uploadPath)
            
            ensureDirectoryExists(absolutePath)
            
            cb(null, absolutePath)
        } catch (error) {
            const uploadError = new FileUploadError(
                'Не удалось создать директорию для загрузки файлов',
                'DIRECTORY_ERROR'
            )
            cb(uploadError, '')
        }
    },

    filename: (
        _req: Request,
        file: Express.Multer.File,
        cb: FileNameCallback
    ) => {
        try {
            const safeFilename = generateSafeFilename(file.originalname)
            cb(null, safeFilename)
        } catch (error) {
            const uploadError = new FileUploadError(
                'Не удалось сгенерировать имя файла',
                'FILENAME_ERROR'
            )
            cb(uploadError, '')
        }
    },
})

const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
) => {
    try {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype as AllowedMimeType)) {
            const error = new FileUploadError(
                `Недопустимый тип файла. Разрешенные типы: ${ALLOWED_MIME_TYPES.join(', ')}`,
                'INVALID_FILE_TYPE'
            )
            return cb(error)
        }

        const extension = extname(file.originalname).toLowerCase()
        const suspiciousExtensions = ['.exe', '.bat', '.sh', '.php', '.js', '.html', '.htaccess']
        
        if (suspiciousExtensions.includes(extension)) {
            const error = new FileUploadError(
                'Файлы с таким расширением не разрешены',
                'SUSPICIOUS_EXTENSION'
            )
            return cb(error)
        }

        if (!file.originalname || file.originalname.trim().length === 0) {
            const error = new FileUploadError(
                'Имя файла не может быть пустым',
                'EMPTY_FILENAME'
            )
            return cb(error)
        }

        cb(null, true)
    } catch (error) {
        const uploadError = new FileUploadError(
            'Ошибка при проверке файла',
            'FILTER_ERROR'
        )
        cb(uploadError)
    }
}

export const validateFileMetadata = async (file: Express.Multer.File): Promise<void> => {
    try {
        // Проверка размера
        if (file.size < 2048) {
            throw new FileUploadError('Файл слишком маленький (минимум 2KB)', 'FILE_TOO_SMALL');
        }
        
        if (file.size > 10 * 1024 * 1024) {
            throw new FileUploadError('Файл слишком большой (максимум 10MB)', 'FILE_TOO_LARGE');
        }
        
        // Проверка магических чисел
        const buffer = file.buffer;
        
        // PNG
        const isPNG = buffer.length >= 8 && 
            buffer[0] === 0x89 && buffer[1] === 0x50 && 
            buffer[2] === 0x4E && buffer[3] === 0x47;
        
        // JPEG
        const isJPEG = buffer.length >= 3 && 
            buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        
        // GIF
        const isGIF = buffer.length >= 6 &&
            buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 &&
            buffer[3] === 0x38 && (buffer[4] === 0x37 || buffer[4] === 0x39);
        
        if (!isPNG && !isJPEG && !isGIF) {
            throw new FileUploadError('Файл не является изображением (PNG, JPEG, GIF)', 'NOT_AN_IMAGE');
        }
        
    } catch (error) {
        if (error instanceof FileUploadError) {
            throw error;
        }
        throw new FileUploadError('Ошибка проверки файла', 'VALIDATION_ERROR');
    }
};

export const handleMulterError = (err: any, req: any, res: Response, next: any) => {
    if (err instanceof MulterError) {
        let message = 'Ошибка загрузки файла'
        
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = 'Файл слишком большой. Максимальный размер: 10 МБ'
                break
            case 'LIMIT_FILE_COUNT':
                message = 'Слишком много файлов. Максимальное количество: 1'
                break
            case 'LIMIT_UNEXPECTED_FILE':
                message = 'Недопустимое поле для загрузки файла'
                break
        }
        
        return res.status(400).json({
            error: 'UploadError',
            message,
            code: err.code,
            field: err.field
        })
    } else if (err instanceof FileUploadError) {
        // ИСПРАВЛЕНО
        return res.status(400).json({
            error: 'FileUploadError',
            message: err.message,
            code: err.code,
            field: err.field
        })
    } else if (err) {
        console.error('File upload error:', err)
        // ИСПРАВЛЕНО
        return res.status(500).json({
            error: 'ServerError',
            message: 'Произошла ошибка при загрузке файла'
        })
    }
    
    next()
}

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
    },
    fileFilter
})

export const fileMetadataMiddleware = async (req: Request, res: Response, next: Function) => {
    try {
        if (!req.file) {
            return next();
        }

        await validateFileMetadata(req.file);
        next();
    } catch (error) {
        if (error instanceof FileUploadError) {
            // ИСПРАВЛЕНО
            return res.status(400).json({
                error: error.name,
                message: error.message,
                code: error.code
            });
        }
        next(error);
    }
};

export const uploadSingle = (fieldName: string) => [
    upload.single(fieldName),
    fileMetadataMiddleware,
    handleMulterError
]

export const uploadArray = (fieldName: string, maxCount?: number) => [
    upload.array(fieldName, maxCount || 10),
    handleMulterError
]

export const uploadFields = (fields: multer.Field[]) => [
    upload.fields(fields),
    handleMulterError
]

export const uploadAny = () => [
    upload.any(),
    handleMulterError
]

export default upload
