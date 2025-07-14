// =================================================================
// File: backend/generateData.js
// Populates the database with sample data.
// =================================================================
const { faker } = require('@faker-js/faker');
const { connectToDb: connectToDbForData } = require('./db');
const { ObjectId } = require('mongodb');

// --- CHANGE: Production scale numbers from PDF added for reference ---
// Based on the PDF: 50 million users, 5 comms per user per day.
const NUM_USERS_PRODUCTION = 50000000;
const COMMS_PER_USER_PER_DAY = 5;

// --- Development Scale Parameters ---
// WARNING: Generating production scale data will take a very long time and
// consume significant disk space. Use a smaller number for local setup.
const NUM_USERS_TO_GENERATE = 500; // Adjust this value for local development


const USER_TYPES = ["premium", "standard", "trial"];
const TEMPLATES = Array.from({ length: 20 }, (_, i) => `template_${String(i + 1).padStart(3, '0')}`);
const TRACKING_IDS = Array.from({ length: 10 }, (_, i) => `track_${String(i + 1).padStart(3, '0')}`);
const STATUSES = ["sent", "failed", "opened", "clicked"];

async function generateData() {
    const db = await connectToDbForData();
    const usersCollection = db.collection('users');
    const commsCollection = db.collection('communications_ts');

    console.log(`Generating data for ${NUM_USERS_TO_GENERATE} users...`);
    console.log(`(Production target from PDF is ${NUM_USERS_PRODUCTION} users)`);


    for (let i = 0; i < NUM_USERS_TO_GENERATE; i++) {
        const userId = 1000 + i;
        const userType = faker.helpers.arrayElement(USER_TYPES);
        
        const userDoc = {
            _id: userId,
            user_type: userType,
            name: faker.person.fullName(),
            email: faker.internet.email(),
            created_at: faker.date.past({ years: 2 }),
        };
        await usersCollection.insertOne(userDoc);

        let commsToInsert = [];
        // Generate communications for each day up to the TTL buffer
        for (let day = 0; day < 7; day++) {
            for (let j = 0; j < COMMS_PER_USER_PER_DAY; j++) {
                // --- CHANGE: TTL buffer updated to 6 days ---
                // Generate a timestamp within the last 6 days to ensure it is not
                // immediately deleted by the 7-day TTL index.
                const timestamp = faker.date.recent({ days: 6 });
                commsToInsert.push({
                    _id: new ObjectId(),
                    metadata: {
                        user_id: userId,
                        user_type: userType,
                        tracking_id: faker.helpers.arrayElement(TRACKING_IDS),
                        template_id: faker.helpers.arrayElement(TEMPLATES),
                    },
                    timestamp: timestamp,
                    content_score: faker.number.float({ min: 0.6, max: 1.0, precision: 0.01 }),
                    status: faker.helpers.arrayElement(STATUSES)
                });
            }
        }
        
        if (commsToInsert.length > 0) {
            await commsCollection.insertMany(commsToInsert);
        }
        if ((i + 1) % 100 === 0) console.log(`  ... ${i + 1}/${NUM_USERS_TO_GENERATE} users generated.`);
    }
    console.log("Data generation complete!");
}

module.exports.generateData = generateData;