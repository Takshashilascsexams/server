## Rate Limiting Strategy

**Rate Limiter Types:**
- `examAttemptLimiter` - 200/min (exam operations)
- `saveAnswerLimiter` - 500/min (answer saving)
- `batchAnswerLimiter` - 100/min (batch operations)
- `examBrowseLimiter` - 300/min (browsing)
- `paymentLimiter` - 20/min (payment operations)
- `profileLimiter` - 100/min (profile operations)
- `apiLimiter` - 100/min (general API)

**Critical Operations:** Time updates and exam submissions bypass rate limiting for exam continuity.