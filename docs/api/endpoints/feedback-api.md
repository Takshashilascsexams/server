## Feedback API

#### Get Top Feedbacks
**Endpoint:** `GET /feedback/top`  
**Rate Limit:** apiLimiter  
**Auth:** Not Required

**Query Parameters:**
```javascript
{
  "limit": number, // default: 4, max: 10
  "anonymous": "true|false" // default: "false"
}
```

**Purpose:** Public feedback display for homepage.

#### Submit Feedback
**Endpoint:** `POST /feedback/`  
**Auth:** Required  
**Rate Limit:** apiLimiter

**Request Body:**
```javascript
{
  "rating": number, // 1-5
  "comment": "string" // min 5 characters
}
```

**Purpose:** User feedback submission with update capability.

**Implementation Notes:**
- One feedback per user (update if exists)
- Cache invalidation on data changes
- Input validation for rating and comment length