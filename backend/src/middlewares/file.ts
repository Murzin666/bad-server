import { Request } from 'express'
import multer, { FileFilterCallback, MulterError } from 'multer'
import { join, extname, resolve } from 'path'
import crypto from 'crypto'
import fs from 'fs'

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
    
    if (extension) {
        return `${timestamp}-${randomBytes}${extension}`
    }
    
    if (originalName.includes('.')) {
        const parts = originalName.split('.')
        if (parts.length > 1) {
            const lastPart = parts[parts.length - 1].toLowerCase()
            if (lastPart.length <= 5 && /^[a-z0-9]+$/.test(lastPart)) {
                return `${timestamp}-${randomBytes}.${lastPart}`
            }
        }
    }
    
    return `${timestamp}-${randomBytes}`
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

export const handleMulterError = (err: any, req: any, res: any, next: any) => {
    if (err instanceof MulterError) {
        // Обработка ошибок Multer
        let message = 'Ошибка загрузки файла'
        
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = 'Файл слишком большой. Максимальный размер: 5 МБ'
                break
            case 'LIMIT_FILE_COUNT':
                message = 'Слишком много файлов. Максимальное количество: 10'
                break
            case 'LIMIT_UNEXPECTED_FILE':
                message = 'Недопустимое поле для загрузки файла'
                break
            case 'LIMIT_PART_COUNT':
                message = 'Слишком много частей в форме'
                break
            case 'LIMIT_FIELD_KEY':
                message = 'Слишком длинное имя поля'
                break
            case 'LIMIT_FIELD_VALUE':
                message = 'Слишком длинное значение поля'
                break
            case 'LIMIT_FIELD_COUNT':
                message = 'Слишком много полей'
                break
        }
        
        return res.status(400).json({
            error: 'UploadError',
            message,
            code: err.code,
            field: err.field
        })
    } else if (err instanceof FileUploadError) {
        return res.status(400).json({
            error: 'FileUploadError',
            message: err.message,
            code: err.code,
            field: err.field
        })
    } else if (err) {
        console.error('File upload error:', err)
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
        fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        if (file.size < 2048) {
            return cb(new Error('Файл слишком маленький'))
        }
        cb(null, true)
    }
})

export const uploadSingle = (fieldName: string) => [
    upload.single(fieldName),
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
