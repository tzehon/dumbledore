# Dumbledore - SmartComms - README

This document provides a complete guide to setting up, running, and managing the full-stack application for Dumbledore.

## 1. Project Overview

This project consists of three main parts:
* **Backend:** A Node.js server using the Express framework that provides a REST API to interact with the MongoDB database.
* **Frontend:** A React application built with Vite that provides a user interface for internal teams to look up user communication history and analyze campaign data. Features include:
    * Real-time API request timing display showing duration and type (READ/WRITE) for each operation
    * User communication lookup and management
    * Campaign analysis tools with pagination
    * Communication status updates and bulk operations
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
    Create a new file named `.env` in the `backend` directory by copying from the example template:
    ```bash
    cp .env.example .env
    ```
    
    Then edit `.env` with your actual database configuration:
    
    **For Local MongoDB:**
    ```
    MONGO_URI="mongodb://localhost:27017"
    DB_NAME="comms_db"
    ```
    
    **For MongoDB Atlas (Cloud):**
    Replace the `MONGO_URI` value with your Atlas connection string:
    ```
    MONGO_URI="mongodb+srv://your_username:your_password@your_cluster.mongodb.net/?retryWrites=true&w=majority&appName=your_app_name"
    DB_NAME="comms_db"
    ```
    
    **⚠️ Security Note:** Never commit your actual `.env` file to version control. The `.gitignore` file is configured to exclude it automatically.

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

### To Set Up and Seed the Database

**Reset Mode (Default)** - Completely reset the database to a clean, seeded state:
* In your **backend terminal**, run:
    ```bash
    npm run setup        # Default: reset mode
    npm run setup:reset  # Explicit reset mode
    ```

**Append Mode** - Add more users to existing data without dropping the collection:
* In your **backend terminal**, run:
    ```bash
    npm run setup:append
    ```
* This will find the highest existing user ID and continue from there
* Useful for gradually increasing your dataset size for testing

### To View Database Statistics

After the setup script has finished, you can run this command to see a detailed breakdown of data and index sizes.

* In your **backend terminal**, run:
    ```bash
    npm run stats
    ```

## 6. Running the Application

To run the application, you need to have both the backend and frontend servers running simultaneously in their respective terminals.

### Step 6.1: Start the Backend Server

**Production Mode (Optimized Performance):**
```bash
npm run prod
```
- Minimal logging for optimal performance
- Runs on: `http://localhost:5001`
- Shows: `Server running on http://localhost:5001 (PRODUCTION MODE)`

**Development Mode (Full Debug Information):**
```bash
npm run dev
```
- Complete query logging and analysis
- Database explain() output for optimization
- Runs on: `http://localhost:5002`
- Shows: `Server running on http://localhost:5002 (DEV MODE)`

### Step 6.2: Start the Frontend Server

**Development Mode (Full Timing Breakdown):**
```bash
npm run dev
```
- Shows detailed timing breakdown: Database + Backend + Frontend
- Full error logging and debug information
- Shows "DEV MODE" indicator in header
- Connects to backend on port 5002
- Frontend URL: `http://localhost:5173`

**Production Mode (Optimized Performance):**
```bash
npm run prod
```
- Shows end-to-end total latency only
- Minimal logging for better performance
- Clean interface without dev indicators
- Connects to backend on port 5001
- Frontend URL: `http://localhost:5174`

### Step 6.3: View the Application

1.  Open your web browser.
2.  Navigate to the appropriate frontend URL:
    - **Development Mode**: http://localhost:5173
    - **Production Mode**: http://localhost:5174

You should now see the "Dumbledore - SmartComms" running in your browser.

## 7. Performance Timing Breakdown

The application includes comprehensive timing tracking to help identify performance bottlenecks across the full stack. Here's what each timing measurement represents:

### Database Layer (MongoDB)
- **Query execution time** - Time spent executing MongoDB operations (`findOne`, `aggregate`, `updateOne`, etc.)
- **Index lookups and scanning** - Time spent traversing indexes and scanning documents
- **Document retrieval** - Time spent retrieving documents from disk/memory
- **Aggregation processing** - Time spent processing aggregation pipelines (like `$sample` for random results)

### Backend Processing (Node.js/Express)
- **JSON parsing/serialization** - Converting MongoDB results to JSON responses
- **Request validation** - Checking required parameters and parsing query strings
- **Date/time processing** - Converting date strings to Date objects and timezone handling
- **Object construction** - Building MongoDB query objects and update operations
- **Response header setting** - Adding timing and CORS headers
- **Network I/O** - Receiving request body and sending response data
- **JavaScript execution** - Function calls, variable assignments, and business logic

### Frontend Processing (React)
- **Network request overhead** - `fetch()` call setup and HTTP connection establishment
- **JSON parsing** - Converting API responses to JavaScript objects
- **State updates** - React `setState` calls that trigger component re-renders
- **DOM updates** - Re-rendering components when state changes
- **Event handling** - Processing user interactions (clicks, form submissions)
- **JavaScript execution** - Function calls, array operations, and string manipulation
- **React reconciliation** - Virtual DOM diffing and real DOM updates

### Timing Modes

**Development Mode:**
- Shows detailed breakdown: Database + Backend + Frontend timing
- Helps identify which layer is causing performance issues
- Full error logging and debug information

**Production Mode:**
- Shows optimized end-to-end total latency only
- Minimal overhead for maximum performance
- Clean interface without debug details

### Using Timing Data

The separate timing measurements help identify bottlenecks:
- **High database time** → Query optimization or indexing needed
- **High backend processing** → Server-side logic optimization required  
- **High frontend time** → Client-side rendering or state management issues

---
## Summary of Commands

**To reset the database:**
```bash
# In ./backend terminal
npm run setup        # Default: reset (same as setup:reset)
npm run setup:reset  # Drop collection and reseed from scratch
```

**To append more data:**
```bash
# In ./backend terminal
npm run setup:append # Add more users to existing data
```

**To view database stats:**
```bash
# In ./backend terminal
npm run stats
```

**To run performance benchmarks:**

**HTTP + Database Benchmarking:**
```bash
# Terminal 1: Start production server
npm run prod

# Terminal 2: Run HTTP benchmark  
npm run benchmark
```

**MongoDB-Only Benchmarking:**
```bash
# In ./backend terminal (no server needed)
npm run benchmark:mongodb
```

**Available benchmark commands:**
- `npm run benchmark` - Full HTTP + MongoDB timing (requires server running)
- `npm run benchmark:mongodb` - Pure MongoDB timing only (no server needed)

The MongoDB-only benchmark:
- Connects directly to MongoDB (no Express server needed)
- Measures pure database query performance  
- Tests the same queries as the HTTP benchmark
- Generates reports with `mongodb_` prefix

**To run the app:**

**Production Mode (Optimized):**
```bash
# In ./backend terminal
npm run prod

# In ./frontend terminal  
npm run prod
```

**Development Mode (Full Debug):**
```bash
# In ./backend terminal
npm run dev

# In ./frontend terminal
npm run dev
```