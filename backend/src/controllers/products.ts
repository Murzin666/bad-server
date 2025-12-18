import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import { Error as MongooseError } from 'mongoose'
import { join, normalize } from 'path'
import BadRequestError from '../errors/bad-request-error'
import ConflictError from '../errors/conflict-error'
import NotFoundError from '../errors/not-found-error'
import Product, { IProduct } from '../models/product'
import movingFile from '../utils/movingFile'
import { isMongooseDuplicateKeyError } from '../utils/error-helpers'

// GET /product
const getProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { page = '1', limit = '5' } = req.query as { [key: string]: string }
        
        const pageNum = Math.max(1, parseInt(page, 10) || 1)

        const requestedLimit = parseInt(limit, 10) || 5
        const limitNum = Math.min(requestedLimit, 10)

        const options = {
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }
        const products = await Product.find({}, null, options)
        const totalProducts = await Product.countDocuments({})
        const totalPages = Math.ceil(totalProducts / limitNum)
        
        return res.send({
            items: products,
            pagination: {
                totalProducts,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (err: unknown) {
        return next(err)
    }
}

// POST /product
const createProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { description, category, price, title, image } = req.body

        // Переносим картинку из временной папки
        if (image) {
            const safeFileName = normalize(image.fileName).replace(
                /^(\.\.(\/|\\|$))+/,
                ''
            )
            if (image.fileName !== safeFileName) {
                return next(new BadRequestError('Некорректное имя файла.'))
            }

            movingFile(
                safeFileName,
                join(__dirname, `../public/${process.env.UPLOAD_PATH_TEMP}`),
                join(__dirname, `../public/${process.env.UPLOAD_PATH}`)
            )
        }

        const product = await Product.create({
            description,
            image,
            category,
            price,
            title,
        })
        return res.status(constants.HTTP_STATUS_CREATED).send(product)
    } catch (error: unknown) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (isMongooseDuplicateKeyError(error)) {
            return next(
                new ConflictError('Товар с таким заголовком уже существует')
            )
        }
        return next(error)
    }
}

// TODO: Добавить guard admin
// PUT /product
const updateProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = req.params
        const { image } = req.body

        // Переносим картинку из временной папки
        if (image) {
            const safeFileName = normalize(image.fileName).replace(
                /^(\.\.(\/|\\|$))+/,
                ''
            )
            if (image.fileName !== safeFileName) {
                return next(new BadRequestError('Некорректное имя файла.'))
            }

            movingFile(
                safeFileName,
                join(__dirname, `../public/${process.env.UPLOAD_PATH_TEMP}`),
                join(__dirname, `../public/${process.env.UPLOAD_PATH}`)
            )
        }

        const { title, description, category, price } = req.body
        const updateData: Partial<IProduct> = {}
        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (category !== undefined) updateData.category = category
        if (price !== undefined) updateData.price = price
        if (image) updateData.image = image

        const product = await Product.findByIdAndUpdate(
            productId,
            {
                $set: updateData,
            },
            { runValidators: true, new: true }
        ).orFail(() => new NotFoundError('Нет товара по заданному id'))
        return res.send(product)
    } catch (error: unknown) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }       
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID товара'))
        }
        if (isMongooseDuplicateKeyError(error)) {
            return next(
                new ConflictError('Товар с таким заголовком уже существует')
            )
        }
        return next(error)
    }
}

// TODO: Добавить guard admin
// DELETE /product
const deleteProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { productId } = req.params
        const product = await Product.findByIdAndDelete(productId).orFail(
            () => new NotFoundError('Нет товара по заданному id')
        ) 
        return res.send(product)
    } catch (error: unknown) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID товара'))
        }
        return next(error)
    }
}

export { createProduct, deleteProduct, getProducts, updateProduct }
