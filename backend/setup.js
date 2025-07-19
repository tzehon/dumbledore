// This is a standalone script to set up and seed the database.
// Usage:
//   node setup.js --reset    (default: drop collection and reseed)
//   node setup.js --append   (append new data to existing collection)

const { MongoClient, ObjectId } = require('mongodb');
const { faker } = require('@faker-js/faker');
const { performance } = require('perf_hooks');
require('dotenv').config();

const MONGO_URI_SETUP = process.env.MONGO_URI;
const DB_NAME_SETUP = process.env.DB_NAME;

// Parse command line arguments
const args = process.argv.slice(2);
const isAppendMode = args.includes('--append');
const isResetMode = args.includes('--reset') || args.length === 0; // Default to reset if no args

if (isAppendMode && isResetMode) {
    console.error('Error: Cannot use both --append and --reset flags');
    process.exit(1);
}

// --- Production scale numbers from PDF added for reference ---
const NUM_USERS_PRODUCTION = 50000000;
const COMMS_PER_USER_PER_DAY = 5;

// --- Development Scale Parameters ---
const NUM_USERS_TO_GENERATE = 50000000;
const DAYS_OF_DATA_TO_GENERATE = 3; // Align with 3-day retention policy
const BATCH_SIZE = 500000; // Insert documents in batches of this size

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
        console.log(`Mode: ${isAppendMode ? 'APPEND' : 'RESET'}`);

        const communicationsCollection = db.collection('communications');

        // 1. Setup Database Schema
        if (isResetMode) {
            console.log("Setting up database collection...");
            try {
                await db.collection('communications').drop();
                console.log("Dropped existing communications collection.");
            } catch (e) {
                if (e.codeName !== 'NamespaceNotFound') {
                    console.warn("Could not drop collection (it may not exist):", e.message);
                }
            }
        } else {
            console.log("Append mode: Keeping existing collection and data...");
        }

        // Drop all indexes (except _id) for maximum upload speed (only in reset mode)
        if (isResetMode) {
            console.log("Dropping existing indexes for maximum upload performance...");
            try {
                const indexes = await communicationsCollection.listIndexes().toArray();
                for (const index of indexes) {
                    if (index.name !== '_id_') {
                        await communicationsCollection.dropIndex(index.name);
                        console.log(`-> Dropped index: ${index.name}`);
                    }
                }
            } catch (e) {
                console.log("-> No existing indexes to drop (collection may be new)");
            }
            console.log("Database prepared for high-speed upload!");
        } else {
            console.log("Append mode: Keeping existing indexes for better performance...");
        }

        // 2. Generate Data
        console.log(`\nGenerating data for ${NUM_USERS_TO_GENERATE.toLocaleString('en-US')} users...`);

        // Determine starting user ID
        let startingUserId = 1000;
        if (isAppendMode) {
            // Find the highest existing user ID
            const maxUserDoc = await communicationsCollection.findOne(
                {},
                { sort: { "user.id": -1 }, projection: { "user.id": 1 } }
            );
            if (maxUserDoc) {
                startingUserId = maxUserDoc.user.id + 1;
                console.log(`Append mode: Starting from user ID ${startingUserId}`);
            }
        }

        const startTime = performance.now();

        // Pre-generate common values to avoid repeated faker calls
        console.log("Pre-generating common values for performance...");
        const preGeneratedUserTypes = Array.from({ length: 10000 }, () => faker.helpers.arrayElement(USER_TYPES));
        const preGeneratedTemplates = Array.from({ length: 50000 }, () => faker.helpers.arrayElement(TEMPLATES));
        const preGeneratedTrackingIds = Array.from({ length: 50000 }, () => faker.helpers.arrayElement(TRACKING_IDS));
        const preGeneratedStatuses = Array.from({ length: 100000 }, () => faker.helpers.arrayElement(STATUSES));
        const preGeneratedScores = Array.from({ length: 100000 }, () => faker.number.float({ min: 0.6, max: 1.0, multipleOf: 0.01 }));

        // Pre-generate time components for performance
        const preGeneratedHours = Array.from({ length: 10000 }, () => faker.number.int({ min: 0, max: 23 }));
        const preGeneratedMinutes = Array.from({ length: 10000 }, () => faker.number.int({ min: 0, max: 59 }));
        const preGeneratedSeconds = Array.from({ length: 10000 }, () => faker.number.int({ min: 0, max: 59 }));
        console.log("Pre-generation complete!");

        // --- CHANGE: Use iterative batch insert for performance ---
        let bucketBatch = [];
        let totalDocumentsInserted = 0;
        let preGenIndex = 0;
        for (let i = 0; i < NUM_USERS_TO_GENERATE; i++) {
            const userId = startingUserId + i;
            const userType = preGeneratedUserTypes[i % preGeneratedUserTypes.length];

            for (let day = 0; day < DAYS_OF_DATA_TO_GENERATE; day++) {
                let eventsForDay = [];
                for (let j = 0; j < COMMS_PER_USER_PER_DAY; j++) {
                    const baseDate = new Date();
                    baseDate.setDate(baseDate.getDate() - day);
                    baseDate.setHours(preGeneratedHours[preGenIndex % preGeneratedHours.length]);
                    baseDate.setMinutes(preGeneratedMinutes[preGenIndex % preGeneratedMinutes.length]);
                    baseDate.setSeconds(preGeneratedSeconds[preGenIndex % preGeneratedSeconds.length]);

                    eventsForDay.push({
                        dispatch_time: baseDate,
                        metadata: {
                            tracking_id: preGeneratedTrackingIds[preGenIndex % preGeneratedTrackingIds.length],
                            template_id: preGeneratedTemplates[preGenIndex % preGeneratedTemplates.length],
                        },
                        content_score: preGeneratedScores[preGenIndex % preGeneratedScores.length],
                        status: preGeneratedStatuses[preGenIndex % preGeneratedStatuses.length]
                    });
                    preGenIndex++;
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
                    await communicationsCollection.insertMany(bucketBatch, {
                        ordered: false,  // Allow parallel execution
                        writeConcern: { w: 1, j: false }  // Optimize write concern
                    });
                    totalDocumentsInserted += BATCH_SIZE;
                    bucketBatch = []; // Reset the batch

                    const timestamp = new Date().toISOString();
                    console.log(`   [${timestamp}] Inserted a batch of ${BATCH_SIZE} documents.`);

                    // Every 500k documents, show progress estimates
                    if (totalDocumentsInserted % 500000 === 0) {
                        const currentTime = performance.now();
                        const elapsedTime = currentTime - startTime;
                        const documentsPerMs = totalDocumentsInserted / elapsedTime;

                        // Calculate total expected documents
                        const totalExpectedDocs = NUM_USERS_TO_GENERATE * DAYS_OF_DATA_TO_GENERATE;
                        const prodExpectedDocs = NUM_USERS_PRODUCTION * DAYS_OF_DATA_TO_GENERATE;

                        // Time estimates for NUM_USERS_TO_GENERATE
                        const remainingDocs = totalExpectedDocs - totalDocumentsInserted;
                        const estimatedTimeLeftMs = remainingDocs / documentsPerMs;
                        const estimatedTimeLeftMinutes = (estimatedTimeLeftMs / (1000 * 60)).toFixed(2);

                        // Time estimates for NUM_USERS_PRODUCTION
                        const prodTimeMs = prodExpectedDocs / documentsPerMs;
                        const prodTimeHours = (prodTimeMs / (1000 * 60 * 60)).toFixed(2);

                        console.log(`\n📊 Progress Update (${totalDocumentsInserted.toLocaleString()} documents inserted):`);
                        console.log(`   Time remaining for ${NUM_USERS_TO_GENERATE.toLocaleString()} users: ~${estimatedTimeLeftMinutes} minutes`);
                        console.log(`   Estimated time for ${NUM_USERS_PRODUCTION.toLocaleString()} users: ~${prodTimeHours} hours\n`);
                    }
                }
            }
        }

        // Insert any remaining documents in the last batch
        if (bucketBatch.length > 0) {
            await communicationsCollection.insertMany(bucketBatch, {
                ordered: false,  // Allow parallel execution
                writeConcern: { w: 1, j: false }  // Optimize write concern
            });
            console.log(`   ... Inserted the final batch of ${bucketBatch.length} documents.`);
        }

        const endTime = performance.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

        console.log("\n✅ Data generation complete!");

        // Create indexes after upload for optimal performance
        console.log("\n🔧 Creating indexes (this may take a few minutes for large datasets)...");

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

        // await communicationsCollection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
        // console.log("-> Created TTL index on communications.");
        console.log("-> Skipped TTL index on communications.");

        console.log("\n✅ All indexes created successfully!");

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