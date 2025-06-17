# Exam Portal Server

A comprehensive online examination platform built with Node.js, designed to handle high-concurrency exam scenarios with real-time features, secure payment integration, and advanced analytics.

## Overview

This exam portal server provides a complete backend solution for conducting online examinations. It supports multiple user roles, real-time exam taking, automated grading, payment processing for premium content, and comprehensive analytics. The system is optimized for high concurrency scenarios with support for 500+ simultaneous users.

## Key Features

### 🎯 **Core Functionality**
- **Multi-Role System**: Admin and Student roles with granular permissions
- **Exam Management**: Create, update, and manage exams with various question types
- **Real-Time Exam Taking**: Live timer synchronization and auto-submission
- **Question Types**: MCQ, Statement-based, True/False, Multiple Select
- **Automated Grading**: Instant results with detailed performance analytics
- **Bundle System**: Group multiple exams into discounted bundles

### 💳 **Payment & Access Control**
- **Premium Exams**: Paid access to premium content
- **Payment Integration**: Razorpay payment gateway integration
- **Bundle Pricing**: Discounted exam bundles with flexible pricing
- **Access Management**: Time-based access control for purchased content

### 📊 **Analytics & Reporting**
- **Performance Metrics**: Detailed student and exam analytics
- **Rankings System**: Automatic ranking and percentile calculation
- **Result Publications**: PDF generation and publication system
- **Admin Dashboard**: Comprehensive analytics and system monitoring

### ⚡ **Performance & Scalability**
- **High Concurrency**: Optimized for 1000+ simultaneous users
- **Redis Caching**: Multi-layer caching strategy for optimal performance
- **Rate Limiting**: Intelligent rate limiting based on operation type
- **Connection Pooling**: Enhanced MongoDB connection management
- **Queue System**: Asynchronous processing for heavy operations

## Technology Stack

### **Backend Framework**
- **Node.js** (v18+) - Runtime environment
- **Express.js** - Web application framework
- **MongoDB** - Primary database with Mongoose ODM
- **Redis** - Caching and session management

### **Authentication & Security**
- **Clerk** - Authentication and user management
- **JWT** - Token-based authentication
- **Rate Limiting** - Express-rate-limit for API protection
- **Input Sanitization** - Protection against XSS and injection attacks

### **Payment & File Storage**
- **Razorpay** - Payment gateway integration
- **Firebase Storage** - File storage for publications and assets
- **Multer** - File upload handling

### **Development & Monitoring**
- **ESLint + Prettier** - Code quality and formatting
- **Morgan** - HTTP request logging
- **Helmet** - Security headers
- **Compression** - Response compression

## Project Structure

```
src/
├── app.js                  # Main application configuration
├── index.js               # Server entry point
├── controllers/           # Request handlers organized by feature
│   ├── auth/
│   ├── exam/
│   ├── exam-attempt/
│   ├── question/
│   ├── payment/
│   ├── dashboard/
│   └── ...
├── models/                # MongoDB schemas
├── routes/                # API route definitions
├── middleware/            # Custom middleware
├── services/              # Business logic and external services
├── utils/                 # Helper functions and utilities
└── lib/                   # Database and external connections
```

## Quick Start

### Prerequisites
- Node.js (v18.0.0 or higher)
- MongoDB (v5.0 or higher)
- Redis (v6.0 or higher)
- Git

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd exam-portal-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Configuration**
Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/exam-portal
REDIS_URL=redis://localhost:6379

# Authentication (Clerk)
CLERK_PUBLISHABLE_KEY=your-clerk-publishable-key
CLERK_SECRET_KEY=your-clerk-secret-key

# Payment Gateway (Razorpay)
RAZORPAY_KEY_ID=your-razorpay-key-id
RAZORPAY_SECRET_KEY=your-razorpay-secret-key

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY=your-firebase-private-key
FIREBASE_CLIENT_EMAIL=your-firebase-client-email

# Client Configuration
CLIENT_URL=http://localhost:3000
```

4. **Start the development server**
```bash
npm run dev
```

The server will start on `http://localhost:5000`

### Production Deployment

```bash
npm run build
npm start
```

## API Documentation

Comprehensive API documentation is available in the `docs/api/` directory:

### 📚 **Core Documentation**
- **[API Overview](./docs/api/README.md)** - Complete API reference and developer guide
- **[Authentication & Authorization](./docs/api/authentication-authorization.md)** - Auth flow and role-based access
- **[Rate Limiting Strategy](./docs/api/rate-limiting-strategy.md)** - API rate limiting configuration
- **[Caching Architecture](./docs/api/caching-architecture.md)** - Redis caching implementation

### 🔗 **Endpoint Documentation**
- **[Bundle Exams API](./docs/api/endpoints/bundle-exams-api.md)** - Bundle management endpoints
- **[Dashboard API](./docs/api/endpoints/dashboard-api.md)** - Admin dashboard and analytics
- **[Exam Attempts API](./docs/api/endpoints/exam-attempts-api.md)** - Exam taking and submission
- **[Exams Management API](./docs/api/endpoints/exams-management-api.md)** - Exam CRUD operations
- **[Feedback API](./docs/api/endpoints/feedback-api.md)** - User feedback system
- **[Payment API](./docs/api/endpoints/payment-api.md)** - Payment processing
- **[Publications API](./docs/api/endpoints/publications-api.md)** - Result publications
- **[Questions Management API](./docs/api/endpoints/questions-management-api.md)** - Question CRUD operations
- **[Results API](./docs/api/endpoints/resulta-api.md)** - Student results and analytics
- **[User Management API](./docs/api/endpoints/user-management-api.md)** - User administration

## Key Features Deep Dive

### 🏆 **Exam System**
- **Question Types**: Support for MCQ, Statement-based, True/False, Multiple Select
- **Negative Marking**: Configurable negative marking system
- **Navigation Control**: Allow/restrict question navigation during exams
- **Multiple Attempts**: Configurable attempt limits per exam
- **Time Management**: Real-time timer with auto-submission

### 💰 **Payment Integration**
- **Premium Content**: Monetize exams with payment requirements
- **Bundle Discounts**: Create exam bundles with discounted pricing
- **Access Control**: Time-based access management for purchased content
- **Payment Verification**: Secure payment processing with Razorpay

### 📈 **Analytics & Performance**
- **Real-Time Monitoring**: Live system performance tracking
- **Student Analytics**: Detailed performance metrics and progress tracking
- **Exam Analytics**: Success rates, difficulty analysis, and trends
- **System Health**: Connection pool monitoring and resource utilization

### ⚡ **Scalability Features**
- **Redis Caching**: Multi-layer caching for optimal performance
- **Rate Limiting**: Operation-specific rate limiting (200-500 req/min)
- **Connection Pooling**: Enhanced MongoDB connection management (300 max connections)
- **Queue Processing**: Asynchronous handling of intensive operations

## Health Check

The server provides a comprehensive health check endpoint:

```
GET /health
```

Returns system status including:
- Database connectivity
- Redis connectivity  
- Memory usage
- CPU performance
- Connection pool status
- Application uptime

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 5000) | No |
| `NODE_ENV` | Environment mode | Yes |
| `MONGODB_URI` | MongoDB connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `CLERK_SECRET_KEY` | Clerk authentication secret | Yes |
| `RAZORPAY_KEY_ID` | Razorpay payment key | Yes |
| `RAZORPAY_SECRET_KEY` | Razorpay payment secret | Yes |
| `CLIENT_URL` | Frontend application URL | Yes |

## Performance Characteristics

### **Concurrency Support**
- **Simultaneous Users**: 1000+ concurrent exam takers
- **Rate Limits**: Operation-specific (200-500 requests/minute)
- **Connection Pool**: 300 MongoDB connections with monitoring
- **Caching**: Multi-layer Redis caching with TTL optimization

### **Response Times**
- **Exam Operations**: < 200ms (cached)
- **Question Fetching**: < 100ms (cached)
- **Answer Submission**: < 150ms
- **Result Generation**: < 2 seconds (async processing)

## Security Features

- **Authentication**: Clerk-based JWT authentication
- **Authorization**: Role-based access control (RBAC)
- **Rate Limiting**: Intelligent rate limiting per operation type
- **Input Validation**: Comprehensive request validation and sanitization
- **Payment Security**: Secure payment processing with signature verification
- **Data Protection**: MongoDB sanitization and XSS protection

## Contributing

Please refer to the API documentation in `docs/api/` for detailed information about endpoints, request/response formats, and implementation details.

## License

This project is proprietary software. All rights reserved.

---

**For detailed API documentation and implementation guides, please refer to the [API Documentation](./docs/api/README.md).**