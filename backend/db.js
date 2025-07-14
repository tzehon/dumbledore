// This handles the database connection for the server.

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;

let db;
let client;

async function connectToDb() {
    if (db) return db;
    try {
        client = new MongoClient(MONGO_URI); // Assign to module-scoped client
        await client.connect();
        db = client.db(DB_NAME);
        console.log("Successfully connected to MongoDB for server.");
        return db;
    } catch (e) {
        console.error("Could not connect to MongoDB", e);
        process.exit(1);
    }
}

function getClient() {
    return client;
}

module.exports = { connectToDb, getClient };