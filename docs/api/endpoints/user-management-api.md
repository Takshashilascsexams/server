## User Management API

*All user management endpoints require admin authentication*

### Get All Users
**Endpoint:** `GET /users/`  
**Auth:** Admin Required

**Query Parameters:**
```javascript
{
  "page": number,
  "limit": number,
  "sortBy": "createdAt|fullName|email|phoneNumber|category|role",
  "sortOrder": "asc|desc",
  "role": "string",
  "category": "string",
  "district": "string",
  "search": "string"
}
```

**Purpose:** User management dashboard.

### Get User by ID
**Endpoint:** `GET /users/:id`  
**Auth:** Admin Required

**Purpose:** User details for admin view.

---

## Profile API

### Get Profile
**Endpoint:** `GET /profile/`  
**Auth:** Required

**Purpose:** Current user's profile information.

### Update Profile
**Endpoint:** `PATCH /profile/`  
**Auth:** Required

**Request Body:**
```javascript
{
  "fullName": "string",
  "phoneNumber": "string",
  "dateOfBirth": "string"
}
```

**Purpose:** Update user profile information.