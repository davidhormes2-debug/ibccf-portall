# Overview

This is an enterprise-grade secure customer portal for the **International Blockchain Community Complaints Forum (IBCCF)** with comprehensive case management and correspondence workflows. The system allows administrators to create and manage cases with unique access codes, while users can access their specific cases using these codes. Each case features customized letter content, three-stage required actions (Urgent→Processing→Resolved), and 40+ premium enterprise features. The application is built as a full-stack TypeScript application with a React frontend and Express backend, using PostgreSQL for data persistence.

## Routing Structure
- **/** - Public landing page with IBCCF branding, hero section, 3-step fraud reporting process, privacy section
- **/verify** - Secure verification portal for access code entry
- **/request-access** - Access key request and status check page
- **/dashboard** - User portal (requires valid access code)
- **/admin** - Admin control panel

## Branding
- **Color Scheme:** Primary #004182, Accent #004AB3
- **Icons:** Shield icons from lucide-react (no external logo images)
- **Fonts:** Public Sans (body), Merriweather (headings)

## Admin Access
- **Username:** Admin2025
- **Password:** Admin123456789
- **Demo User Code:** 774982

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Framework & Build System**
- React with TypeScript using Vite as the build tool
- Single Page Application (SPA) with client-side routing via Wouter
- Component library based on Radix UI primitives with shadcn/ui styling system
- Tailwind CSS for styling with custom theme configuration

**State Management**
- TanStack Query (React Query) for server state management and data fetching
- Local component state using React hooks
- Form handling with React Hook Form and Zod validation

**Key Design Patterns**
- Component composition using Radix UI slot pattern
- Custom hooks for reusable logic (e.g., `use-mobile`, `use-toast`)
- Path aliases for clean imports (`@/`, `@shared/`, `@assets/`)

**UI/UX Approach**
- Responsive design with mobile-first approach
- Print-optimized layouts for letter generation
- Motion animations using Framer Motion for enhanced user experience
- Toast notifications for user feedback

## Backend Architecture

**Server Framework**
- Express.js with TypeScript
- HTTP server created via Node's native http module
- RESTful API design with JSON payloads

**Database Layer**
- Drizzle ORM for type-safe database operations
- PostgreSQL as the primary database (via Neon serverless driver)
- Schema-first approach with Drizzle Kit for migrations
- Zod schemas for runtime validation matching database schema

**Data Model**
The application uses the following main tables:

*Core Tables:*
- `cases`: Core case records with access codes, status tracking, user data, deposit addresses, and profile redirect URLs
- `case_letters`: Customizable letter content per case (headline, body, footer, options)
- `case_submissions`: Tracks user submissions for each case
- `chat_messages`: Real-time chat messages between admin and users
- `admin_messages`: Categorized admin notifications (urgent/processing/resolved) sent to users
- `deposit_receipts`: User-uploaded deposit receipt images with approval workflow
- `access_key_requests`: User requests for access keys with admin messaging, approval workflow, and 7-day auto-expiration

*Enterprise Security Tables:*
- `admin_sessions`: Secure session management for admin users with device tracking and geolocation
- `admin_two_factor`: TOTP-based 2FA configuration for admin accounts with backup codes
- `audit_logs`: Complete audit trail of all admin actions for compliance

*Productivity Tables:*
- `chat_templates`: Quick response templates organized by category for chat replies
- `case_notes`: Internal admin notes attached to cases with pinning support
- `translations`: Multi-language support with key-value translations per locale
- `message_templates`: Reusable message templates for admin communications
- `scheduled_messages`: Time-delayed message delivery system
- `help_articles`: Knowledge base articles for user self-service
- `notifications`: System notifications for admin and users
- `user_feedback`: User satisfaction ratings and comments
- `document_requests`: Document request and upload tracking
- `user_sessions`: User portal session tracking with device info

## Enterprise Features

**Security & Access Control**
1. Two-Factor Authentication (2FA) - TOTP-based authentication with backup codes
2. Admin Session Management - Track and revoke active admin sessions
3. User Session Viewer - Monitor and terminate user portal sessions
4. Audit Logs - Complete trail of admin actions for compliance

**Communication & Messaging**
5. Notification Center - Bell icon with real-time alerts and unread counts
6. Scheduled Messages - Time-delayed message delivery system
7. Message Templates - Reusable admin message templates
8. Chat Templates - Quick response templates for support chat

**Content & Localization**
9. Translation Manager - Multi-language support (EN, ES, ZH, JA, KO, DE, FR)
10. Help Center - Knowledge base articles organized by category

**User Management**
11. Admin Users - Role-based access control (super_admin, admin, agent, viewer)
12. User Feedback - Star ratings (1-5) with comments from users
13. Document Requests - Request and track document uploads from users

**User Portal Features**
- Dashboard-centric experience after login with card-based navigation
- Required Actions section with categorized admin messages (Urgent/Processing/Resolved)
- Personalized withdrawal letter with submission flow and ticket ID
- Deposit information display and receipt upload functionality
- Submission history view
- Real-time support chat with notification sounds
- **Withdrawal Progress Tracker** - Admin-controlled 7-stage progress display with activity deposit messaging:
  - Stage 1: Withdrawal Process Initiated
  - Stage 2: First Stage Verification Completed
  - Stage 3: Financial Department Verification
  - Stage 4: Miners Department
  - Stage 5: Money Laundry Funds Check
  - Stage 6: Final Withdrawal Processing
  - Stage 7: Withdrawal Now Released

**Real-time Features**
- Chat messaging between admin and users with notification sounds
- Admin receives notifications for: new user registrations, submissions, and chat messages
- Categorized admin messages with blinking indicators for urgent items
- 3-minute session timeout with automatic logout on inactivity
- Polling-based updates (3s for data, 5s for chat unread counts)

**Storage Pattern**
- Repository pattern implemented via `IStorage` interface
- `DatabaseStorage` class provides concrete implementation
- All database operations return strongly-typed objects
- Transaction support through Drizzle ORM

**Modular Architecture (Refactored)**

*Frontend Structure:*
- `client/src/lib/api/` - Typed API layer with React Query hooks
- `client/src/hooks/` - Custom hooks (useSessionTimeout, useNotificationSound, usePolling, etc.)
- `client/src/components/portal/` - Reusable portal components (ChatWidget, MessageCard, ProgressStepper, etc.)
- `client/src/pages/portal/` - Split portal pages (LoginPage, DashboardPage, MessagesPortal, etc.)
- `client/src/lib/constants.ts` - Stage definitions, API endpoints, messages
- `client/src/lib/validation.ts` - Centralized Zod validation schemas

*Backend Structure:*
- `server/routes/` - Feature-based routers (casesRouter, messagesRouter, adminRouter, depositsRouter)
- `server/services/` - Business logic layer (CaseService, MessageService, NotificationService)
- `server/middleware/` - Security middleware (rate limiting, CORS, security headers, input sanitization)

*Shared Structure:*
- `shared/schema.ts` - Drizzle schema definitions with Zod insert schemas
- `shared/types.ts` - Centralized TypeScript interfaces for all data models

**Security Features**
- Rate limiting with configurable windows and limits
- Security headers (X-Content-Type-Options, X-Frame-Options, CSP, etc.)
- Input sanitization for XSS prevention
- CORS configuration with allowed origins
- 3-minute session timeout with automatic logout

**Accessibility**
- ARIA labels on all interactive elements
- Role attributes for semantic structure (dialog, progressbar, list, feed)
- aria-live regions for dynamic content updates
- Keyboard navigation support
- Screen reader compatibility

**Error Handling**
- ErrorBoundary components for graceful error recovery
- Centralized error handling utilities
- Loading states with skeleton components
- Toast notifications for user feedback

**API Structure**
- Route registration in `server/routes.ts` with modular routers
- CRUD operations for cases and submissions
- Access code-based authentication for user access
- Admin vs. user endpoint separation

**Development vs. Production**
- Development mode uses Vite middleware for HMR
- Production mode serves pre-built static assets
- Custom build script bundles server with esbuild for optimized cold starts
- Selective bundling of heavy dependencies into server bundle

## External Dependencies

**Database Service**
- Neon Serverless PostgreSQL (`@neondatabase/serverless`)
- Connection via DATABASE_URL environment variable
- Drizzle ORM (`drizzle-orm`) for query building
- Drizzle Kit for schema management and migrations

**UI Component Libraries**
- Radix UI primitives for accessible, unstyled components
- Extensive use of Radix components (Dialog, Dropdown, Select, Toast, etc.)
- Lucide React for icons
- Embla Carousel for carousel functionality

**Styling & CSS**
- Tailwind CSS with custom configuration
- PostCSS for CSS processing
- Custom Tailwind plugins and theme extensions
- CSS variables for theming

**Form Handling & Validation**
- React Hook Form for form state management
- Zod for schema validation
- `@hookform/resolvers` for integrating Zod with React Hook Form
- `drizzle-zod` for generating Zod schemas from Drizzle tables

**Development Tools (Replit-specific)**
- `@replit/vite-plugin-runtime-error-modal` for error overlays
- `@replit/vite-plugin-cartographer` for development features
- `@replit/vite-plugin-dev-banner` for development banner
- Custom meta images plugin for OpenGraph image handling

**Build & Deployment**
- Vite for frontend bundling
- esbuild for server bundling
- TypeScript compiler for type checking
- Custom build script that coordinates client and server builds

**Utilities**
- `class-variance-authority` for component variant management
- `clsx` and `tailwind-merge` for className utilities
- `date-fns` for date formatting
- `nanoid` for generating unique IDs