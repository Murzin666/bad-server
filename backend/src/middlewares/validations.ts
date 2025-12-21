import { Joi, celebrate } from 'celebrate'
import { Types } from 'mongoose'

// Безопасное регулярное выражение для телефона (защита от ReDoS)
// Простая проверка без сложных backtracking паттернов
export const phoneRegExp = /^[\d\s\-\(\)\+]{10,20}$/

export enum PaymentType {
    Card = 'card',
    Online = 'online',
}

// валидация id
export const validateOrderBody = celebrate({
    body: Joi.object().keys({
        items: Joi.array()
            .items(
                Joi.string().custom((value, helpers) => {
                    if (Types.ObjectId.isValid(value)) {
                        return value
                    }
                    return helpers.message({ custom: 'Невалидный id' })
                })
            )
            .min(1)
            .max(20) // Ограничение количества товаров
            .required()
            .messages({
                'array.empty': 'Не указаны товары',
                'array.min': 'Корзина не может быть пустой',
                'array.max': 'Слишком много товаров в заказе',
            }),
        payment: Joi.string()
            .valid(...Object.values(PaymentType))
            .required()
            .messages({
                'string.valid':
                    'Указано не валидное значение для способа оплаты, возможные значения - "card", "online"',
                'string.empty': 'Не указан способ оплаты',
            }),
        email: Joi.string()
            .email()
            .max(100) // Ограничение длины email
            .required()
            .messages({
                'string.empty': 'Не указан email',
                'string.max': 'Email слишком длинный',
                'string.email': 'Неверный формат email',
            }),
        phone: Joi.string()
            .required()
            .pattern(phoneRegExp)
            .max(20)
            .messages({
                'string.empty': 'Не указан телефон',
                'string.pattern.base': 'Неверный формат телефона',
                'string.max': 'Телефон слишком длинный',
            }),
        address: Joi.string()
            .required()
            .max(200) // Ограничение длины адреса
            .messages({
                'string.empty': 'Не указан адрес',
                'string.max': 'Адрес слишком длинный',
            }),
        total: Joi.number()
            .required()
            .min(0)
            .messages({
                'number.base': 'Не указана сумма заказа',
                'number.min': 'Сумма заказа должна быть положительной',
            }),
        comment: Joi.string()
            .optional()
            .allow('')
            .max(500), // Ограничение длины комментария
    }),
})

// валидация товара.
// name и link - обязательные поля, name - от 2 до 30 символов, link - валидный url
export const validateProductBody = celebrate({
    body: Joi.object().keys({
        title: Joi.string().required().min(2).max(30).messages({
            'string.min': 'Минимальная длина поля "name" - 2',
            'string.max': 'Максимальная длина поля "name" - 30',
            'string.empty': 'Поле "title" должно быть заполнено',
        }),
        image: Joi.object().keys({
            fileName: Joi.string().required(),
            originalName: Joi.string().required(),
        }),
        category: Joi.string().required().messages({
            'string.empty': 'Поле "category" должно быть заполнено',
        }),
        description: Joi.string()
            .required()
            .max(1000) // Ограничение длины описания
            .messages({
                'string.empty': 'Поле "description" должно быть заполнено',
                'string.max': 'Описание слишком длинное',
            }),
        price: Joi.number().allow(null),
    }),
})

export const validateProductUpdateBody = celebrate({
    body: Joi.object().keys({
        title: Joi.string().min(2).max(30).messages({
            'string.min': 'Минимальная длина поля "name" - 2',
            'string.max': 'Максимальная длина поля "name" - 30',
        }),
        image: Joi.object().keys({
            fileName: Joi.string().required(),
            originalName: Joi.string().required(),
        }),
        category: Joi.string(),
        description: Joi.string().max(1000),
        price: Joi.number().allow(null),
    }),
})

export const validateObjId = celebrate({
    params: Joi.object().keys({
        productId: Joi.string()
            .required()
            .custom((value, helpers) => {
                if (Types.ObjectId.isValid(value)) {
                    return value
                }
                return helpers.message({ any: 'Невалидный id' })
            }),
    }),
})

export const validateUserBody = celebrate({
    body: Joi.object().keys({
        name: Joi.string().min(2).max(30).messages({
            'string.min': 'Минимальная длина поля "name" - 2',
            'string.max': 'Максимальная длина поля "name" - 30',
        }),
        password: Joi.string().min(6).required().messages({
            'string.empty': 'Поле "password" должно быть заполнено',
        }),
        email: Joi.string()
            .required()
            .email()
            .max(100)
            .message('Поле "email" должно быть валидным email-адресом')
            .messages({
                'string.empty': 'Поле "email" должно быть заполнено',
                'string.max': 'Email слишком длинный',
            }),
    }),
})

export const validateAuthentication = celebrate({
    body: Joi.object().keys({
        email: Joi.string()
            .required()
            .email()
            .message('Поле "email" должно быть валидным email-адресом')
            .messages({
                'string.required': 'Поле "email" должно быть заполнено',
            }),
        password: Joi.string().required().messages({
            'string.empty': 'Поле "password" должно быть заполнено',
        }),
    }),
})

export const validateGetOrders = celebrate({
  query: Joi.object().keys({
      page: Joi.string().optional(),
      limit: Joi.string().optional(),
      sortField: Joi.string().optional(),
      sortOrder: Joi.string().valid('asc', 'desc').optional(),
      status: Joi.string().optional(),
      totalAmountFrom: Joi.string().optional(),
      totalAmountTo: Joi.string().optional(),
      orderDateFrom: Joi.string().optional(),
      orderDateTo: Joi.string().optional(),
      search: Joi.string().optional().allow(''),
    })
    .unknown(false),
})
