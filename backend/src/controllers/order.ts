import { NextFunction, Request, Response } from 'express'
import { FilterQuery, Error as MongooseError, Types, PipelineStage } from 'mongoose'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import Order, { IOrder, StatusType } from '../models/order'
import Product, { IProduct } from '../models/product'
import escapeRegExp from '../utils/escapeRegExp'
import sanitizeHtml from 'sanitize-html'

// Константы для валидации
const VALIDATION_LIMITS = {
  MAX_PHONE_LENGTH: 20,
  MAX_ADDRESS_LENGTH: 200,
  MAX_EMAIL_LENGTH: 100,
  MAX_COMMENT_LENGTH: 500,
  MIN_PHONE_LENGTH: 10,
  MAX_ITEMS_COUNT: 20
} as const

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

// Вспомогательная функция для безопасной валидации телефона
const validatePhoneSafely = (phone: string): { isValid: boolean; error?: string } => {
  // 1. Проверка типа
  if (typeof phone !== 'string') {
    return { isValid: false, error: 'Телефон должен быть строкой' }
  }

  // 2. Проверка длины (БЫСТРАЯ ПРОВЕРКА В НАЧАЛЕ)
  if (phone.length > VALIDATION_LIMITS.MAX_PHONE_LENGTH) {
    return { 
      isValid: false, 
      error: `Телефон слишком длинный. Максимальная длина: ${VALIDATION_LIMITS.MAX_PHONE_LENGTH} символов` 
    }
  }

  if (phone.length < VALIDATION_LIMITS.MIN_PHONE_LENGTH) {
    return { 
      isValid: false, 
      error: `Телефон слишком короткий. Минимальная длина: ${VALIDATION_LIMITS.MIN_PHONE_LENGTH} символов` 
    }
  }

  // 3. Проверка на опасные символы (предотвращение инъекций)
  const dangerousChars = ['$', '{', '}', ';', '|', '&', '`', '"', "'"];
  for (const char of dangerousChars) {
    if (phone.includes(char)) {
      return { 
        isValid: false, 
        error: 'Телефон содержит недопустимые символы' 
      }
    }
  }

  // 4. Проверка формата (только после всех быстрых проверок)
  // Упрощенное регулярное выражение для предотвращения ReDoS
  const phoneRegex = /^\+?[0-9\s\-\(\)]{10,20}$/;
  
  // Безопасная проверка с таймаутом (для Node.js 16+)
  try {
    const startTime = Date.now();
    const isValid = phoneRegex.test(phone);
    const elapsedTime = Date.now() - startTime;
    
    // Если проверка заняла слишком много времени
    if (elapsedTime > 100) { // 100ms максимум
      console.warn(`Проверка телефона заняла слишком много времени: ${elapsedTime}ms`);
      return { 
        isValid: false, 
        error: 'Ошибка проверки формата телефона' 
      }
    }
    
    if (!isValid) {
      return { 
        isValid: false, 
        error: 'Неверный формат телефона. Используйте только цифры, пробелы, дефисы и скобки' 
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке телефона:', error);
    return { 
      isValid: false, 
      error: 'Ошибка проверки формата телефона' 
    }
  }

  return { isValid: true }
}

// Вспомогательная функция для валидации других полей
const validateOtherFields = (
  address: string, 
  email: string, 
  comment?: string
): { isValid: boolean; error?: string } => {
  
  // Проверка адреса
  if (typeof address !== 'string') {
    return { isValid: false, error: 'Адрес должен быть строкой' }
  }
  
  if (address.length > VALIDATION_LIMITS.MAX_ADDRESS_LENGTH) {
    return { 
      isValid: false, 
      error: `Адрес слишком длинный. Максимальная длина: ${VALIDATION_LIMITS.MAX_ADDRESS_LENGTH} символов` 
    }
  }

  if (address.trim().length === 0) {
    return { isValid: false, error: 'Адрес не может быть пустым' }
  }

  // Проверка email
  if (typeof email !== 'string') {
    return { isValid: false, error: 'Email должен быть строкой' }
  }

  if (email.length > VALIDATION_LIMITS.MAX_EMAIL_LENGTH) {
    return { 
      isValid: false, 
      error: `Email слишком длинный. Максимальная длина: ${VALIDATION_LIMITS.MAX_EMAIL_LENGTH} символов` 
    }
  }

  // Простая проверка формата email (без сложного regex для предотвращения ReDoS)
  if (!email.includes('@') || email.split('@').length !== 2) {
    return { isValid: false, error: 'Неверный формат email' }
  }

  // Проверка комментария (если есть)
  if (comment && typeof comment === 'string') {
    if (comment.length > VALIDATION_LIMITS.MAX_COMMENT_LENGTH) {
      return { 
        isValid: false, 
        error: `Комментарий слишком длинный. Максимальная длина: ${VALIDATION_LIMITS.MAX_COMMENT_LENGTH} символов` 
      }
    }
  }

  return { isValid: true }
}

// POST /product
export const createOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        const { address, payment, phone, total, email, items, comment } = req.body

        // 1. Проверка обязательных полей
        if (!address || !payment || !phone || !total || !email || !items) {
            return res.status(400).json({ 
                error: 'Отсутствуют обязательные поля' 
            })
        }

        // 2. Проверка типа items
        if (!Array.isArray(items)) {
            return res.status(400).json({ 
                error: 'Поле items должно быть массивом' 
            })
        }

        // 3. Проверка количества товаров
        if (items.length === 0) {
            return res.status(400).json({ 
                error: 'Корзина не может быть пустой' 
            })
        }

        if (items.length > VALIDATION_LIMITS.MAX_ITEMS_COUNT) {
            return res.status(400).json({ 
                error: `Слишком много товаров в заказе. Максимум: ${VALIDATION_LIMITS.MAX_ITEMS_COUNT}` 
            })
        }

        // 4. Проверка total
        if (typeof total !== 'number' || total <= 0) {
            return res.status(400).json({ 
                error: 'Неверная сумма заказа' 
            })
        }

        // 5. Валидация телефона (с защитой от ReDoS)
        const phoneValidation = validatePhoneSafely(phone)
        if (!phoneValidation.isValid) {
            return res.status(400).json({ 
                error: phoneValidation.error 
            })
        }

        // 6. Валидация других полей
        const fieldsValidation = validateOtherFields(address, email, comment)
        if (!fieldsValidation.isValid) {
            return res.status(400).json({ 
                error: fieldsValidation.error 
            })
        }

        // 7. Проверка ID товаров
        const productIds: Types.ObjectId[] = []
        for (const id of items) {
            if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
                return res.status(400).json({ 
                    error: `Невалидный ID товара: ${id}` 
                })
            }
            productIds.push(new Types.ObjectId(id))
        }

        // 8. Поиск товаров
        const products = await Product.find<IProduct>({ _id: { $in: productIds } })
        
        if (products.length !== items.length) {
            return res.status(400).json({ 
                error: 'Некоторые товары не найдены' 
            })
        }

        const productMap = new Map(products.map((p) => [p._id.toString(), p]))
        let totalBasket = 0
        const basket: IProduct[] = []

        for (const id of items) {
            const product = productMap.get(id)

            if (!product) {
                return res.status(400).json({ 
                    error: `Товар с id ${id} не найден` 
                })
            }
            if (product.price === null) {
                return res.status(400).json({ 
                    error: `Товар с id ${id} не продается` 
                })
            }
            
            basket.push(product)
            totalBasket += product.price || 0
        }

        // 9. Проверка суммы
        if (Math.abs(totalBasket - total) > 0.01) { // допуск для округления
            return res.status(400).json({ 
                error: 'Неверная сумма заказа' 
            })
        }

        // 10. Очистка комментария
        const safeComment = sanitizeHtml(comment || '', {
            allowedTags: [],
            allowedAttributes: {},
        })

        // 11. Создание заказа
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
            return res.status(400).json({ 
                error: error.message 
            })
        }
        console.error('Ошибка при создании заказа:', error)
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
