// This is a standalone script to set up and seed the database.

const { MongoClient, ObjectId } = require('mongodb');
const { faker } = require('@faker-js/faker');
const { performance } = require('perf_hooks');
require('dotenv').config();

const MONGO_URI_SETUP = process.env.MONGO_URI;
const DB_NAME_SETUP = process.env.DB_NAME;

// --- Production scale numbers from PDF added for reference ---
const NUM_USERS_PRODUCTION = 50000000;
const COMMS_PER_USER_PER_DAY = 5;

// --- Development Scale Parameters ---
const NUM_USERS_TO_GENERATE = 50000000;
const DAYS_OF_DATA_TO_GENERATE = 3; // Align with 3-day retention policy
const BATCH_SIZE = 10000; // Insert documents in batches of this size

const USER_TYPES = ["premium", "standard", "trial"];
const TEMPLATES = Array.from({ length: 20 }, (_, i) => `template_${String(i + 1).padStart(3, '0')}`);
const TRACKING_IDS = Array.from({ length: 10 }, (_, i) => `track_${String(i + 1).padStart(3, '0')}`);
const STATUSES = ["sent", "failed", "opened", "clicked"];

async function setupAndSeedDatabase() {
    const setupClient = new MongoClient(MONGO_URI_SETUP);
    try {
        await setupClient.connect();
        const db = setupClient.db(DB_NAME_SETUP);
        console.log("Connected to MongoDB for setup...");

        // 1. Setup Database Schema
        console.log("Setting up database collection and indexes...");
        try {
            await db.collection('communications').drop();
            console.log("Dropped existing communications collection.");
        } catch (e) {
            if (e.codeName !== 'NamespaceNotFound') {
                console.warn("Could not drop collection (it may not exist):", e.message);
            }
        }

        const communicationsCollection = db.collection('communications');

        // Create indexes for the new model
        await communicationsCollection.createIndex({ "user.id": 1, day: 1 });
        console.log("-> Created primary compound index for user/day lookups.");

        await communicationsCollection.createIndex({
            "day": 1,
            "events.metadata.template_id": 1,
            "events.metadata.tracking_id": 1,
            "events.dispatch_time": 1
        });
        console.log("-> Created compound index for campaign lookups (distinct).");

        await communicationsCollection.createIndex({
            "user.id": 1,
            "events.dispatch_time": 1,
            "events.metadata.template_id": 1,
            "events.metadata.tracking_id": 1,
        });
        console.log("-> Created compound index on event details for status updates.");

        await communicationsCollection.createIndex({ "events.metadata.template_id": 1 });
        console.log("-> Created multikey index for template ID lookups.");
        await communicationsCollection.createIndex({ "events.metadata.tracking_id": 1 });
        console.log("-> Created multikey index for tracking ID lookups.");

        await communicationsCollection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
        console.log("-> Created TTL index on communications.");
        console.log("Database setup complete!");

        // 2. Generate Data
        console.log(`\nGenerating data for ${NUM_USERS_TO_GENERATE.toLocaleString('en-US')} users...`);

        const startTime = performance.now();

        // --- CHANGE: Use iterative batch insert for performance ---
        let bucketBatch = [];
        for (let i = 0; i < NUM_USERS_TO_GENERATE; i++) {
            const userId = 1000 + i;
            const userType = faker.helpers.arrayElement(USER_TYPES);

            for (let day = 0; day < DAYS_OF_DATA_TO_GENERATE; day++) {
                let eventsForDay = [];
                for (let j = 0; j < COMMS_PER_USER_PER_DAY; j++) {
                    const baseDate = new Date();
                    baseDate.setDate(baseDate.getDate() - day);
                    baseDate.setHours(faker.number.int({ min: 0, max: 23 }));
                    baseDate.setMinutes(faker.number.int({ min: 0, max: 59 }));
                    baseDate.setSeconds(faker.number.int({ min: 0, max: 59 }));

                    eventsForDay.push({
                        dispatch_time: baseDate,
                        metadata: {
                            tracking_id: faker.helpers.arrayElement(TRACKING_IDS),
                            template_id: faker.helpers.arrayElement(TEMPLATES),
                        },
                        content_score: faker.number.float({ min: 0.6, max: 1.0, multipleOf: 0.01 }),
                        status: faker.helpers.arrayElement(STATUSES)
                    });
                }

                const startOfDay = new Date(eventsForDay[0].dispatch_time);
                startOfDay.setUTCHours(0, 0, 0, 0);
                const expireAt = new Date(startOfDay.getTime() + (7 * 24 * 60 * 60 * 1000));

                bucketBatch.push({
                    user: { id: userId, type: userType },
                    day: startOfDay,
                    event_count: eventsForDay.length,
                    expireAt: expireAt,
                    events: eventsForDay
                });

                // When batch is full, insert and clear
                if (bucketBatch.length >= BATCH_SIZE) {
                    await communicationsCollection.insertMany(bucketBatch);
                    bucketBatch = []; // Reset the batch
                    console.log(`   ... Inserted a batch of ${BATCH_SIZE} documents.`);
                }
            }
        }

        // Insert any remaining documents in the last batch
        if (bucketBatch.length > 0) {
            await communicationsCollection.insertMany(bucketBatch);
            console.log(`   ... Inserted the final batch of ${bucketBatch.length} documents.`);
        }

        const endTime = performance.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

        console.log("\n✅ Data generation complete!");

        console.log(`\n⏱️ Performance & Estimation:`);
        console.log(`   - Time to generate for ${NUM_USERS_TO_GENERATE.toLocaleString('en-US')} users: ${durationSeconds} seconds.`);

        const timePerUser = (endTime - startTime) / NUM_USERS_TO_GENERATE;

        const estimatedProdTimeFullMs = timePerUser * NUM_USERS_PRODUCTION;
        const estimatedProdTimeFullHours = (estimatedProdTimeFullMs / (1000 * 60 * 60)).toFixed(2);
        console.log(`   - Estimated time for FULL production load (${NUM_USERS_PRODUCTION.toLocaleString('en-US')} users): ~${estimatedProdTimeFullHours} hours.`);

        const estimatedProdTimeHalfHours = (estimatedProdTimeFullHours / 2).toFixed(2);
        console.log(`   - Estimated time for HALF production load (${(NUM_USERS_PRODUCTION / 2).toLocaleString('en-US')} users): ~${estimatedProdTimeHalfHours} hours.`);

        const estimatedProdTimeThreeQuartersHours = (estimatedProdTimeFullHours * 0.75).toFixed(2);
        console.log(`   - Estimated time for 3/4 production load (${(NUM_USERS_PRODUCTION * 0.75).toLocaleString('en-US')} users): ~${estimatedProdTimeThreeQuartersHours} hours.`);

    } catch (e) {
        console.error("An error occurred during setup and data generation:", e);
    } finally {
        await setupClient.close();
        console.log("MongoDB connection for setup closed.");
    }
}

setupAndSeedDatabase();