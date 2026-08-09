# ExpiredIs — Backend API ⚙️

The server-side application for the ExpiredIs ecosystem — a web service designed for product expiration date tracking. Built with Node.js and Express, it provides a secure RESTful API, utilizes an SQLite database, and features automated daily background tasks for expiration monitoring.

---

## 🛠️ Tech Stack & Architecture

* **Runtime Environment:** Node.js
* **Backend Framework:** Express.js
* **Database:** SQLite (`sqlite3`)
* **Authentication:** Passport.js (`passport-jwt`) & `bcrypt` for password hashing
* **Security & Validation:** `express-validator` and `cors`
* **Automation:** `node-cron`
* **Email Service Integration:** Resend API

---

## ⏰ Background Automation (Cron Job)

The server includes a built-in background task scheduler powered by `node-cron` that manages the following automated workflow:
* **Schedule:** Runs automatically every single day.
* **Database Scan:** Scans the SQLite database to identify products expiring in exactly 3 days.
* **Notification:** Compiles a summary list and instantly delivers an email alert to the user via the Resend API integration.

---

## 🌐 API Endpoints

### Authentication (Public Routes)
* `POST /register` — Registers a new user account (includes data validation via `express-validator`).
* `POST /login` — Authenticates user credentials and returns a JWT bearer token upon success.

### Product Management (Protected Routes - Requires Passport JWT)
* `GET /items` — Retrieves a list of all products belonging to the authenticated user.
* `POST /items` — Adds a new product to the tracking catalog.
* `DELETE /items` — Removes a specific product from the database.

---

## 🚀 Getting Started (Local Setup)

### 1. Install Dependencies
Clone the repository and install all required node modules:
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory of the backend project and populate it with your configuration:
```env
PORT=5000
JWT_SECRET_KEY=your_super_secret_jwt_key
SALTED_ROUNDS=12
ALLOW_ORIGINS=http://localhost:5173,http://localhost:3000
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=ExpiredIs <noreply@yourdomain.com>
```

### 3. Start the Server
Launch the application server:
```bash
npm start
```
The server will boot up and become accessible locally at: `http://localhost:5000`
