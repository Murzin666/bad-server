import { errors } from 'celebrate'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import 'dotenv/config'
import express, { json, urlencoded } from 'express'
import mongoose from 'mongoose'
import path from 'path'
import { DB_ADDRESS, ORIGIN_ALLOW } from './config'
import errorHandler from './middlewares/error-handler'
import serveStatic from './middlewares/serverStatic'
import routes from './routes'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import mongoSanitize from 'express-mongo-sanitize'

const { PORT = 3000 } = process.env
const app = express()

app.set('query parser', 'simple')

const limiter = rateLimit({
    // Указываем интервал времени, в рамках которого зададим ограничение
    windowMs: 15 * 60 * 1000,
    // Ограничиваем количество запросов в этом интервале
    limit: 100,
    // Включаем заголовки нового типа `RateLimit-*`
    standardHeaders: true,
    // Отключаем заголовки старого типа `X-RateLimit-*`
    legacyHeaders: false,
})

app.use(limiter) 

app.use(helmet())
app.use(mongoSanitize())

app.use(cookieParser())

// app.use(cors())
app.use(cors({ origin: ORIGIN_ALLOW, credentials: true }));
// app.use(express.static(path.join(__dirname, 'public')));

app.use(serveStatic(path.join(__dirname, 'public')))

app.use(urlencoded({ extended: true }))
app.use(json())

app.options('*', cors())
app.use(routes)
app.use(errors())
app.use(errorHandler)

// eslint-disable-next-line no-console

const bootstrap = async () => {
    try {
        await mongoose.connect(DB_ADDRESS)
        await app.listen(PORT, () => console.log('ok'))
    } catch (error) {
        console.error(error)
    }
}

bootstrap()
