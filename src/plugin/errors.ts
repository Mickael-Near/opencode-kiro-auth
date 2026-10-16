export class KiroTokenRefreshError extends Error {
  code?: string
  originalError?: Error

  constructor(message: string, code?: string, originalError?: Error) {
    super(message)
    this.name = 'KiroTokenRefreshError'
    this.code = code
    this.originalError = originalError
  }
}
