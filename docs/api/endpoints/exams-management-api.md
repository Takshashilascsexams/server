## Exams Management API

### Client Operations

#### Get Categorized Exams
**Endpoint:** `GET /exams/categorized`  
**Auth:** Required  
**Rate Limit:** examBrowseLimiter

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number
}
```

**Purpose:** Exam catalog with user-specific access and attempt information.

**Implementation Notes:**
- User-specific caching with access verification
- Bundle creation from tagged exams
- Attempt access validation per exam
- Premium access checking via payment records

**Response Schema:**
```javascript
{
  "status": "success",
  "fromCache": boolean,
  "pagination": {
    "total": number,
    "page": number,
    "pages": number,
    "limit": number
  },
  "data": {
    "categorizedExams": {
      "FEATURED": [],
      "BUNDLE": [],
      "GOVERNMENT_JOBS": [],
      "COMPETITIVE_EXAMS": [],
      "ACADEMIC": [],
      "PROFESSIONAL": [],
      "OTHER": []
    }
  }
}
```

#### Get Latest Published Exams
**Endpoint:** `GET /exams/latest-exams`  
**Auth:** Required  
**Rate Limit:** examBrowseLimiter

**Purpose:** Recent exams for homepage display.

**Implementation Notes:**
- Excludes bundle-tagged exams
- Question count validation
- Attempt status verification
- 5-minute cache with attempt access checking

### Admin Operations

#### Get All Exams (Dashboard)
**Endpoint:** `GET /exams/`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "sortBy": "createdAt|title|totalQuestions|totalMarks|category",
  "sortOrder": "asc|desc",
  "active": "true|false",
  "premium": "true",
  "featured": "true",
  "bundle": "true",
  "search": "string"
}
```

**Purpose:** Admin exam management with analytics.

**Implementation Notes:**
- Advanced filtering and sorting
- Analytics aggregation per exam
- Attempt count calculation
- Comprehensive caching strategy

#### Create Exam
**Endpoint:** `POST /exams/`  
**Auth:** Admin Required

**Request Body:**
```javascript
{
  "title": "string",
  "description": "string",
  "duration": number,
  "totalQuestions": number,
  "totalMarks": number,
  "hasNegativeMarking": "Yes|No",
  "negativeMarkingValue": number,
  "passMarkPercentage": number,
  "difficultyLevel": "EASY|MEDIUM|HARD",
  "category": "string",
  "allowNavigation": "Yes|No",
  "allowMultipleAttempts": boolean,
  "maxAttempt": number,
  "isPremium": "Yes|No",
  "price": number,
  "discountPrice": number,
  "accessPeriod": number,
  "isFeatured": "Yes|No",
  "isPartOfBundle": boolean,
  "bundleTag": "string"
}
```

**Purpose:** Create new exam with validation and analytics initialization.

**Implementation Notes:**
- Comprehensive validation including attempt logic
- Bundle tag assignment
- ExamAnalytics model initialization
- Multi-layer cache invalidation

#### Get Exam by ID
**Endpoint:** `GET /exams/:id`  
**Auth:** Admin Required

**Purpose:** Exam details for editing interface.

#### Get Exam Details
**Endpoint:** `GET /exams/:id/details`  
**Auth:** Admin Required

**Purpose:** Exam with comprehensive analytics and attempt statistics.

#### Update Exam
**Endpoint:** `PUT /exams/:id`  
**Auth:** Admin Required

**Purpose:** Update existing exam with validation.

**Implementation Notes:**
- Validation logic identical to creation
- Bundle tag management
- Comprehensive cache clearing

#### Update Exam Status
**Endpoint:** `PATCH /exams/:id/status`  
**Auth:** Admin Required

**Request Body:**
```javascript
{
  "isActive": boolean
}
```

**Purpose:** Enable/disable exam availability.

#### Delete Exam
**Endpoint:** `DELETE /exams/:id`  
**Auth:** Admin Required

**Purpose:** Remove exam and associated analytics.