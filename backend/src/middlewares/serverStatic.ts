import { NextFunction, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

export default function serveStatic(baseDir: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestedPath = path.normalize(req.path)

    const filePath = path.join(baseDir, requestedPath)

    if (!filePath.startsWith(baseDir)) {
      return res.status(403).send('Forbidden')
    }

    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        return next()
      }
      return res.sendFile(filePath, (sendErr) => {
        if (sendErr) {
          next(sendErr)
        }
      })
    })
  }
}
