## Exam Attempts API

### Client Operations

#### Get Exam Rules
**Endpoint:** `GET /exam-attempts/rules/:examId`  
**Auth:** Required  
**Rate Limit:** examAttemptLimiter

**Purpose:** Pre-exam information display with access verification.

**Implementation Notes:**
- Cached exam rules with user-specific access
- Premium exam access verification
- Rule generation based on exam configuration
- 24-hour cache for static rule content

#### Start Exam
**Endpoint:** `POST /exam-attempts/start/:examId`  
**Auth:** Required  
**Rate Limit:** examAttemptLimiter

**Purpose:** Initialize new exam attempt with question selection.

**Implementation Notes:**
- Multi-phase approach for 1000+ concurrent users
- Existing attempt detection and continuation
- Random question selection with Fisher-Yates shuffle
- Attempt validation (maxAttempt, allowMultipleAttempts)
- Comprehensive caching strategy

**Response Schema:**
```javascript
{
  "status": "success",
  "data": {
    "attemptId": "string",
    "timeRemaining": number,
    "resuming": boolean,
    "attemptInfo": {
      "currentAttempt": number,
      "maxAttempts": number,
      "allowMultipleAttempts": boolean,
      "remainingAttempts": number
    }
  }
}
```

#### Get Exam Questions
**Endpoint:** `GET /exam-attempts/questions/:attemptId`  
**Auth:** Required  
**Rate Limit:** examAttemptLimiter

**Purpose:** Retrieve questions for active exam with saved answers.

**Implementation Notes:**
- Questions returned without correct answers
- User's saved answers included
- Batch question caching for performance
- Statement-based question support

#### Save Answer (Single)
**Endpoint:** `POST /exam-attempts/answer/:attemptId/:questionId`  
**Auth:** Required  
**Rate Limit:** saveAnswerLimiter (500/min)

**Request Body:**
```javascript
{
  "selectedOption": "string|array",
  "responseTime": number
}
```

**Purpose:** Save individual question answer with response time.

**Implementation Notes:**
- Redis-first caching for immediate consistency
- Atomic database updates
- Unattempted count management
- Race condition prevention

#### Save Batch Answers
**Endpoint:** `POST /exam-attempts/batch-answers/:attemptId`  
**Auth:** Required  
**Rate Limit:** batchAnswerLimiter

**Request Body:**
```javascript
{
  "answers": [
    {
      "questionId": "string",
      "selectedOption": "string|array",
      "responseTime": number
    }
  ]
}
```

**Purpose:** Bulk answer saving for performance optimization.

**Implementation Notes:**
- Optimized for high concurrency (500+ users)
- Bulk database operations
- Validation for all answers in batch
- Efficient unattempted count calculation

#### Update Time Remaining
**Endpoint:** `PUT /exam-attempts/time/:attemptId`  
**Auth:** Required (with bypass options)  
**Rate Limit:** None (bypassed for exam continuity)

**Request Body:**
```javascript
{
  "timeRemaining": number
}
```

**Purpose:** Sync client timer with server state.

**Implementation Notes:**
- Enhanced authentication handling with bypass modes
- Redis storage with TTL
- Graceful error handling for exam continuity
- Queue updates for database persistence

#### Submit Exam
**Endpoint:** `POST /exam-attempts/submit/:attemptId`  
**Auth:** Required  
**Rate Limit:** None (bypassed)

**Purpose:** Finalize exam attempt and queue for processing.

**Implementation Notes:**
- Asynchronous processing with queue system
- Lock mechanism prevents concurrent submissions
- Status tracking (processing/completed)
- Fallback to synchronous processing

**Response Schema:**
```javascript
{
  "status": "processing",
  "message": "string",
  "data": {
    "attemptId": "string",
    "checkStatusUrl": "string",
    "estimatedProcessingTime": "string"
  }
}
```

#### Check Exam Status
**Endpoint:** `GET /exam-attempts/status/:attemptId`  
**Auth:** Required  
**Rate Limit:** examAttemptLimiter

**Purpose:** Verify exam attempt status and validity.

#### Get Current Time
**Endpoint:** `GET /exam-attempts/time-check/:attemptId`  
**Auth:** Required  
**Rate Limit:** examAttemptLimiter

**Purpose:** Server time synchronization for exam timer.

#### Get Attempt Result
**Endpoint:** `GET /exam-attempts/result/:attemptId`  
**Auth:** Required  
**Rate Limit:** profileLimiter

**Purpose:** Detailed exam results with question analysis.

**Response Schema:**
```javascript
{
  "status": "success",
  "data": {
    "attempt": {
      "id": "string",
      "status": "string"
    },
    "exam": {
      "title": "string",
      "totalMarks": number,
      "passMarkPercentage": number
    },
    "summary": {
      "finalScore": number,
      "correctAnswers": number,
      "wrongAnswers": number,
      "unattempted": number,
      "hasPassed": boolean,
      "scorePercentage": number
    },
    "detailedAnswers": [
      {
        "questionId": "string",
        "questionText": "string",
        "selectedOption": "string",
        "correctOptionId": "string",
        "isCorrect": boolean,
        "explanation": "string"
      }
    ]
  }
}
```

#### Get User Attempts
**Endpoint:** `GET /exam-attempts/user-attempts`  
**Auth:** Required  
**Rate Limit:** profileLimiter

**Query Parameters:**
```javascript
{
  "examId": "string", // optional filter
  "status": "string", // optional filter
  "page": number,
  "limit": number
}
```

#### Get Exam Rankings
**Endpoint:** `GET /exam-attempts/rankings/:examId`  
**Auth:** Required  
**Rate Limit:** examAttemptLimiter

**Query Parameters:**
```javascript
{
  "limit": number // default: 10
}
```

**Purpose:** Public rankings with user's position.

### Admin Operations

*All admin operations require admin role verification*

#### Get Admin Rankings
**Endpoint:** `GET /exam-attempts/admin-rankings/:examId`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "sortBy": "rank|score|time",
  "sortOrder": "asc|desc"
}
```

**Purpose:** Detailed rankings with student information.

#### Get Exam Results
**Endpoint:** `GET /exam-attempts/exam/:examId/results`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "sortBy": "startedAt|studentName|score|completedAt",
  "sortOrder": "asc|desc",
  "status": "all|completed|in-progress|timed-out",
  "search": "string"
}
```

**Purpose:** Comprehensive student results management.

**Implementation Notes:**
- Advanced sorting with student name aggregation
- Search functionality across user fields
- Status filtering with completion verification
- Optimized pagination for large datasets

#### Get Student Detailed Result
**Endpoint:** `GET /exam-attempts/student-result/:attemptId`  
**Auth:** Admin Required

**Purpose:** Complete student performance analysis.

**Response Includes:**
- Full attempt details
- Student demographics
- Question-by-question analysis
- Timing statistics and distribution

#### Recalculate Exam Attempt
**Endpoint:** `PATCH /exam-attempts/admin-recalculate/:attemptId`  
**Auth:** Admin Required

**Request Body:**
```javascript
{
  "studentId": "string"
}
```

**Purpose:** Reprocess exam results with current scoring logic.

**Implementation Notes:**
- Transaction-based processing
- Lock mechanism prevents concurrent recalculation
- Question fetching with correct answer verification
- Comprehensive audit trail

#### Change Attempt Status
**Endpoint:** `PATCH /exam-attempts/admin-change-status/:attemptId`  
**Auth:** Admin Required

**Purpose:** Manual status change from in-progress to completed.

**Implementation Notes:**
- Automatic result calculation for incomplete attempts
- Status validation before change
- Cache invalidation across multiple service layers

#### Delete Exam Attempt
**Endpoint:** `DELETE /exam-attempts/admin-delete/:attemptId`  
**Auth:** Admin Required

**Purpose:** Remove exam attempt with complete cleanup.

**Implementation Notes:**
- Comprehensive cache clearing
- Analytics update to reflect deletion
- Audit logging for compliance

#### Calculate Rankings
**Endpoint:** `POST /exam-attempts/calculate-rankings/:examId`  
**Auth:** Admin Required

**Purpose:** Recalculate rankings and percentiles for exam.

#### Export Rankings
**Endpoint:** `GET /exam-attempts/export-rankings/:examId`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "format": "csv|json" // default: "csv"
}
```

**Purpose:** Export rankings data for external analysis.