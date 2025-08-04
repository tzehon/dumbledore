// Create indexes for user_comms collection
// Usage: npm run indexes

const { MongoClient } = require('mongodb');
const { performance } = require('perf_hooks');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;

async function createIndexes() {
    const client = new MongoClient(MONGO_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection('user_comms');
        
        console.log('🔧 Creating indexes for user_comms collection...\n');
        
        // Index 1: GetEligibleUserComms - Find all communications for a user
        console.log('1️⃣ Creating index for GetEligibleUserComms...');
        const startTime1 = performance.now();
        await collection.createIndex({ "user_id": 1 });
        const endTime1 = performance.now();
        console.log(`   ✅ Created: { "user_id": 1 } - ${Math.round(endTime1 - startTime1)}ms`);
        console.log('   📝 Supports: Find all docs for a specific user\n');
        
        // Index 2: GetScheduleSegment - Cursor-based pagination for campaign scheduling
        console.log('2️⃣ Creating compound index for GetScheduleSegment...');
        const startTime2 = performance.now();
        await collection.createIndex({ 
            "tracking_id": 1, 
            "template_id": 1, 
            "planned_date_hour": 1, 
            "user_id": 1 
        });
        const endTime2 = performance.now();
        console.log(`   ✅ Created: { "tracking_id": 1, "template_id": 1, "planned_date_hour": 1, "user_id": 1 } - ${Math.round(endTime2 - startTime2)}ms`);
        console.log('   📝 Supports: Campaign scheduling with cursor-based pagination\n');
        
        // Index 3: GetUserSchedule - Time-range queries with scoring (ESR optimized)
        console.log('3️⃣ Creating compound index for GetUserSchedule (ESR: Equality, Sort, Range)...');
        const startTime3 = performance.now();
        await collection.createIndex({ 
            "user_id": 1, 
            "final_score": -1, 
            "planned_date_hour": 1 
        });
        const endTime3 = performance.now();
        console.log(`   ✅ Created: { "user_id": 1, "final_score": -1, "planned_date_hour": 1 } - ${Math.round(endTime3 - startTime3)}ms`);
        console.log('   📝 Supports: User schedule queries with ESR pattern (Equality→Sort→Range)\n');
        
        // List all indexes to confirm
        console.log('📊 All indexes on user_comms collection:');
        const indexes = await collection.listIndexes().toArray();
        indexes.forEach((index, i) => {
            console.log(`   ${i + 1}. ${index.name}: ${JSON.stringify(index.key)}`);
        });
        
        console.log('\n✅ Index creation completed successfully!');
        console.log('💡 Note: Running npm run setup will drop the collection. You will need to run npm run indexes again to recreate these indexes.');
        
    } catch (error) {
        console.error('❌ Error creating indexes:', error.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

createIndexes();