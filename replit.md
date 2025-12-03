# Overview

This is a case management application for handling correspondence workflows. The system allows administrators to create and manage cases with unique access codes, while users can access their specific cases using these codes. Each case can have customized letter content and track user submissions. The application is built as a full-stack TypeScript application with a React frontend and Express backend, using PostgreSQL for data persistence.

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
The application uses six main tables:
- `cases`: Core case records with access codes, status tracking, user data, deposit addresses, and profile redirect URLs
- `case_letters`: Customizable letter content per case (headline, body, footer, options)
- `case_submissions`: Tracks user submissions for each case
- `chat_messages`: Real-time chat messages between admin and users
- `admin_messages`: Categorized admin notifications (urgent/processing/resolved) sent to users
- `deposit_receipts`: User-uploaded deposit receipt images with approval workflow

**User Portal Features**
- Dashboard-centric experience after login with card-based navigation
- Required Actions section with categorized admin messages (Urgent/Processing/Resolved)
- Personalized withdrawal letter with submission flow and ticket ID
- Deposit information display and receipt upload functionality
- Submission history view
- Real-time support chat with notification sounds

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

**API Structure**
- Route registration in `server/routes.ts`
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