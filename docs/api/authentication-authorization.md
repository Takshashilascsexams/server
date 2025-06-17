## Authentication & Authorization

### Authentication Flow
```javascript
// Middleware: verifyUserIsSignedIn
// Location: /middleware/authMiddleware.js
// Uses Clerk for JWT verification
```

**Authentication Headers:**
```http
Authorization: Bearer <clerk_jwt_token>
```

**User Roles:**
- `Student` - Basic exam taking capabilities
- `Admin` - Full system management access

### Role-Based Access Control
```javascript
// Admin-only routes use additional middleware
router.use(verifyUserIsSignedIn, verifyUserIsAdmin, apiLimiter);
```