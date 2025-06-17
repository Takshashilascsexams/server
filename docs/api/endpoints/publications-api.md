## Publications API

### Client Operations

#### Get Active Publications
**Endpoint:** `GET /publications/active`  
**Auth:** Required  
**Rate Limit:** examBrowseLimiter

**Purpose:** Public result publications for students.

#### Get User Exam Attempts
**Endpoint:** `GET /publications/user/attempts`  
**Auth:** Required  
**Rate Limit:** examBrowseLimiter

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "status": "completed,timed-out" // default filter
}
```

**Purpose:** User's exam history for profile page.

### Admin Operations

#### Get Exam Publications
**Endpoint:** `GET /publications/exams/:examId`  
**Auth:** Admin Required

**Purpose:** Manage publications for specific exam.

#### Generate Exam Results
**Endpoint:** `POST /publications/exams/:examId/generate-results`  
**Auth:** Admin Required

**Purpose:** Create PDF results publication.

**Implementation Notes:**
- PDF generation using Firebase storage
- Comprehensive statistics calculation
- Publication record creation
- Cache invalidation

#### Get Publication by ID
**Endpoint:** `GET /publications/:publicationId`  
**Auth:** Admin Required

**Purpose:** Publication details with file access.

#### Toggle Publication Status
**Endpoint:** `PUT /publications/:publicationId/status`  
**Auth:** Admin Required

**Request Body:**
```javascript
{
  "isPublished": boolean
}
```

**Purpose:** Control publication visibility.