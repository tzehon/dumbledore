// This is a standalone script to calculate and display DB stats.

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI_STATS = process.env.MONGO_URI;
const DB_NAME_STATS = process.env.DB_NAME;

// --- Production scale numbers from PDF added for reference ---
const NUM_USERS_PRODUCTION = 50000000;
const DAYS_OF_DATA_PRODUCTION = 3;
const NUM_USERS_TO_GENERATE = 2000000; // Must match the value in setup.js
const DAYS_OF_DATA_TO_GENERATE = 3; // Must match the value in setup.js

// Helper function to format bytes into a readable string
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function getAndDisplayStats() {
    const statsClient = new MongoClient(MONGO_URI_STATS);
    try {
        await statsClient.connect();
        const db = statsClient.db(DB_NAME_STATS);
        console.log("Connected to MongoDB for stats...");

        const commsStats = await db.command({ collStats: 'communications' });

        console.log("\n💾 Storage (Development Sample):");
        console.log("-------------------------------------------------------------------------------------------------");
        console.log("communications");
        console.log(`  Storage size: ${formatBytes(commsStats.storageSize)}\tDocuments: ${commsStats.count.toLocaleString('en-US')}\t\tAvg. doc size: ${formatBytes(commsStats.avgObjSize)}\t\tIndexes: ${commsStats.nindexes}\tTotal index size: ${formatBytes(commsStats.totalIndexSize)}`);
        console.log("-------------------------------------------------------------------------------------------------");

        const totalOnDiskSize = commsStats.storageSize + commsStats.totalIndexSize;
        const totalDataOnDisk = commsStats.storageSize;
        const totalIndexSize = commsStats.totalIndexSize;
        console.log(`\nTOTAL Database On-Disk Size: ${formatBytes(totalOnDiskSize)} (Data: ${formatBytes(totalDataOnDisk)}, Indexes: ${formatBytes(totalIndexSize)})`);

        // The scaling factor is the ratio of total production documents to total development documents.
        const totalProductionDocuments = NUM_USERS_PRODUCTION * DAYS_OF_DATA_PRODUCTION;
        const totalDevelopmentDocuments = NUM_USERS_TO_GENERATE * DAYS_OF_DATA_TO_GENERATE;
        const scalingFactor = totalProductionDocuments / totalDevelopmentDocuments;

        const estimatedProdTotalTB = formatBytes(totalOnDiskSize * scalingFactor, 4);
        console.log(`\n💽 Estimated Production Storage for ${totalProductionDocuments.toLocaleString('en-US')} documents (${NUM_USERS_PRODUCTION.toLocaleString('en-US')} users over ${DAYS_OF_DATA_PRODUCTION} days): ~${estimatedProdTotalTB}`);

    } catch (e) {
        console.error("An error occurred while fetching stats:", e);
    } finally {
        await statsClient.close();
        console.log("MongoDB connection for stats closed.");
    }
}

getAndDisplayStats();