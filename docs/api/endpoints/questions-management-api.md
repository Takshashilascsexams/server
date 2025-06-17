## Questions Management API

*All question endpoints require admin authentication*

### Get All Questions
**Endpoint:** `GET /questions/`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "sortBy": "createdAt|questionText|type|difficultyLevel|category|marks",
  "sortOrder": "asc|desc",
  "type": "string",
  "difficulty": "string",
  "category": "string",
  "search": "string"
}
```

**Purpose:** Question management dashboard.

### Get Questions by Exam
**Endpoint:** `GET /questions/exam/:examId`  
**Auth:** Admin Required

**Purpose:** Exam-specific question management.

### Get Question by ID
**Endpoint:** `GET /questions/:questionId`  
**Auth:** Admin Required

**Purpose:** Question details for editing.

### Create Question
**Endpoint:** `POST /questions/`  
**Auth:** Admin Required

**Request Body:**
```javascript
{
  "examId": "string",
  "questionText": "string",
  "type": "MCQ|STATEMENT_BASED|TRUE_FALSE|MULTIPLE_SELECT",
  "difficultyLevel": "EASY|MEDIUM|HARD",
  "subject": "string",
  "marks": number,
  "hasNegativeMarking": "Yes|No",
  "negativeMarks": number,
  "options": [
    {
      "optionText": "string",
      "isCorrect": boolean
    }
  ],
  "statements": [
    {
      "statementNumber": number,
      "statementText": "string",
      "isCorrect": boolean
    }
  ],
  "statementInstruction": "string",
  "explanation": "string",
  "correctAnswer": "string",
  "image": "string",
  "questionCode": "string"
}
```

**Purpose:** Create individual question with comprehensive validation.

### Update Question
**Endpoint:** `PUT /questions/:questionId`  
**Auth:** Admin Required

**Purpose:** Update existing question.

### Delete Question
**Endpoint:** `DELETE /questions/:questionId`  
**Auth:** Admin Required

**Purpose:** Remove question with cache cleanup.

### Bulk Question Upload
**Endpoint:** `POST /questions/bulk`  
**Auth:** Admin Required

**Request Body:**
```javascript
{
  "questionsArray": [
    {
      "questionText": "string",
      "type": "string",
      "options": [],
      "statements": [],
      "correctAnswer": "string",
      "explanation": "string",
      "subject": "string"
    }
  ],
  "examId": "string",
  "marks": number,
  "difficultyLevel": "string",
  "subject": "string",
  "hasNegativeMarking": "Yes|No",
  "negativeMarks": number
}
```

**Purpose:** Batch question creation for efficiency.

### Validate Bulk Questions
**Endpoint:** `POST /questions/bulk-validate`  
**Auth:** Admin Required  
**Content-Type:** multipart/form-data

**Purpose:** JSON file validation before bulk upload.

### Single Question Upload
**Endpoint:** `POST /questions/single-upload`  
**Auth:** Admin Required

**Purpose:** Alternative single question creation endpoint.