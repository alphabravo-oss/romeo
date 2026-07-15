import type { RomeoApi } from '../context'

export function registerHealthRoutes(app: RomeoApi): void {
  app.get('/api/v1/health', (context) => {
    return context.json({
      data: {
        status: 'ok',
        service: 'romeo-api',
        version: '0.1.0',
        requestId: context.get('requestId')
      }
    })
  })
}
