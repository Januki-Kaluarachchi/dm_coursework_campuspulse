const { MongoClient } = require('mongodb');

const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
let db;

async function connectMongo() {
    try {
        await client.connect();
        db = client.db("campuspulse_nosql");
        console.log("Connected successfully to MongoDB!");
    } catch (err) {
        console.error("MongoDB Connection Error: ", err);
    }
}

function getMongoDb() {
    return db;
}

module.exports = { connectMongo, getMongoDb };