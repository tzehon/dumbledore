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
const isResetMode = args.includes('--reset') || (!args.includes('--append') && !args.some(arg => /^\d+$/.test(arg))); // Default to reset if no specific args

// Find number argument
const numberArg = args.find(arg => /^\d+$/.test(arg));
const customDocCount = numberArg ? parseInt(numberArg) : null;

if (isAppendMode && isResetMode) {
    console.error('Error: Cannot use both --append and --reset flags');
    process.exit(1);
}

// --- Development Scale Parameters ---
const NUM_DOCS_TO_GENERATE = customDocCount || 1000000; // Default 1M documents
const DAYS_OF_DATA_TO_GENERATE = 3; // Align with 3-day retention policy
const BATCH_SIZE = 500000; // Insert documents in batches of this size

const USER_TYPES = ["premium", "standard", "trial"];

async function setupAndSeedDatabase() {
    const setupClient = new MongoClient(MONGO_URI_SETUP);
    try {
        await setupClient.connect();
        const db = setupClient.db(DB_NAME_SETUP);
        console.log("Connected to MongoDB for setup...");
        console.log(`Mode: ${isAppendMode ? 'APPEND' : 'RESET'}`);

        const userCommsCollection = db.collection('user_comms');

        // 1. Setup Database Schema
        if (isResetMode) {
            console.log("Setting up database collection...");
            try {
                await db.collection('user_comms').drop();
                console.log("Dropped existing user_comms collection.");
            } catch (e) {
                if (e.codeName !== 'NamespaceNotFound') {
                    console.warn("Could not drop collection (it may not exist):", e.message);
                }
            }
        } else {
            console.log("Append mode: Keeping existing collection and data...");
        }


        // 2. Generate Data
        console.log(`\nGenerating ${NUM_DOCS_TO_GENERATE.toLocaleString('en-US')} user_comms documents...`);

        // Determine starting user ID
        let startingUserId = 1000;
        if (isAppendMode) {
            // Find the highest existing user ID
            const maxUserDoc = await userCommsCollection.findOne(
                {},
                { sort: { "user_id": -1 }, projection: { "user_id": 1 } }
            );
            if (maxUserDoc) {
                const userIdNum = parseInt(maxUserDoc.user_id.replace('P_user', '')) + 1;
                startingUserId = userIdNum;
                console.log(`Append mode: Starting from user ID ${startingUserId}`);
            }
        }

        const startTime = performance.now();

        // Pre-generate common values to avoid repeated faker calls
        console.log("Pre-generating common values for performance...");
        const preGeneratedUserTypes = Array.from({ length: 10000 }, () => faker.helpers.arrayElement(USER_TYPES));
        const preGeneratedScores = Array.from({ length: 100000 }, () => faker.number.float({ min: 0.6, max: 1.0, multipleOf: 0.01 }));

        // Pre-generate time components for performance
        const preGeneratedHours = Array.from({ length: 10000 }, () => faker.number.int({ min: 0, max: 23 }));
        const preGeneratedMinutes = Array.from({ length: 10000 }, () => faker.number.int({ min: 0, max: 59 }));
        const preGeneratedSeconds = Array.from({ length: 10000 }, () => faker.number.int({ min: 0, max: 59 }));
        console.log("Pre-generation complete!");

        // --- Generate user_comms documents ---
        let userCommsBatch = [];
        let totalDocumentsInserted = 0;
        let preGenIndex = 0;
        
        for (let i = 0; i < NUM_DOCS_TO_GENERATE; i++) {
            const userId = `P_user${String(startingUserId + Math.floor(i / 5)).padStart(3, '0')}`;
            
            {
                const templateId = `template_${faker.string.uuid().substring(0, 8)}-${faker.string.alphanumeric(3)}`;
                const trackingId = faker.string.uuid();
                
                // Create _id from concatenation of user_id + tracking_id + template_id
                const customId = `${userId}_${trackingId}_${templateId}`;
                
                const baseDate = new Date();
                baseDate.setDate(baseDate.getDate() - faker.number.int({ min: 0, max: DAYS_OF_DATA_TO_GENERATE - 1 }));
                baseDate.setHours(preGeneratedHours[preGenIndex % preGeneratedHours.length]);
                baseDate.setMinutes(preGeneratedMinutes[preGenIndex % preGeneratedMinutes.length]);
                baseDate.setSeconds(preGeneratedSeconds[preGenIndex % preGeneratedSeconds.length]);
                
                const dispatchTimes = Array.from({ length: 7 }, (_, idx) => {
                    const dispatchDate = new Date(baseDate);
                    dispatchDate.setSeconds(dispatchDate.getSeconds() + (idx * 10));
                    return dispatchDate.getTime();
                });
                
                const contentEndTime = new Date(Date.now() + faker.number.int({ min: 7 * 24 * 60 * 60 * 1000, max: 30 * 24 * 60 * 60 * 1000 })); // 1 week to 1 month from now
                const plannedDateHour = new Date(baseDate.getTime() - faker.number.int({ min: 3600000, max: 86400000 })); // 1 hour to 1 day before
                
                userCommsBatch.push({
                    _id: customId,
                    content_end_time: contentEndTime,
                    created_at: baseDate,
                    dispatch_time: dispatchTimes,
                    final_score: preGeneratedScores[preGenIndex % preGeneratedScores.length],
                    planned_date_hour: plannedDateHour,
                    relevance_score: faker.number.float({ min: 0.4, max: 0.6, multipleOf: 0.01 }),
                    sent_at: faker.number.int({ min: 0, max: 1 }),
                    template_id: templateId,
                    tracking_id: trackingId,
                    updated_at: new Date(baseDate.getTime() + faker.number.int({ min: 60000, max: 1800000 })), // 1-30 min after created_at
                    user_id: userId
                });
                
                preGenIndex++;

                // When batch is full, insert and clear
                if (userCommsBatch.length >= BATCH_SIZE) {
                    await userCommsCollection.insertMany(userCommsBatch, {
                        ordered: false,  // Allow parallel execution
                        writeConcern: { w: 1, j: false }  // Optimize write concern
                    });
                    totalDocumentsInserted += BATCH_SIZE;
                    userCommsBatch = []; // Reset the batch

                    const timestamp = new Date().toISOString();
                    console.log(`   [${timestamp}] Inserted a batch of ${BATCH_SIZE} documents.`);

                    // Every 100k documents, show progress estimates
                    if (totalDocumentsInserted % 100000 === 0) {
                        const currentTime = performance.now();
                        const elapsedTime = currentTime - startTime;
                        const documentsPerMs = totalDocumentsInserted / elapsedTime;

                        // Calculate remaining time
                        const remainingDocs = NUM_DOCS_TO_GENERATE - totalDocumentsInserted;
                        const estimatedTimeLeftMs = remainingDocs / documentsPerMs;
                        const estimatedTimeLeftMinutes = (estimatedTimeLeftMs / (1000 * 60)).toFixed(2);
                        const estimatedTimeLeftHours = (estimatedTimeLeftMs / (1000 * 60 * 60)).toFixed(2);

                        console.log(`\n📊 Progress Update (${totalDocumentsInserted.toLocaleString()} documents inserted):`);
                        console.log(`   Time remaining: ~${estimatedTimeLeftMinutes} minutes / ~${estimatedTimeLeftHours} hours\n`);
                    }
                }
            }
        }

        // Insert any remaining documents in the last batch
        if (userCommsBatch.length > 0) {
            await userCommsCollection.insertMany(userCommsBatch, {
                ordered: false,  // Allow parallel execution
                writeConcern: { w: 1, j: false }  // Optimize write concern
            });
            console.log(`   ... Inserted the final batch of ${userCommsBatch.length} documents.`);
        }

        const endTime = performance.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

        console.log("\n✅ Data generation complete!");

        console.log(`\n⏱️ Performance Summary:`);
        console.log(`   - Generated ${NUM_DOCS_TO_GENERATE.toLocaleString('en-US')} documents in ${durationSeconds} seconds.`);
        
        const docsPerSecond = (NUM_DOCS_TO_GENERATE / (durationSeconds)).toFixed(0);
        console.log(`   - Rate: ${docsPerSecond} documents/second`);
        
        if (isResetMode) {
            console.log('\n💡 Reminder: The collection was dropped and recreated. Run "npm run indexes" to create the necessary indexes.');
        }

    } catch (e) {
        console.error("An error occurred during setup and data generation:", e);
    } finally {
        await setupClient.close();
        console.log("MongoDB connection for setup closed.");
    }
}

setupAndSeedDatabase();