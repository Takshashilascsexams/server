## Caching Architecture

**Cache Services:**
- `examService` - Exam data, access permissions
- `questionService` - Question data, pagination
- `userService` - User profiles, results
- `paymentService` - Payment verification
- `dashboardService` - Analytics, metrics
- `publicationService` - Published results
- `attemptService` - Active exam attempts
- `analyticsService` - Performance metrics

**Cache TTL Strategy:**
- User-specific data: 5-15 minutes
- System data: 1-24 hours
- Real-time data: 30 seconds - 5 minutes