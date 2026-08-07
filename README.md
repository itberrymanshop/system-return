# Return Management System

A comprehensive web-based system for tracking and managing product returns — from incoming goods through inspection, approval, and final disposition — built with **Node.js**, **Express**, **EJS**, and **MySQL**.

## Features

### Core Functionality
- **Item-Level Tracking**: Track each returned item individually with serial/batch numbers, condition, and disposition
- **Multi-Image Upload**: Attach multiple photos per item (JPEG, PNG, GIF, WebP; 5 MB limit each)
- **Return Flow Management**: Complete lifecycle — Pending → Inspecting → Approved → Processing → Completed / Rejected
- **Decision Tree**: Automated routing based on configurable business rules
- **Approval Matrix**: Role-based approval requirements based on value, category, and priority
- **Status History & Comments**: Full audit trail with timestamps and user attribution

### Monitoring & Analytics
- **Dashboard**: Real-time overview of return statistics and aging alerts
- **Aging Analysis**: Monitor processing times with color-coded alerts (Normal / Warning / Critical / Overdue)
- **Value Impact Report**: Financial breakdown — Open, Approved, Recovered (Completed), and Written-Off (Rejected) values
- **Summary Report**: Breakdown by status, category, priority, source type, and PIC performance
- **Activity Logs**: Complete audit trail accessible from the Admin panel
- **CSV Export**: Export any report table to CSV

### User Management
- **Role-Based Access Control**: Admin, Manager, Inspector, Warehouse, Viewer
- **PIC Assignment**: Person-In-Charge tracking per return
- **Activity Logging**: Every create, update, approve, and delete action is recorded

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Templating | EJS + express-ejs-layouts |
| Database | MySQL 5.7+ (mysql2 driver) |
| Auth | express-session + bcryptjs |
| File Upload | multer (disk storage) |
| UI | Bootstrap 5.3 + Bootstrap Icons |
| Dev | nodemon |

## Installation

### Prerequisites
- Node.js ≥ 18
- MySQL 5.7 or higher
- npm

### Setup Steps

1. **Clone / copy the project**
   ```bash
   cd /your/workspace
   git clone <repo-url> project-inventory-berryman
   cd project-inventory-berryman
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create the database**
   ```bash
   mysql -u root -p < sql/schema.sql
   ```

4. **Configure environment**

   Create a `.env` file in the project root:
   ```env
   PORT=3000
   NODE_ENV=development

   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=return_management_db

   SESSION_SECRET=change_this_to_a_long_random_string

   APP_NAME=Return Management System
   APP_TIMEZONE=Asia/Jakarta

   # Aging thresholds (days)
   AGING_NORMAL=3
   AGING_WARNING=7
   AGING_CRITICAL=14

   # Upload
   MAX_FILE_SIZE=5242880
   UPLOAD_PATH=uploads/
   ```

5. **Create the uploads directory**
   ```bash
   mkdir -p uploads/returns
   ```

6. **Apply any pending schema updates**
   ```bash
   mysql -u root -p return_management_db < sql/schema_updates.sql
   ```

7. **Start the server**
   ```bash
   # Production
   npm start

   # Development (auto-restart)
   npm run dev
   ```

8. **Access the application**
   - Navigate to: `http://localhost:3000`
   - Default login: Username `admin` / Password `admin123`

## Default Users

| Username    | Password  | Role      |
|-------------|-----------|-----------|
| admin       | admin123  | Admin     |
| manager1    | admin123  | Manager   |
| inspector1  | admin123  | Inspector |
| warehouse1  | admin123  | Warehouse |

> **Important**: Change these passwords before deploying to production.

## Configuration

All runtime settings are driven by environment variables (`.env`). Key options:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | *(required)* | Secret for session signing |
| `AGING_NORMAL` | `3` | Days before warning colour |
| `AGING_WARNING` | `7` | Days before critical colour |
| `AGING_CRITICAL` | `14` | Days before overdue colour |
| `MAX_FILE_SIZE` | `5242880` | Max upload size in bytes (5 MB) |

Application-level constants (statuses, pagination, etc.) are in [`config/config.js`](config/config.js).

## Return Status Flow

```
Pending → Inspecting → Approved → Processing → Completed
                    ↘ Rejected
```

## File Structure

```
project-inventory-berryman/
├── config/
│   ├── config.js           # App constants & defaults
│   └── database.js         # MySQL connection pool
├── controllers/            # Route handler logic
│   ├── adminController.js
│   ├── approvalsController.js
│   ├── authController.js
│   ├── dashboardController.js
│   ├── profileController.js
│   ├── reportsController.js
│   └── returnsController.js
├── middleware/
│   ├── auth.js             # Session locals, RBAC guards, view helpers
│   └── errorHandler.js     # 404 / 500 handlers
├── routes/                 # Express routers
├── services/               # DB access layer
│   ├── approvalService.js
│   ├── reportService.js
│   ├── returnService.js
│   └── userService.js
├── sql/
│   ├── schema.sql          # Full initial schema
│   └── schema_updates.sql  # Incremental migrations
├── views/                  # EJS templates
│   ├── admin/
│   ├── approvals/
│   ├── auth/
│   ├── dashboard/
│   ├── errors/
│   ├── layouts/
│   ├── partials/
│   ├── profile/
│   ├── reports/
│   └── returns/
├── public/                 # Static assets (CSS, JS)
├── uploads/                # Uploaded item photos
│   └── returns/
├── app.js                  # Express app setup
├── server.js               # Entry point (DB check + listen)
└── package.json
```

## Database Schema

### Main Tables

| Table | Description |
|-------|-------------|
| `users` | User accounts and roles |
| `returns` | Main return records |
| `return_items` | Per-item tracking (includes `image_path TEXT` for JSON photo array) |
| `return_status_history` | Complete status audit trail |
| `return_comments` | Notes and comments per return |
| `return_attachments` | File attachment metadata |
| `approval_matrix` | Approval rule configuration |
| `decision_tree` | Automated routing rules |
| `activity_logs` | System-wide action audit log |

## Security

- Passwords hashed with **bcrypt**
- Parameterised queries via mysql2 — no SQL injection risk
- Session-based authentication with configurable secret
- Role-based route guards on all protected endpoints
- File upload validation (MIME type + 5 MB size limit)
- XSS protection via EJS auto-escaping (`<%= %>`)

## Troubleshooting

### Database connection fails on startup
- Verify MySQL is running
- Double-check `.env` credentials
- Ensure `return_management_db` exists (`mysql < sql/schema.sql`)

### `Unknown column 'image_path'` error
Run the incremental migration:
```bash
mysql -u root -p return_management_db < sql/schema_updates.sql
```
Or manually via Node.js:
```bash
node -e "require('./config/database').query('ALTER TABLE return_items ADD COLUMN image_path TEXT DEFAULT NULL').then(() => process.exit(0))"
```

### Uploaded images not showing
Ensure the `uploads/returns/` directory exists and is writable:
```bash
mkdir -p uploads/returns
chmod 755 uploads/returns
```

### Cannot login
- Confirm the database seed data was imported with `sql/schema.sql`
- Clear browser cookies / session storage
- Check `SESSION_SECRET` is set in `.env`

## Roadmap

- [ ] Email notifications on status change
- [ ] Advanced search & filtering on list views
- [ ] Barcode / QR scanning integration
- [ ] Automated report scheduling (cron)
- [ ] REST API for external integrations
- [ ] Multi-language support
- [ ] Mobile-responsive improvements

## License

Internal use only. Proprietary software for Berryman inventory management.

## Version

**1.0.0** — March 2026

