import { Error as MongooseError } from 'mongoose'

export const isMongooseDuplicateKeyError = (
  error: unknown
): error is Error & { code?: number } => {
  return (
    error instanceof Error &&
    (error as any).code === 11000 ||
    error instanceof MongooseError &&
    (error as any).code === 11000
  )
}
