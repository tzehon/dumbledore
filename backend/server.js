const express = require('express');
const cors = require('cors');
const { connectToDb: connectToDbForServer, getClient } = require('./db');
const { ObjectId: ObjectIdForServer } = require('mongodb');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// --- Helper for logging query plans ---
async function logQueryPlan(db, collectionName, query) {
    try {
        const explain = await db.collection(collectionName).find(query).explain("executionStats");
        if (explain.executionStats.executionStages.stage === 'COLLSCAN') {
            console.log(` -> Query Plan: Collection Scan (COLLSCAN) - Consider adding an index.`);
        } else {
            console.log(` -> Query Plan: Used index '${explain.executionStats.executionStages.inputStage.indexName}'`);
        }
    } catch (e) {
        console.error(" -> Explain failed:", e.message);
    }
}

async function logAggregationPlan(db, collectionName, pipeline) {
     try {
        const explain = await db.collection(collectionName).aggregate(pipeline).explain("executionStats");
        const winningPlan = explain.stages[0]?.$cursor?.queryPlanner?.winningPlan || explain.stages[0]?.winningPlan;
        if (winningPlan?.stage === 'COLLSCAN') {
            console.log(` -> Query Plan: Collection Scan (COLLSCAN) - Consider adding an index to support the aggregation.`);
        } else if (winningPlan?.stage === 'DISTINCT_SCAN') {
            console.log(` -> Query Plan: Used index for distinct scan on '${winningPlan.keyPattern ? Object.keys(winningPlan.keyPattern) : 'unknown'}'`);
        }
         else {
            console.log(` -> Query Plan: Stage is '${winningPlan?.stage}'`);
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

    console.log("\n--- Backend Query Log (Req B & E) ---");
    console.log(`db.collection('communications').findOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") })`);
    await logQueryPlan(db, 'communications', query);

    const bucket = await db.collection('communications').findOne(query);

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
    console.log("\n--- Backend Query Log (Req A) ---");
    console.log(`db.collection('communications').updateOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") }, { ... }, { upsert: true })`);
    await logQueryPlan(db, 'communications', filter);

    const result = await db.collection('communications').updateOne(filter, update, { upsert: true });

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
    console.log("\n--- Backend Query Log (Req F) ---");
    console.log(`db.collection('communications').updateOne({ "user.id": ${userId}, "events.dispatch_time": ISODate("${eventDispatchTime.toISOString()}"), ... }, { ... }, { ... })`);
    await logQueryPlan(db, 'communications', filter);

    const result = await db.collection('communications').updateOne(filter, update, options);

    if (result.matchedCount === 0) {
        return res.status(404).send('Communication event not found.');
    }

    res.status(200).json({ message: "Status updated successfully."});
});

// GET /api/campaigns/distinct-users
// Requirement (D): Get Distinct Users for Campaign by Hour
app.get('/api/campaigns/distinct-users', async (req, res) => {
    const db = await connectToDbForServer();
    const { date, hour, templateId, trackingId, page = 1 } = req.query;
    const PAGE_SIZE = 50;

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

    const pipeline = [
        matchStage,
        { $group: { _id: "$user.id" } },
        { $sort: { _id: 1 } },
        {
            $facet: {
                metadata: [{ $count: "total" }],
                data: [{ $skip: (page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }]
            }
        }
    ];

    console.log("\n--- Backend Query Log (Req D) ---");
    console.log(`db.collection('communications').aggregate(`, JSON.stringify(pipeline, null, 2), ")");
    await logAggregationPlan(db, 'communications', [matchStage]);

    const results = await db.collection('communications').aggregate(pipeline).toArray();

    const data = results[0].data.map(doc => doc._id);
    const total = results[0].metadata[0] ? results[0].metadata[0].total : 0;

    res.json({
        data,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / PAGE_SIZE)
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
    console.log("\n--- Backend Query Log (Req C) ---");
    console.log(`db.collection('communications').updateOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") }, { ... }, { upsert: true })`);
    await logQueryPlan(db, 'communications', filter);

    const result = await db.collection('communications').updateOne(filter, update, { upsert: true });

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
    console.log("\n--- Backend Query Log (Get Templates) ---");
    console.log("db.collection('communications').distinct('events.metadata.template_id')");
    const templates = await db.collection('communications').distinct('events.metadata.template_id');
    res.json(templates.sort());
});

app.get('/api/tracking-ids', async (req, res) => {
    const db = await connectToDbForServer();
    console.log("\n--- Backend Query Log (Get Tracking IDs) ---");
    console.log("db.collection('communications').distinct('events.metadata.tracking_id')");
    const trackingIds = await db.collection('communications').distinct('events.metadata.tracking_id');
    res.json(trackingIds.sort());
});


// --- Server Initialization ---
async function startServer() {
    await connectToDbForServer();
    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
}

startServer();