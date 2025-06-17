## Bundle Exams API

### Get Bundle Details
**Endpoint:** `GET /bundle-exams/:bundleId`  
**Auth:** Required  
**Rate Limit:** examBrowseLimiter  

**Purpose:** Retrieve bundle information with access verification and exam details.

**Parameters:**
```javascript
{
  "bundleId": "string" // Bundle identifier from BUNDLE_DEFINITIONS
}
```

**Response Schema:**
```javascript
{
  "status": "success",
  "fromCache": boolean,
  "data": {
    "bundle": {
      "_id": "string",
      "title": "string",
      "description": "string",
      "duration": number,
      "totalMarks": number,
      "hasAccess": boolean,
      "hasAttemptAccess": boolean,
      "attemptCount": number,
      "bundledExams": [
        {
          "_id": "string",
          "title": "string",
          "hasAttemptAccess": boolean,
          "attemptCount": number
        }
      ]
    }
  }
}
```

**Implementation Notes:**
- Checks bundle vs premium exam access logic
- Validates attempt limits per exam in bundle
- Implements comprehensive caching with user-specific keys
- Handles free vs premium bundle pricing

**Cache Key:** `bundle:${bundleId}:${userIdString}`  
**Cache TTL:** 15 minutes