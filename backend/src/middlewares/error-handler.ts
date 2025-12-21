import { ErrorRequestHandler } from 'express'

interface AppError extends Error {
  statusCode?: number
}

const errorHandler: ErrorRequestHandler = (err: AppError, _req, res, _next) => {
  const statusCode = err.statusCode || 500
  
  const message = statusCode === 500 
    ? 'На сервере произошла ошибка' 
    : err.message

  console.error({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    statusCode,
    message: err.message,
    stack: err.stack,
    name: err.name || 'UnknownError'
  })

  res.status(statusCode).send({ error: message })
}

export default errorHandler
