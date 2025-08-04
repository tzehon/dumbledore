# Dumbledore - Database Tools

This repository contains database management and benchmarking tools for the user communications collection.

## 1. Project Overview

This project provides database tools for managing the `user_comms` MongoDB collection:
* **Setup Script (`setup.js`)**: Initializes the database and populates it with realistic user communication data
* **Index Creation (`create-indexes.js`)**: Creates optimized indexes for the Go DAO query operations
* **Stats Script (`stats.js`)**: Calculates and displays detailed storage statistics for the database
* **MongoDB Benchmark (`benchmark-mongodb.js`)**: Performance testing for MongoDB queries matching the Go DAO operations

## 2. Prerequisites

Before you begin, ensure you have the following installed:
* **Node.js and npm:** [Download Node.js](https://nodejs.org/) (npm is included)
* **MongoDB:** A running MongoDB instance. This can be a local installation ([MongoDB Community Server](https://www.mongodb.com/try/download/community)) or a cloud instance ([MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register))

## 3. Project Structure
```
dumbledore/
└── backend/
    ├── .env              # Your environment variables (you will create this)
    ├── benchmark-mongodb.js  # MongoDB performance benchmarking
    ├── create-indexes.js # Index creation for optimal query performance
    ├── package.json      # Dependencies and scripts
    ├── setup.js          # Database setup and data seeding
    └── stats.js          # Database statistics
```

## 4. Setup Instructions

### Step 4.1: Install Dependencies

1. **Navigate to the Backend Directory:**
   ```bash
   cd backend
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

### Step 4.2: Configure Environment Variables

Create a new file named `.env` in the `backend` directory:

**For Local MongoDB:**
```
MONGO_URI="mongodb://localhost:27017"
DB_NAME="smartcomms"
```

**For MongoDB Atlas (Cloud):**
```
MONGO_URI="mongodb+srv://your_username:your_password@your_cluster.mongodb.net/?retryWrites=true&w=majority&appName=your_app_name"
DB_NAME="smartcomms"
```

**⚠️ Security Note:** Never commit your actual `.env` file to version control.

## 5. Database Management Tools

### Setup Script - Generate User Communications Data

The setup script generates realistic `user_comms` documents with the following structure:
- `_id`: Composite key of `user_id_tracking_id_template_id`
- `user_id`: User identifier (e.g., "P_user001")
- `tracking_id`: Campaign tracking UUID
- `template_id`: Template identifier
- `content_end_time`: Random future date (1-4 weeks from now)
- `created_at`, `updated_at`: Timestamps
- `dispatch_time`: Array of 7 timestamps
- `final_score`: Score between 0.6-1.0
- `relevance_score`: Score between 0.4-0.6
- `planned_date_hour`: Planned delivery time
- `sent_at`: Delivery status (0 or 1)

**Generate Specific Number of Documents:**
```bash
npm run setup:docs -- 1000      # Generate 1,000 documents
npm run setup:docs -- 50000     # Generate 50,000 documents
npm run setup:docs -- 500000    # Generate 500,000 documents
```

**Reset Mode (Default)** - Completely reset the database to a clean state:
```bash
npm run setup        # Default: 1M documents (reset mode)
npm run setup:reset  # Default: 1M documents (explicit reset mode)
```

**Append Mode** - Add more documents to existing data:
```bash
npm run setup:append  # Default: 1M additional documents
```

### Index Creation Script - Optimize Query Performance

Create the required indexes for optimal Go DAO query performance:
```bash
npm run indexes
```

**Creates 3 optimized indexes:**
1. `{ "user_id": 1 }` - GetEligibleUserComms
2. `{ "tracking_id": 1, "template_id": 1, "planned_date_hour": 1, "user_id": 1 }` - GetScheduleSegment
3. `{ "user_id": 1, "final_score": -1, "planned_date_hour": 1 }` - GetUserSchedule (ESR pattern)

**Note:** Fresh data seeding (`npm run setup`) drops the collection, so indexes need to be recreated after seeding.

### Stats Script - View Database Statistics

After running the setup script, view detailed storage information:
```bash
npm run stats
```

This shows:
- Collection size and document count
- Index sizes and usage
- Storage breakdown
- Performance metrics

## 6. Performance Benchmarking

### MongoDB Benchmark

Test the performance of database queries that match the Go DAO operations:

```bash
npm run benchmark:mongodb
```

**Benchmark Queries Tested:**
1. **GetEligibleUserComms** - Find all communications for a user
2. **GetScheduleSegment** - Cursor-based pagination for campaign scheduling
3. **GetUserSchedule** - Time-range queries with scoring

**Features:**
- Tests pure MongoDB query performance (no HTTP overhead)
- Connects directly to MongoDB
- Measures execution time with `explain("executionStats")`
- Generates detailed performance reports
- Interactive prompts for collection context

**Output:**
- Console performance summary
- Markdown report saved as `mongodb_<tier>_<doc_count>.md`
- Percentile breakdown (P50, P90, P95, P99)
- Both total latency and MongoDB-only execution time

## 7. Data Model

The `user_comms` collection uses a flat document structure optimized for the Go DAO operations:

```json
{
  "_id": "P_user001_uuid-tracking-id_template-uuid-abc",
  "user_id": "P_user001",
  "tracking_id": "550e8400-e29b-41d4-a716-446655440000",
  "template_id": "template_abc12345-001",
  "content_end_time": "2025-08-15T10:30:00.000Z",
  "created_at": "2025-08-01T12:00:00.000Z",
  "updated_at": "2025-08-01T12:05:00.000Z",
  "dispatch_time": [1722513600000, 1722513610000, ...],
  "final_score": 0.73,
  "relevance_score": 0.52,
  "planned_date_hour": "2025-08-01T15:00:00.000Z",
  "sent_at": 0
}
```

## 8. Recommended Workflow

For optimal performance testing and analysis, follow this workflow:

```bash
# 1. Generate your desired amount of test data
npm run setup:docs -- 1000000    # Seed 1M documents (or your preferred amount)

# 2. Create optimized indexes for the DAO operations  
npm run indexes                   # Create the 3 required indexes

# 3. Test query performance with proper indexing
npm run benchmark:mongodb         # Benchmark with explain plans showing index usage

# 4. Analyze storage and index efficiency
npm run stats                     # View collection size and index statistics
```

**Why this order matters:**
- Data seeding first ensures realistic document distribution for index creation
- Indexes must be created after seeding since `setup` drops the collection
- Benchmarking after indexing shows optimal performance with proper index usage
- Stats at the end provides storage analysis including index overhead

## 9. Command Summary

**Database Setup:**
```bash
npm run setup:docs -- 1000     # Generate 1,000 documents
npm run setup:docs -- 500000   # Generate 500,000 documents
npm run setup                  # Default: 1M documents (reset)
npm run setup:append           # Add 1M more documents
```

**Index Creation:**
```bash
npm run indexes                # Create optimized indexes for DAO queries
```

**Database Statistics:**
```bash
npm run stats                  # View collection and index stats
```

**Performance Benchmarking:**
```bash
npm run benchmark:mongodb      # Test MongoDB query performance
```

## 9. Optimization Notes

- **Composite _id**: Eliminates need for separate unique index on user_id+tracking_id+template_id
- **Flat Structure**: Avoids complex nested queries and aggregations
- **Pre-generated Data**: Template and tracking IDs are fully randomized per document
- **Realistic Timestamps**: Content end times are future dates, created/updated times follow logical progression
- **Cursor Pagination**: GetScheduleSegment implements efficient cursor-based pagination

The tools are designed to generate realistic data volumes and test patterns that match production Go DAO usage.