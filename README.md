# Dumbledore - SmartComms - README

This document provides a complete guide to setting up, running, and managing the full-stack application for Dumbledore.

## 1. Project Overview

This project consists of three main parts:
* **Backend:** A Node.js server using the Express framework that provides a REST API to interact with the MongoDB database.
* **Frontend:** A React application built with Vite that provides a user interface for internal teams to look up user communication history and analyze campaign data.
* **Database Scripts:** Standalone Node.js scripts for managing the database:
    * `setup.js`: Initializes the database schema and populates it with sample data.
    * `stats.js`: Calculates and displays detailed storage statistics for the database.

## 2. Prerequisites

Before you begin, ensure you have the following installed on your system:
* **Node.js and npm:** [Download Node.js](https://nodejs.org/) (npm is included).
* **MongoDB:** A running MongoDB instance. This can be a local installation ([MongoDB Community Server](https://www.mongodb.com/try/download/community)) or a cloud instance ([MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)).

## 3. Project Structure
```
communications-dashboard/
├── backend/
│   ├── node_modules/
│   ├── .env              # Your environment variables (you will create this)
│   ├── db.js             # Handles database connection for the server
│   ├── package.json      # Backend dependencies and scripts
│   ├── server.js         # The main Express API server
│   └── setup.js          # Standalone script for DB setup and data seeding
└── frontend/
├── node_modules/
├── public/
├── src/
│   └── App.jsx       # Main React component
└── package.json      # Frontend dependencies and scripts
```

## 4. Setup Instructions

Follow these steps to get the project ready to run.

### Step 4.1: Backend Setup

1.  **Navigate to the Backend Directory:**
    Open your terminal and change into the `backend` directory.
    ```bash
    cd path/to/your/project/backend
    ```

2.  **Install Dependencies:**
    Run `npm install` to download all the required packages listed in `package.json`.
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a new file named `.env` in the `backend` directory. This file will store your database connection string securely.
    * If you are running MongoDB locally, the content should be:
        ```
        MONGO_URI="mongodb://localhost:27017"
        DB_NAME="comms_db"
        ```
    * If you are using MongoDB Atlas, replace the `MONGO_URI` value with your Atlas connection string.

### Step 4.2: Frontend Setup

1.  **Navigate to the Frontend Directory:**
    Open a **new, separate terminal window** and change into the `frontend` directory.
    ```bash
    cd path/to/your/project/frontend
    ```

2.  **Install Dependencies:**
    Run `npm install` to download all the required packages for the React application.
    ```bash
    npm install
    ```

## 5. Database Management

The `backend` directory contains two scripts for managing your development database.

### To Set Up and Seed the Database (Setup & Teardown)

This command will completely reset the database to a clean, seeded state.

* In your **backend terminal**, run the following command:
    ```bash
    node setup.js
    ```
* Wait for the script to complete. You can run this command as many times as you need.

### To View Database Statistics

After the setup script has finished, you can run this command to see a detailed breakdown of data and index sizes.

* In your **backend terminal**, run:
    ```bash
    node stats.js
    ```

## 6. Running the Application

To run the application, you need to have both the backend and frontend servers running simultaneously in their respective terminals.

### Step 6.1: Start the Backend Server

1.  In your **backend terminal** (`communications-dashboard/backend`), run:
    ```bash
    node server.js
    ```
2.  You should see the confirmation message: `Server running on http://localhost:5001`.
3.  **Leave this terminal running.**

### Step 6.2: Start the Frontend Server

1.  In your **frontend terminal** (`communications-dashboard/frontend`), run:
    ```bash
    npm run dev
    ```
2.  The terminal will display a local URL for the frontend, typically `http://localhost:5173`.
3.  **Leave this second terminal running.**

### Step 6.3: View the Application

1.  Open your web browser.
2.  Navigate to the frontend URL (e.g., **http://localhost:5173**).

You should now see the "Dumbledore - SmartComms" running in your browser.

---
## Summary of Commands

**To reset the database:**
```bash
# In ./backend terminal
node setup.js
```

**To view database stats:**
```bash
# In ./backend terminal
node stats.js
```

**To run the app:**
```bash
# In ./backend terminal
node server.js

# In ./frontend terminal
npm run dev
```