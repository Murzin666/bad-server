import { Router } from 'express'
import {
    deleteCustomer,
    getCustomerById,
    getCustomers,
    updateCustomer,
} from '../controllers/customers'
import auth, { roleGuardMiddleware } from '../middlewares/auth'
import { Role } from '../models/user'

const customerRouter = Router()

customerRouter.use(auth, roleGuardMiddleware(Role.Admin))

customerRouter.get('/', getCustomers)
customerRouter.get('/:id', getCustomerById)
customerRouter.patch('/:id', updateCustomer)
customerRouter.delete('/:id', deleteCustomer)

export default customerRouter
