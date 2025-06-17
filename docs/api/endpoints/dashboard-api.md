## Dashboard API

*Requires Admin Role*

### Get Dashboard Statistics
**Endpoint:** `GET /dashboard/stats`  
**Auth:** Admin Required  
**Rate Limit:** apiLimiter

**Purpose:** High-level metrics for admin dashboard overview.

**Response Schema:**
```javascript
{
  "status": "success",
  "fromCache": boolean,
  "data": {
    "overview": {
      "totalExams": number,
      "totalQuestions": number,
      "totalStudents": number,
      "averagePassRate": number
    },
    "growth": {
      "exams": { "current": number, "previous": number, "percentage": number },
      "questions": { "current": number, "previous": number, "percentage": number },
      "students": { "current": number, "previous": number, "percentage": number },
      "passRate": { "current": number, "previous": number, "percentage": number }
    },
    "performance": {
      "currentMetrics": {
        "averageScore": number,
        "passRate": number,
        "participation": number
      },
      "chartData": [
        {
          "date": "string",
          "passRate": number,
          "participation": number
        }
      ]
    },
    "recentActivity": [
      {
        "type": "string",
        "title": "string",
        "description": "string",
        "timestamp": "date",
        "icon": "string"
      }
    ]
  }
}
```

**Cache Key:** `admin:dashboard:stats`  
**Cache TTL:** 10 minutes

### Get Dashboard Overview
**Endpoint:** `GET /dashboard/overview`  
**Auth:** Admin Required

**Purpose:** Comprehensive dashboard data with system health indicators.

**Implementation Notes:**
- Parallel database queries for performance
- Growth calculation with month-over-month comparison
- Top performing exams based on pass rates
- System health indicators

### Get Performance Metrics
**Endpoint:** `GET /dashboard/performance`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "timeRange": "7d|30d|90d|1y", // default: "7d"
  "metric": "all|overview|trends|distribution|participation|exam-wise"
}
```

**Purpose:** Detailed performance analytics with time-series data.

**Implementation Notes:**
- Supports multiple time groupings (hour/day/week/month)
- Moving averages for trend analysis
- Score distribution bucketing
- Exam-wise performance comparison

### Get System Health
**Endpoint:** `GET /dashboard/health`  
**Auth:** Admin Required

**Purpose:** System monitoring and health status.

**Response Includes:**
- Database connection status
- Redis connectivity
- Memory usage metrics
- CPU performance indicators
- Application uptime

### Get Recent Activity
**Endpoint:** `GET /dashboard/activity`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "limit": number, // default: 10, max: 50
  "type": "all|exams|students|questions|results"
}
```

**Purpose:** Activity feed for dashboard display.

### Get Dashboard Analytics
**Endpoint:** `GET /dashboard/analytics`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "timeRange": "7d|30d|90d|1y", // default: "30d"
  "compareWith": "previous|year|none", // default: "previous"
  "includeForecasts": "true|false" // default: "false"
}
```

**Purpose:** Advanced analytics with predictive insights.

**Implementation Notes:**
- Comprehensive aggregation pipeline
- Trend forecasting using moving averages
- Category-wise analysis
- Performance insights with top/bottom performers