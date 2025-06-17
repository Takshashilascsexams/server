## Payment API

*All payment endpoints require authentication and use paymentLimiter (20/min)*

#### Create Payment
**Endpoint:** `POST /payment/create`  
**Auth:** Required

**Request Body:**
```javascript
{
  "examId": "string",
  "isBundle": boolean // default: false
}
```

**Purpose:** Initialize payment process for exam or bundle.

**Implementation Notes:**
- Bundle vs individual exam detection
- Existing access verification
- Razorpay integration
- Payment record creation with pending status

**Response Schema:**
```javascript
{
  "status": "success",
  "message": "string",
  "data": {
    "payment": {
      "userId": "string",
      "examId": "string",
      "transactionId": "string",
      "amount": number,
      "status": "pending"
    },
    "razorpayOrder": {
      "id": "string",
      "amount": number,
      "currency": "INR"
    },
    "isBundle": boolean,
    "bundledExams": [
      {
        "id": "string",
        "title": "string"
      }
    ]
  }
}
```

#### Verify Payment
**Endpoint:** `POST /payment/verify`  
**Auth:** Required

**Request Body:**
```javascript
{
  "paymentId": "string",
  "orderId": "string",
  "razorpaySignature": "string",
  "examId": "string"
}
```

**Purpose:** Verify payment and grant access.

**Implementation Notes:**
- Signature verification for security
- Transaction-based access granting
- Bundle exam access creation
- Cache invalidation for user access

#### Check Exam Access
**Endpoint:** `GET /payment/check-access/:examId`  
**Auth:** Required

**Purpose:** Verify user's access to exam or bundle.

**Implementation Notes:**
- Bundle detection and verification
- Direct exam access checking
- Bundle-inherited access validation
- Access result caching