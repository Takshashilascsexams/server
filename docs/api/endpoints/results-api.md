## Results API

### Get User Results
**Endpoint:** `GET /results/user`  
**Auth:** Required

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "sortBy": "createdAt|score|examTitle",
  "sortOrder": "asc|desc",
  "status": "passed|failed|completed",
  "category": "string"
}
```

**Purpose:** User's exam results with detailed analysis.

### Get User Results Summary
**Endpoint:** `GET /results/user/summary`  
**Auth:** Required

**Purpose:** Dashboard widget data for user profile.

**Response Schema:**
```javascript
{
  "status": "success",
  "data": {
    "statistics": {
      "totalAttempts": number,
      "passedAttempts": number,
      "failedAttempts": number,
      "passRate": "string",
      "averageScore": "string",
      "highestScore": "string"
    },
    "categoryBreakdown": {
      "GOVERNMENT_JOBS": {
        "total": number,
        "passed": number,
        "failed": number
      }
    },
    "recentAttempts": [
      {
        "attemptId": "string",
        "examTitle": "string",
        "score": "string",
        "hasPassed": boolean,
        "attemptedOn": "date"
      }
    ]
  }
}
```