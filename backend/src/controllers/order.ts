import { NextFunction, Request, Response } from 'express'
import { FilterQuery, Error as MongooseError, Types, PipelineStage } from 'mongoose'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import Order, { IOrder, StatusType } from '../models/order'
import Product, { IProduct } from '../models/product'
import escapeRegExp from '../utils/escapeRegExp'
import sanitizeHtml from 'sanitize-html'

// eslint-disable-next-line max-len
// GET /orders?page=2&limit=5&sort=totalAmount&order=desc&orderDateFrom=2024-07-01&orderDateTo=2024-08-01&status=delivering&totalAmountFrom=100&totalAmountTo=1000&search=%2B1

export const getOrders = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const {
            page = '1',
            limit = '10',
            sortField = 'createdAt',
            sortOrder = 'desc',
            status,
            totalAmountFrom,
            totalAmountTo,
            orderDateFrom,
            orderDateTo,
            search,
        } = req.query as { [key: string]: string }

        const pageNum = Math.max(1, parseInt(page, 10) || 1)

        const requestedLimit = parseInt(limit, 10) || 10
        const limitNum = Math.min(requestedLimit, 10)

        const filters: FilterQuery<Partial<IOrder>> = {}

        if (status) {
            if (typeof status === 'string' && Object.values(StatusType).includes(status as StatusType)) {
                filters.status = status
            }
        }

        if (totalAmountFrom) {
            filters.totalAmount = {
                ...filters.totalAmount,
                $gte: Number(totalAmountFrom),
            }
        }

        if (totalAmountTo) {
            filters.totalAmount = {
                ...filters.totalAmount,
                $lte: Number(totalAmountTo),
            }
        }

        if (orderDateFrom) {
            filters.createdAt = {
                ...filters.createdAt,
                $gte: new Date(orderDateFrom),
            }
        }

        if (orderDateTo) {
            const endOfDay = new Date(orderDateTo)
            endOfDay.setHours(23, 59, 59, 999) 
            filters.createdAt = {
                ...filters.createdAt,
                $lte: endOfDay,
            }
        }

        const aggregatePipeline: PipelineStage[] = [
            { $match: filters },
            {
                $lookup: {
                    from: 'products',
                    localField: 'products',
                    foreignField: '_id',
                    as: 'products',
                },
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'customer',
                    foreignField: '_id',
                    as: 'customer',
                },
            },
            { $unwind: '$customer' },
        ]

        if (search) {
            const safeSearchString = escapeRegExp(search)
            const searchRegex = new RegExp(safeSearchString, 'i')
            const searchNumber = Number(search)

            const searchConditions: FilterQuery<IOrder>[] = [
                { 'products.title': searchRegex },
                { 'customer.name': searchRegex },
                { 'customer.email': searchRegex },
            ]

            if (!Number.isNaN(searchNumber)) {
                searchConditions.push({ orderNumber: searchNumber })
            }

            aggregatePipeline.push({
                $match: {
                    $or: searchConditions,
                },
            })
        }

        const countPipeline: PipelineStage[] = [
            ...aggregatePipeline,
            { $count: 'total' },
        ]

        const sort: { [key: string]: 1 | -1 } = {}

        const allowedSortFields = ['createdAt', 'totalAmount', 'orderNumber', 'status']

        if (sortField && allowedSortFields.includes(sortField as string)) {
            sort[sortField as string] = sortOrder === 'desc' ? -1 : 1
        } else {
            sort.createdAt = -1
        }

        aggregatePipeline.push(
            { $sort: sort },
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
            {
                $group: {
                    _id: '$_id',
                    orderNumber: { $first: '$orderNumber' },
                    status: { $first: '$status' },
                    totalAmount: { $first: '$totalAmount' },
                    products: { $first: '$products' },
                    customer: { $first: '$customer' },
                    createdAt: { $first: '$createdAt' },
                    deliveryAddress: { $first: '$deliveryAddress' },
                    phone: { $first: '$phone' },
                    email: { $first: '$email' },
                    comment: { $first: '$comment' },
                    payment: { $first: '$payment' },
                },
            }
        )

        const [orders, totalResults] = await Promise.all([
            Order.aggregate<IOrder>(aggregatePipeline),
            Order.aggregate<{ total: number }>(countPipeline),
        ])

        const totalOrders = totalResults.length > 0 ? totalResults[0].total : 0
        const totalPages = Math.ceil(totalOrders / limitNum)

        res.status(200).json({
            orders,
            pagination: {
                totalOrders,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (error: unknown) {
        next(error)
    }
}

export const getOrdersCurrentUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        const { search, page = '1', limit = '5' } = req.query as { [key: string]: string }

        const pageNum = Math.max(1, parseInt(page, 10) || 1)
        const limitNum = parseInt(limit, 10) || 5

        const options = {
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }

        const matchQuery: FilterQuery<IOrder> = { customer: userId }

        if (search) {
            const safeSearchString = escapeRegExp(search)
            const searchRegex = new RegExp(safeSearchString, 'i')
            const searchNumber = Number(search)

            const products = await Product.find({ title: searchRegex }, '_id')
            const productIds = products.map((product) => product._id)

            const orConditions: FilterQuery<IOrder>[] = [
                { products: { $in: productIds } },
            ]

            if (!Number.isNaN(searchNumber)) {
                orConditions.push({ orderNumber: searchNumber })
            }

            matchQuery.$or = orConditions
        }

        const orders = await Order.find(matchQuery, null, options)
            .populate('products')
            .populate('customer')
            .sort({ createdAt: -1 })

        const totalOrders = await Order.countDocuments(matchQuery)
        const totalPages = Math.ceil(totalOrders / limitNum)

        return res.send({
            orders,
            pagination: {
                totalOrders,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (error: unknown) {
        next(error)
    }
}

// Get order by ID
export const getOrderByNumber = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const order = await Order.findOne({
            orderNumber: req.params.orderNumber,
        })
            .populate(['customer', 'products'])
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
        return res.status(200).json(order)
    } catch (error: unknown) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}

export const getOrderCurrentUserByNumber = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const userId = res.locals.user._id
    try {
        const order = await Order.findOne({
            orderNumber: req.params.orderNumber,
        })
            .populate(['customer', 'products'])
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
        if (!order.customer._id.equals(userId)) {
            // Если нет доступа не возвращаем 403, а отдаем 404
            return next(
                new NotFoundError('Заказ по заданному id отсутствует в базе')
            )
        }
        return res.status(200).json(order)
    } catch (error: unknown) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}

// POST /product
export const createOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const basket: IProduct[] = []
        const userId = res.locals.user._id
        const { address, payment, phone, total, email, items, comment } =
            req.body

        const productIds = (items as string[]).map(
            (id: string) => new Types.ObjectId(id)
        )

        const products = await Product.find<IProduct>({ _id: { $in: productIds } })
        
        const productMap = new Map(products.map((p) => [p._id.toString(), p]))

        for (const id of items) {
            const product = productMap.get(id)

            if (!product) {
                throw new BadRequestError(`Товар с id ${id} не найден`)
            }
            if (product.price === null) {
                throw new BadRequestError(`Товар с id ${id} не продается`)
            }
            
            basket.push(product)
        }

        const totalBasket = basket.reduce((a, c) => a + (c.price || 0), 0)
        if (totalBasket !== total) {
            return next(new BadRequestError('Неверная сумма заказа'))
        }

        const safeComment = sanitizeHtml(comment || '', {
            allowedTags: [],
            allowedAttributes: {},
        })

        const newOrder = new Order({
            totalAmount: total,
            products: items,
            payment,
            phone,
            email,
            comment: safeComment,
            customer: userId,
            deliveryAddress: address,
        })

        await newOrder.save()

        const populateOrder = await newOrder.populate(['customer', 'products'])

        return res.status(200).json(populateOrder)
    } catch (error: unknown) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        return next(error)
    }
}

// Update an order
export const updateOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { status } = req.body
        const updatedOrder = await Order.findOneAndUpdate(
            { orderNumber: req.params.orderNumber },
            { status },
            { new: true, runValidators: true }
        )
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .populate(['customer', 'products'])
        return res.status(200).json(updatedOrder)
    } catch (error: unknown) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}

// Delete an order
export const deleteOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const deletedOrder = await Order.findByIdAndDelete(req.params.id)
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .populate(['customer', 'products'])
        return res.status(200).json(deletedOrder)
    } catch (error: unknown) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}
