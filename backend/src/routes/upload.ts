import { Router } from 'express'
import { uploadFile } from '../controllers/upload'
import { uploadSingle } from '../middlewares/file'

const uploadRouter = Router()
uploadRouter.post('/', uploadSingle('file'), uploadFile)

export default uploadRouter
