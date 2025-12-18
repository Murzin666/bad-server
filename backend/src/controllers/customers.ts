import { NextFunction, Request, Response } from 'express'
import { FilterQuery, SortOrder } from 'mongoose'
import NotFoundError from '../errors/not-found-error'
import Order from '../models/order'
import User, { IUser } from '../models/user'
import escapeRegExp from '../utils/escapeRegExp'

type CustomerSortFields = 'createdAt' | 'totalAmount' | 'orderCount' | 'lastOrderDate' | 'name' | 'email'

// TODO: Добавить guard admin
// eslint-disable-next-line max-len
// Get GET /customers?page=2&limit=5&sort=totalAmount&order=desc&registrationDateFrom=2023-01-01&registrationDateTo=2023-12-31&lastOrderDateFrom=2023-01-01&lastOrderDateTo=2023-12-31&totalAmountFrom=100&totalAmountTo=1000&orderCountFrom=1&orderCountTo=10
export const getCustomers = async (
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
            registrationDateFrom,
            registrationDateTo,
            lastOrderDateFrom,
            lastOrderDateTo,
            totalAmountFrom,
            totalAmountTo,
            orderCountFrom,
            orderCountTo,
            search,
        } = req.query as { [key: string]: string }

        const pageNum = Math.max(1, parseInt(page, 10) || 1)

        const requestedLimit = parseInt(limit, 10) || 10
        const limitNum = Math.min(requestedLimit, 100)

        const filters: FilterQuery<Partial<IUser>> = {}

        // Фильтрация по дате регистрации
        if (registrationDateFrom) {
            filters.createdAt = {
                ...filters.createdAt,
                $gte: new Date(registrationDateFrom),
            }
        }

        if (registrationDateTo) {
            const endOfDay = new Date(registrationDateTo)
            endOfDay.setHours(23, 59, 59, 999)
            filters.createdAt = {
                ...filters.createdAt,
                $lte: endOfDay,
            }
        }

        if (lastOrderDateFrom) {
            filters.lastOrderDate = {
                ...filters.lastOrderDate,
                $gte: new Date(lastOrderDateFrom),
            }
        }

        if (lastOrderDateTo) {
            const endOfDay = new Date(lastOrderDateTo)
            endOfDay.setHours(23, 59, 59, 999)
            filters.lastOrderDate = {
                ...filters.lastOrderDate,
                $lte: endOfDay,
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

        if (orderCountFrom) {
            filters.orderCount = {
                ...filters.orderCount,
                $gte: Number(orderCountFrom),
            }
        }

        if (orderCountTo) {
            filters.orderCount = {
                ...filters.orderCount,
                $lte: Number(orderCountTo),
            }
        }

        if (search) {
            const safeSearchString = escapeRegExp(search)
            const searchRegex = new RegExp(safeSearchString, 'i')
            const orders = await Order.find(
                {
                    deliveryAddress: searchRegex,
                },
                '_id'
            ).limit(1000)

            const orderIds = orders.map((order) => order._id)

            filters.$or = [
                { name: searchRegex },
                { lastOrder: { $in: orderIds } },
            ]
        }

        const sort: { [key in CustomerSortFields]?: SortOrder } = {}

        const allowedSortFields: CustomerSortFields[] = [
            'createdAt',
            'totalAmount',
            'orderCount',
            'lastOrderDate',
            'name',
            'email',
        ]

        if (allowedSortFields.includes(sortField as CustomerSortFields)) {
            sort[sortField as CustomerSortFields] = sortOrder === 'desc' ? -1 : 1
        } else {
            sort.createdAt = -1
        }

        const options = {
            sort,
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }

        const users = await User.find(filters, null, options).populate([
            'orders',
            {
                path: 'lastOrder',
                populate: ['products', 'customer'],
            },
        ])

        const totalUsers = await User.countDocuments(filters)
        const totalPages = Math.ceil(totalUsers / limitNum)

        res.status(200).json({
            customers: users,
            pagination: {
                totalUsers,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (error: unknown) {
        next(error)
    }
}

// TODO: Добавить guard admin
// Get /customers/:id
export const getCustomerById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const user = await User.findById(req.params.id).populate([
            'orders',
            'lastOrder',
        ])
        
        if (!user) {
            throw new NotFoundError('Пользователь по заданному id отсутствует в базе')
        }
        
        res.status(200).json(user)
    } catch (error: unknown) {
        next(error)
    }
}

// TODO: Добавить guard admin
// Patch /customers/:id
export const updateCustomer = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { name, email, phone, roles } = req.body
        const updateData: Partial<IUser> = {}
        if (name !== undefined) updateData.name = name
        if (email !== undefined) updateData.email = email
        if (phone !== undefined) updateData.phone = phone
        if (roles !== undefined) updateData.roles = roles

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            {
                new: true,
                runValidators: true,
            }
        )
            .orFail(
                () =>
                    new NotFoundError(
                        'Пользователь по заданному id отсутствует в базе'
                    )
            )
            .populate(['orders', 'lastOrder'])
            
        res.status(200).json(updatedUser)
    } catch (error: unknown) {
        next(error)
    }
}

// TODO: Добавить guard admin
// Delete /customers/:id
export const deleteCustomer = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const deletedUser = await User.findByIdAndDelete(req.params.id).orFail(
            () =>
                new NotFoundError(
                    'Пользователь по заданному id отсутствует в базе'
                )
        )
        res.status(200).json(deletedUser)
    } catch (error: unknown) {
        next(error)
    }
}
