const express = require('express');
const cors = require('cors');
const { connectToDb: connectToDbForServer, getClient } = require('./db');
const { ObjectId: ObjectIdForServer } = require('mongodb');

const app = express();
const DEBUG_MODE = process.argv.includes('--debug') || process.env.DEBUG_MODE === 'true';
const port = process.env.PORT || (DEBUG_MODE ? 5002 : 5001);

// Optimized CORS and middleware for performance
if (DEBUG_MODE) {
    app.use(cors({
        exposedHeaders: ['X-Database-Latency', 'X-Backend-Processing-Latency']
    }));
} else {
    // Production: minimal CORS with timing headers
    app.use(cors({
        exposedHeaders: ['X-Total-Backend-Latency']
    }));
}
app.use(express.json());

// Lightweight timing middleware
app.use((req, res, next) => {
    req.requestStartTime = performance.now();
    next();
});

// Helper function to add timing data to response
function addTimingData(req, res, dbStartTime, dbEndTime) {
    const requestEndTime = performance.now();
    const totalBackendLatency = Math.round(requestEndTime - req.requestStartTime);
    
    if (DEBUG_MODE) {
        // Full timing breakdown for development
        const databaseLatency = Math.round(dbEndTime - dbStartTime);
        const backendProcessingLatency = Math.round(totalBackendLatency - databaseLatency);
        
        res.set('X-Database-Latency', databaseLatency.toString());
        res.set('X-Backend-Processing-Latency', backendProcessingLatency.toString());
        
        return { databaseLatency, backendProcessingLatency };
    } else {
        // Production: single total backend time
        res.set('X-Total-Backend-Latency', totalBackendLatency.toString());
        return { totalBackendLatency };
    }
}

// --- Helper for logging query plans (Debug mode only) ---
async function logQueryPlan(db, collectionName, query) {
    if (!DEBUG_MODE) return;
    
    try {
        const explain = await db.collection(collectionName).find(query).explain("executionStats");
        const executionStages = explain.executionStats?.executionStages;
        if (executionStages?.stage === 'COLLSCAN') {
            console.log(` -> Query Plan: Collection Scan (COLLSCAN) - Consider adding an index.`);
        } else if (executionStages?.inputStage?.indexName) {
            console.log(` -> Query Plan: Used index '${executionStages.inputStage.indexName}'`);
        } else {
            console.log(" -> Query Plan: Could not determine index usage from explain output.");
        }
    } catch (e) {
        console.error(" -> Explain failed:", e.message);
    }
}

async function logAggregationPlan(db, collectionName, pipeline) {
    if (!DEBUG_MODE) return;
    
    try {
        // For aggregation pipelines, we'll analyze just the $match stage
        // since that's where index usage is most relevant
        const matchStage = pipeline.find(stage => stage.$match);

        if (matchStage) {
            // Use the existing logQueryPlan function for the match query
            await logQueryPlan(db, collectionName, matchStage.$match);
        } else {
            console.log(" -> Query Plan: No $match stage found in aggregation pipeline");
        }
    } catch (e) {
        console.error(" -> Explain for aggregation failed:", e.message);
    }
}


// --- API Endpoints ---

// GET /api/communications/user/:id?date=YYYY-MM-DD
// Requirement (B) & (E): Get Communications for User by day
app.get('/api/communications/user/:id', async (req, res) => {
    const db = await connectToDbForServer();
    const userId = parseInt(req.params.id);
    const { date } = req.query;

    if (!date) {
        return res.status(400).send('Date query parameter is required.');
    }

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const query = { "user.id": userId, day: startOfDay };

    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Req B & E) ---");
        console.log(`db.collection('communications').findOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") })`);
        await logQueryPlan(db, 'communications', query);
    }

    const dbStartTime = performance.now();
    const bucket = await db.collection('communications').findOne(query, 
        DEBUG_MODE ? {} : { projection: { events: 1, _id: 0 } } // Production: only fetch needed fields
    );
    const dbEndTime = performance.now();

    addTimingData(req, res, dbStartTime, dbEndTime);
    res.json(bucket ? bucket.events : []);
});


// POST /api/communications
// Requirement (A): Append Communication Blob data
app.post('/api/communications', async (req, res) => {
    const db = await connectToDbForServer();
    const { userId, userType, templateId, trackingId, count = 1 } = req.body;

    if (!userId || !userType || !templateId || !trackingId) {
        return res.status(400).send('Missing required fields.');
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const expireAt = new Date(startOfDay.getTime() + (7 * 24 * 60 * 60 * 1000));

    let eventsToPush = [];
    for (let i = 0; i < count; i++) {
        eventsToPush.push({
            dispatch_time: new Date(),
            metadata: { tracking_id: trackingId, template_id: templateId },
            content_score: Math.random() * 0.4 + 0.6,
            status: "sent"
        });
    }

    const filter = { "user.id": userId, day: startOfDay };
    const update = {
        $push: { events: { $each: eventsToPush } },
        $inc: { event_count: eventsToPush.length },
        $setOnInsert: {
            user: { id: userId, type: userType },
            day: startOfDay,
            expireAt: expireAt
        }
    };
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Req A) ---");
        console.log(`db.collection('communications').updateOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") }, { ... }, { upsert: true })`);
        await logQueryPlan(db, 'communications', filter);
    }

    const dbStartTime = performance.now();
    const result = await db.collection('communications').updateOne(filter, update, { upsert: true });
    const dbEndTime = performance.now();

    addTimingData(req, res, dbStartTime, dbEndTime);
    res.status(201).json({ message: `${count} event(s) appended.`});
});

// PUT /api/communications/status
// Requirement (F): Update Communication Blob Status
app.put('/api/communications/status', async (req, res) => {
    const db = await connectToDbForServer();
    const { userId, dispatch_time, templateId, trackingId, newStatus } = req.body;

    if (!userId || !dispatch_time || !templateId || !trackingId || !newStatus) {
        return res.status(400).send('Missing required fields for status update.');
    }

    const eventDispatchTime = new Date(dispatch_time);

    const filter = {
        "user.id": userId,
        "events.dispatch_time": eventDispatchTime,
        "events.metadata.template_id": templateId,
        "events.metadata.tracking_id": trackingId,
    };
    const update = { $set: { "events.$[elem].status": newStatus } };
    const options = {
        arrayFilters: [{
            "elem.dispatch_time": eventDispatchTime,
            "elem.metadata.template_id": templateId,
            "elem.metadata.tracking_id": trackingId
        }]
    };
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Req F) ---");
        console.log(`db.collection('communications').updateOne({ "user.id": ${userId}, "events.dispatch_time": ISODate("${eventDispatchTime.toISOString()}"), ... }, { ... }, { ... })`);
        await logQueryPlan(db, 'communications', filter);
    }

    const dbStartTime = performance.now();
    const result = await db.collection('communications').updateOne(filter, update, options);
    const dbEndTime = performance.now();

    addTimingData(req, res, dbStartTime, dbEndTime);

    if (result.matchedCount === 0) {
        return res.status(404).send('Communication event not found.');
    }

    res.status(200).json({ message: "Status updated successfully."});
});

// GET /api/campaigns/distinct-users
// Requirement (D): Get Distinct Users for Campaign by Hour
app.get('/api/campaigns/distinct-users', async (req, res) => {
    const db = await connectToDbForServer();
    const { date, hour, templateId, trackingId, lastUserId } = req.query;
    const PAGE_SIZE = 10;

    if (!date || !hour || !templateId || !trackingId) {
        return res.status(400).send('Missing required query parameters.');
    }

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const startOfHour = new Date(date);
    startOfHour.setUTCHours(parseInt(hour), 0, 0, 0);

    const endOfHour = new Date(startOfHour.getTime() + 60 * 60 * 1000);

    const matchStage = {
        $match: {
            day: startOfDay,
            events: {
                $elemMatch: {
                    "dispatch_time": { $gte: startOfHour, $lt: endOfHour },
                    "metadata.template_id": templateId,
                    "metadata.tracking_id": trackingId
                }
            }
        }
    };

    // Optimized pipeline with cursor-based pagination
    const pipeline = [
        matchStage,
        { $group: { _id: "$user.id" } },
        { $sort: { _id: 1 } },
        ...(lastUserId ? [{ $match: { _id: { $gt: parseInt(lastUserId) } } }] : []),
        { $limit: PAGE_SIZE + 1 } // Get one extra to check if more exists
    ];

    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Req D) ---");
        console.log(`lastUserId parameter: ${lastUserId}`);
        console.log(`db.collection('communications').aggregate(`, JSON.stringify(pipeline, null, 2), ")");
        await logAggregationPlan(db, 'communications', [matchStage]);
    }

    const dbStartTime = performance.now();
    const results = await db.collection('communications').aggregate(pipeline).toArray();
    const dbEndTime = performance.now();

    addTimingData(req, res, dbStartTime, dbEndTime);

    // Check if we have more results than the page size
    const hasMore = results.length > PAGE_SIZE;
    
    // Remove the extra result if we have more than PAGE_SIZE
    const data = results.slice(0, PAGE_SIZE).map(doc => doc._id);

    if (DEBUG_MODE) {
        console.log(`Results found: ${results.length}, hasMore: ${hasMore}`);
        console.log(`First few results: ${results.slice(0, 3).map(r => r._id).join(', ')}`);
        console.log(`Returning lastUserId: ${data.length > 0 ? data[data.length - 1] : null}`);
    }

    res.json({
        data,
        total: -1, // Unknown total (not calculated for performance)
        page: lastUserId ? -1 : 1, // Page number not meaningful with cursor pagination
        totalPages: -1, // Unknown total pages
        hasMore: hasMore,
        lastUserId: data.length > 0 ? data[data.length - 1] : null // Cursor for next page
    });
});

// POST /api/communications/replace
// Requirement (C): Replace Communication Blob Array
app.post('/api/communications/replace', async (req, res) => {
    const db = await connectToDbForServer();
    const { userId, date, communications } = req.body;

    if (!userId || !date || !Array.isArray(communications)) {
        return res.status(400).send('Missing required fields: userId, date, and communications array.');
    }

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const newEvents = communications.map(comm => ({
        ...comm,
        dispatch_time: new Date(comm.dispatch_time)
    }));

    const filter = { "user.id": userId, day: startOfDay };
    const update = { $set: { events: newEvents, event_count: newEvents.length } };
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Req C) ---");
        console.log(`db.collection('communications').updateOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") }, { ... }, { upsert: true })`);
        await logQueryPlan(db, 'communications', filter);
    }

    const dbStartTime = performance.now();
    const result = await db.collection('communications').updateOne(filter, update, { upsert: true });
    const dbEndTime = performance.now();

    addTimingData(req, res, dbStartTime, dbEndTime);

    res.status(200).json({
        message: "Communications replaced successfully.",
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId
    });
});


// This endpoint is for demonstration and not directly from the PDF,
// but it's needed for a realistic frontend.
app.get('/api/templates', async (req, res) => {
    const db = await connectToDbForServer();
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Get Templates) ---");
        console.log("db.collection('communications').distinct('events.metadata.template_id')");
        // Note: .explain() is not applicable to the distinct command itself, but we can see the supporting index being created in setup.js
    }
    const dbStartTime = performance.now();
    const templates = await db.collection('communications').distinct('events.metadata.template_id');
    const dbEndTime = performance.now();
    
    addTimingData(req, res, dbStartTime, dbEndTime);
    res.json(templates.sort());
});

app.get('/api/tracking-ids', async (req, res) => {
    const db = await connectToDbForServer();
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Get Tracking IDs) ---");
        console.log("db.collection('communications').distinct('events.metadata.tracking_id')");
        // Note: .explain() is not applicable to the distinct command itself, but the supporting index is logged in setup.js
    }
    const dbStartTime = performance.now();
    const trackingIds = await db.collection('communications').distinct('events.metadata.tracking_id');
    const dbEndTime = performance.now();
    
    addTimingData(req, res, dbStartTime, dbEndTime);
    res.json(trackingIds.sort());
});

// GET /api/communications/random
// Get a random communication result
app.get('/api/communications/random', async (req, res) => {
    const db = await connectToDbForServer();
    
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Random Communications) ---");
        console.log("db.collection('communications').aggregate([{ $sample: { size: 1 } }])");
    }
    
    const dbStartTime = performance.now();
    const pipeline = [{ $sample: { size: 1 } }];
    const randomResults = await db.collection('communications').aggregate(pipeline).toArray();
    const dbEndTime = performance.now();
    
    addTimingData(req, res, dbStartTime, dbEndTime);
    
    if (randomResults.length > 0) {
        const randomDoc = randomResults[0];
        res.json({
            userId: randomDoc.user?.id || null,
            date: randomDoc.day ? randomDoc.day.toISOString().split('T')[0] : null,
            events: randomDoc.events || []
        });
    } else {
        res.json({ userId: null, date: null, events: [] });
    }
});

// GET /api/campaigns/random
// Get a random campaign result with distinct users
app.get('/api/campaigns/random', async (req, res) => {
    const db = await connectToDbForServer();
    
    if (DEBUG_MODE) {
        console.log("\n--- Backend Query Log (Random Campaign) ---");
        console.log("db.collection('communications').aggregate([{ $sample: { size: 1 } }, { $unwind: '$events' }, { $sample: { size: 1 } }])");
    }
    
    const dbStartTime = performance.now();
    
    // Get a random document, then a random event from that document
    const pipeline = [
        { $sample: { size: 1 } },
        { $unwind: '$events' },
        { $sample: { size: 1 } }
    ];
    
    const randomResults = await db.collection('communications').aggregate(pipeline).toArray();
    const dbEndTime = performance.now();
    
    addTimingData(req, res, dbStartTime, dbEndTime);
    
    if (randomResults.length > 0) {
        const randomEvent = randomResults[0];
        const eventDispatchTime = new Date(randomEvent.events.dispatch_time);
        
        // Extract the hour from the dispatch time
        const hour = eventDispatchTime.getUTCHours();
        
        // Create search parameters from the random event
        const searchParams = {
            date: randomEvent.day.toISOString().split('T')[0],
            hour: hour.toString(),
            templateId: randomEvent.events.metadata.template_id,
            trackingId: randomEvent.events.metadata.tracking_id
        };
        
        // Now find distinct users for this campaign criteria
        const startOfDay = new Date(randomEvent.day);
        startOfDay.setUTCHours(0, 0, 0, 0);
        
        const startOfHour = new Date(randomEvent.day);
        startOfHour.setUTCHours(hour, 0, 0, 0);
        
        const endOfHour = new Date(startOfHour.getTime() + 60 * 60 * 1000);
        
        const distinctUsersPipeline = [
            {
                $match: {
                    day: startOfDay,
                    events: {
                        $elemMatch: {
                            "dispatch_time": { $gte: startOfHour, $lt: endOfHour },
                            "metadata.template_id": searchParams.templateId,
                            "metadata.tracking_id": searchParams.trackingId
                        }
                    }
                }
            },
            { $group: { _id: "$user.id" } },
            { $sort: { _id: 1 } },
            { $limit: 10 }
        ];
        
        const distinctUsers = await db.collection('communications').aggregate(distinctUsersPipeline).toArray();
        
        res.json({
            searchParams,
            distinctUsers: distinctUsers.map(doc => doc._id)
        });
    } else {
        res.json({ searchParams: null, distinctUsers: [] });
    }
});


// --- Server Initialization ---
async function startServer() {
    await connectToDbForServer();
    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}${DEBUG_MODE ? ' (DEBUG MODE)' : ' (PRODUCTION MODE)'}`);
    });
}

startServer();