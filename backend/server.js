const express = require('express');
const cors = require('cors');
const { connectToDb: connectToDbForServer, getClient } = require('./db');
const { ObjectId: ObjectIdForServer } = require('mongodb');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

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

    const mongoQuery = `db.getCollection('communications').findOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") })`;
    console.log("Executing Req B&E:", mongoQuery);

    const bucket = await db.collection('communications').findOne({
        "user.id": userId,
        day: startOfDay
    });

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

    const mongoQuery = `db.getCollection('communications').updateOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") }, { $push: { events: { $each: [...] } }, $inc: { ... }, $setOnInsert: { ... } }, { upsert: true })`;
    console.log("Executing Req A:", mongoQuery);

    const result = await db.collection('communications').updateOne(
        { "user.id": userId, day: startOfDay },
        {
            $push: { events: { $each: eventsToPush } },
            $inc: { event_count: eventsToPush.length },
            $setOnInsert: {
                user: { id: userId, type: userType },
                day: startOfDay,
                expireAt: expireAt
            }
        },
        { upsert: true }
    );

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

    const mongoQuery = `db.getCollection('communications').updateOne({ "user.id": ${userId}, "events.dispatch_time": ISODate("${eventDispatchTime.toISOString()}"), ... }, { $set: { "events.$[elem].status": "${newStatus}" } }, { arrayFilters: [ ... ] })`;
    console.log("Executing Req F:", mongoQuery);

    const result = await db.collection('communications').updateOne(
        {
            "user.id": userId,
            "events.dispatch_time": eventDispatchTime,
            "events.metadata.template_id": templateId,
            "events.metadata.tracking_id": trackingId,
        },
        { $set: { "events.$[elem].status": newStatus } },
        {
            arrayFilters: [{
                "elem.dispatch_time": eventDispatchTime,
                "elem.metadata.template_id": templateId,
                "elem.metadata.tracking_id": trackingId
            }]
        }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send('Communication event not found.');
    }

    res.status(200).json({ message: "Status updated successfully."});
});

// GET /api/campaigns/distinct-users
// Requirement (D): Get Distinct Users for Campaign by Hour
app.get('/api/campaigns/distinct-users', async (req, res) => {
    const db = await connectToDbForServer();
    const { date, hour, templateId, trackingId } = req.query;

    if (!date || !hour || !templateId || !trackingId) {
        return res.status(400).send('Missing required query parameters.');
    }

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const startOfHour = new Date(date);
    startOfHour.setUTCHours(parseInt(hour), 0, 0, 0);

    const endOfHour = new Date(startOfHour.getTime() + 60 * 60 * 1000);

    const mongoQuery = `db.getCollection('communications').distinct("user.id", { day: ISODate("${startOfDay.toISOString()}"), events: { $elemMatch: { ... } } })`;
    console.log("Executing Req D:", mongoQuery);

    const distinctUsers = await db.collection('communications').distinct("user.id", {
        day: startOfDay,
        events: {
            $elemMatch: {
                "dispatch_time": { $gte: startOfHour, $lt: endOfHour },
                "metadata.template_id": templateId,
                "metadata.tracking_id": trackingId
            }
        }
    });

    res.json(distinctUsers);
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

    const mongoQuery = `db.getCollection('communications').updateOne({ "user.id": ${userId}, day: ISODate("${startOfDay.toISOString()}") }, { $set: { events: [...], event_count: ${newEvents.length} } }, { upsert: true })`;
    console.log("Executing Req C:", mongoQuery);

    const result = await db.collection('communications').updateOne(
        { "user.id": userId, day: startOfDay },
        {
            $set: { events: newEvents, event_count: newEvents.length }
        },
        { upsert: true } // Creates the doc if it doesn't exist for that day
    );

    res.status(200).json({
        message: "Communications replaced successfully.",
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId
    });
});


// --- CHANGE: Added new endpoint for tracking IDs ---
// This endpoint is for demonstration and not directly from the PDF,
// but it's needed for a realistic frontend.
app.get('/api/templates', async (req, res) => {
    const db = await connectToDbForServer();
    const results = await db.collection('communications').aggregate([
        { $unwind: "$events" },
        { $group: { _id: '$events.metadata.template_id' } },
        { $sort: { _id: 1 } }
    ]).toArray();
    const templates = results.map(doc => doc._id);
    res.json(templates);
});

app.get('/api/tracking-ids', async (req, res) => {
    const db = await connectToDbForServer();
    const results = await db.collection('communications').aggregate([
        { $unwind: "$events" },
        { $group: { _id: '$events.metadata.tracking_id' } },
        { $sort: { _id: 1 } }
    ]).toArray();
    const trackingIds = results.map(doc => doc._id);
    res.json(trackingIds);
});


// --- Server Initialization ---
async function startServer() {
    await connectToDbForServer();
    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
}

startServer();
