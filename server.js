const express = require('express');
const oracledb = require('oracledb');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const PORT = 3000;

// Enable Auto Commit for Oracle Database transactions
oracledb.autoCommit = true;

// Middleware configuration
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Oracle Database Connection Configuration
const oracleDbConfig = {
    user: "system",       
    password: "root",     // Your Oracle database password
    connectionString: "localhost/XE" 
};

// MongoDB Configuration (NoSQL Database for unstructured data & logs)
const mongoUri = "mongodb://localhost:27017";
const mongoDbName = "campuspulse_nosql";

let mongoCollection;
let mongoDiscussionsCollection;

/**
 * Initialize Database Connections and Start Server
 */
async function startServer() {
    try {
        // 1. Test Oracle Connection on Startup
        const testConn = await oracledb.getConnection(oracleDbConfig);
        await testConn.close();
        console.log("Connected to Oracle Database successfully!");

        // 2. Connect to MongoDB
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db(mongoDbName);
        mongoCollection = db.collection('event_feedback');
        mongoDiscussionsCollection = db.collection('discussion_threads');
        console.log("Connected to MongoDB successfully!");

        // Start Express Server
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error("Database connection failed:", err);
    }
}

startServer();

// ==================== APPLICATION ROUTES ====================

/**
 * 1. Home Page Route - Fetches active events from Oracle and feedback logs from MongoDB
 */
app.get('/', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        const oracleEventsRes = await connection.execute(
            `SELECT * FROM events`, 
            [], 
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await connection.close();
        
        const mongoLogs = await mongoCollection.find({}).sort({ _id: -1 }).toArray();

        res.render('index', { 
            oracleEvents: oracleEventsRes.rows, 
            mongoLogs: mongoLogs,
            successMessage: null 
        });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error loading Home Page: ' + err.message);
    }
});

/**
 * 2. Student Signup Route - Registers a student with PENDING status
 */
app.post('/signup', async (req, res) => {
    const { fullName, username, contactNumber, email } = req.body;
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        await connection.execute(
            `INSERT INTO users (username, full_name, contact_number, email, status) 
             VALUES (:username, :fullName, :contactNumber, :email, 'PENDING')`,
            [username, fullName, contactNumber, email]
        );
        
        const oracleEventsRes = await connection.execute(`SELECT * FROM events`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        await connection.close();

        const mongoLogs = await mongoCollection.find({}).sort({ _id: -1 }).toArray();

        res.render('index', { 
            successMessage: 'Registration submitted! Please wait for staff approval before signing up for events.', 
            oracleEvents: oracleEventsRes.rows, 
            mongoLogs: mongoLogs 
        });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Signup failed (Student ID or email might already exist).');
    }
});

/**
 * 3. Event Registration Route - Validates if student account is APPROVED by staff
 */
app.post('/register', async (req, res) => {
    const { eventId, username } = req.body;
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        
        // Check student approval status
        const userCheck = await connection.execute(
            `SELECT status FROM users WHERE username = :username`,
            [username],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        if (userCheck.rows.length === 0) {
            await connection.close();
            return res.send("<script>alert('Student ID not found! Please register first.'); window.location.href='/';</script>");
        }

        const studentStatus = userCheck.rows[0].STATUS || userCheck.rows[0].status;
        if (studentStatus !== 'APPROVED') {
            await connection.close();
            return res.send("<script>alert('Your account is PENDING approval by staff! Please wait for staff approval.'); window.location.href='/';</script>");
        }

        // Insert event registration
        await connection.execute(
            `INSERT INTO registrations (username, event_id, reg_date) VALUES (:username, :eventId, SYSDATE)`,
            [username, eventId]
        );

        const oracleEventsRes = await connection.execute(`SELECT * FROM events`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        await connection.close();

        const mongoLogs = await mongoCollection.find({}).sort({ _id: -1 }).toArray();

        res.render('index', { 
            successMessage: 'Successfully registered for the event!', 
            oracleEvents: oracleEventsRes.rows, 
            mongoLogs: mongoLogs 
        });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.send("<script>alert('Registration failed or you are already registered for this event.'); window.location.href='/';</script>");
    }
});

/**
 * 4. My Registrations Route - Displays individual student event history
 */
app.get('/my-registrations', async (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.render('my-registrations', { studentInfo: null, myEvents: undefined, username: '' });
    }

    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        const studentRes = await connection.execute(
            `SELECT * FROM users WHERE username = :username`,
            [username],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        if (studentRes.rows.length === 0) {
            await connection.close();
            return res.render('my-registrations', { studentInfo: null, myEvents: [], username });
        }

        // Join query to fetch student registered events
        const eventsRes = await connection.execute(
            `SELECT e.title, e.description, e.event_date, e.venue, r.reg_date 
             FROM registrations r 
             JOIN events e ON r.event_id = e.event_id 
             WHERE r.username = :username`,
            [username],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await connection.close();

        res.render('my-registrations', { 
            studentInfo: studentRes.rows[0], 
            myEvents: eventsRes.rows, 
            username 
        });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error fetching registrations');
    }
});

/**
 * 5. Admin Panel Route - Admin authentication & management panel
 */
app.get('/admin', async (req, res) => {
    const pass = req.query.pass;
    if (pass !== 'admin123') {
        return res.render('admin-login', { error: null });
    }

    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        const regsRes = await connection.execute(
            `SELECT * FROM registrations`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await connection.close();
        res.render('admin-panel', { registrations: regsRes.rows });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error loading admin panel');
    }
});

/**
 * 6. Admin Add Event Route - Creates a new event with ticket price
 */
app.post('/admin/add-event', async (req, res) => {
    const { title, description, event_date, venue, price } = req.body;
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        await connection.execute(
            `INSERT INTO events (title, description, event_date, venue, price) 
             VALUES (:title, :description, TO_DATE(:event_date, 'YYYY-MM-DD'), :venue, :price)`,
            [title, description, event_date, venue, price || 0]
        );
        await connection.close();
        res.redirect('/admin?pass=admin123');
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error adding event');
    }
});

/**
 * 7. Admin Delete Registration Route
 */
app.post('/admin/delete-reg/:id', async (req, res) => {
    const regId = req.params.id;
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        await connection.execute(
            `DELETE FROM registrations WHERE reg_id = :regId`,
            [regId]
        );
        await connection.close();
        res.redirect('/admin?pass=admin123');
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error deleting registration');
    }
});

/**
 * 8. Admin Reports Dashboard Route - Advanced Oracle Joins, Aggregations, 
 *    PL/SQL Stored Procedure Execution, Ticket Revenue Calculation & MongoDB Analytics
 */
app.get('/admin/reports', async (req, res) => {
    const pass = req.query.pass;
    if (pass !== 'admin123') {
        return res.redirect('/admin');
    }

    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);

        // Report 1: Multi-table JOIN query (Registrations + Users + Events)
        const r1 = await connection.execute(
            `SELECT r.reg_id, u.full_name, u.username, u.email, e.title, r.reg_date 
             FROM registrations r 
             JOIN users u ON r.username = u.username 
             JOIN events e ON r.event_id = e.event_id`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Report 2: Aggregate Function & GROUP BY (Total registrations per event)
        const r2 = await connection.execute(
            `SELECT e.title, COUNT(r.reg_id) AS total_regs 
             FROM events e 
             LEFT JOIN registrations r ON e.event_id = r.event_id 
             GROUP BY e.title`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Report 3: Active Events Summary
        const r3 = await connection.execute(`SELECT * FROM events`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

        // Report 4: Total Ticket Revenue Calculation (Coursework Requirement)
        const revenueRes = await connection.execute(
            `SELECT SUM(e.price) AS total_revenue 
             FROM registrations r 
             JOIN events e ON r.event_id = e.event_id`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const totalRevenue = revenueRes.rows[0].TOTAL_REVENUE || revenueRes.rows[0].total_revenue || 0;

        // --- PL/SQL STORED PROCEDURE EXECUTION DEMO ---
        // Dynamically invoking the Oracle PL/SQL stored procedure using bind variables
        const procResult = await connection.execute(
            `BEGIN get_event_reg_count(:eventId, :count); END;`,
            {
                eventId: 1, // Target Event ID 1
                count: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        );
        const plsqlEvent1Count = procResult.outBinds.count;
        console.log("PL/SQL Stored Procedure Executed Successfully - Event 1 Count:", plsqlEvent1Count);
        // ----------------------------------------------

        await connection.close();

        // Fetch NoSQL data from MongoDB collections
        const r4 = await mongoCollection.find({}).toArray();
        const r5 = await mongoDiscussionsCollection.find({}).toArray();

        // Render admin reports template with all aggregated data
        res.render('admin-reports', {
            report1: r1.rows,
            report2: r2.rows,
            report3: r3.rows,
            totalRevenue: totalRevenue,
            plsqlEvent1Count: plsqlEvent1Count,
            report4: r4,
            report5: r5
        });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error generating reports: ' + err.message);
    }
});

/**
 * 9. Staff Login Page Route
 */
app.get('/staff-login', (req, res) => {
    res.render('staff-login', { error: null });
});

/**
 * 10. Staff Dashboard Route - Displays PENDING student accounts for approval (Fixed initial error)
 */
app.get('/staff', async (req, res) => {
    const pass = req.query.pass;

    // If no password provided initially, load login page without error
    if (!pass) {
        return res.render('staff-login', { error: null });
    }

    // If password is incorrect, show error on login page
    if (pass !== 'staff123') {
        return res.render('staff-login', { error: 'Incorrect Staff Password!' });
    }

    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        const result = await connection.execute(
            `SELECT * FROM users WHERE status = 'PENDING' OR status IS NULL`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await connection.close();
        res.render('staff-dashboard', { pendingStudents: result.rows });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error("Staff Route Error:", err);
        res.status(500).send('Database Error: ' + err.message);
    }
});

/**
 * 11. Approve Student Route - Updates student status to APPROVED
 */
app.post('/staff/approve/:username', async (req, res) => {
    const studentUsername = req.params.username;
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        await connection.execute(
            `UPDATE users SET status = 'APPROVED' WHERE username = :username`,
            [studentUsername]
        );
        await connection.close();
        res.redirect('/staff?pass=staff123');
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error approving student');
    }
});

/**
 * 12. Event Details & Feedback Route - Loads event info and MongoDB feedbacks
 */
app.get('/event/:id', async (req, res) => {
    const eventId = req.params.id;
    let connection;
    try {
        connection = await oracledb.getConnection(oracleDbConfig);
        const eventRes = await connection.execute(
            `SELECT * FROM events WHERE event_id = :eventId`,
            [eventId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await connection.close();

        if (eventRes.rows.length === 0) {
            return res.status(404).send('Event not found');
        }

        const feedbacks = await mongoCollection.find({ oracle_event_id: eventId }).toArray();
        const eventContent = await mongoDiscussionsCollection.findOne({ oracle_event_id: eventId });

        res.render('event-details', {
            event: eventRes.rows[0],
            feedbacks: feedbacks,
            eventContent: eventContent,
            success: null
        });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error loading event details');
    }
});

/**
 * 13. Submit Event Feedback Route (MongoDB Integration)
 */
app.post('/event/:id/feedback', async (req, res) => {
    const eventId = req.params.id;
    const { studentName, comment } = req.body;
    try {
        await mongoCollection.insertOne({
            oracle_event_id: eventId,
            student_id: studentName,
            rating: 5,
            comment: comment,
            submitted_at: new Date().toISOString().split('T')[0]
        });
        res.redirect(`/event/${eventId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error submitting feedback');
    }
});

/**
 * 14. Discussions Page Route (MongoDB Collection)
 */
app.get('/discussions', async (req, res) => {
    let connection;
    try {
        const threads = await mongoDiscussionsCollection.find({}).toArray();
        
        connection = await oracledb.getConnection(oracleDbConfig);
        const eventsRes = await connection.execute(`SELECT event_id, title FROM events`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        await connection.close();
        
        const eventsMap = {};
        eventsRes.rows.forEach(e => {
            eventsMap[e.EVENT_ID || e.event_id] = e.TITLE || e.title;
        });

        res.render('discussions', { threads, eventsList: eventsRes.rows, eventsMap });
    } catch (err) {
        if (connection) { try { await connection.close(); } catch (e) {} }
        console.error(err);
        res.status(500).send('Error loading discussions');
    }
});

/**
 * 15. Create Discussion Thread Route (MongoDB)
 */
app.post('/discussions/add', async (req, res) => {
    const { title, eventId, studentId, initialComment } = req.body;
    try {
        await mongoDiscussionsCollection.insertOne({
            title,
            oracle_event_id: eventId,
            author_student_id: studentId,
            posts: [{
                student_id: studentId,
                comment: initialComment,
                date: new Date().toISOString().split('T')[0]
            }]
        });
        res.redirect('/discussions');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating discussion thread');
    }
});

/**
 * 16. Reply to Discussion Thread Route (MongoDB $push update)
 */
app.post('/discussions/:id/reply', async (req, res) => {
    const threadId = req.params.id;
    const { studentId, replyComment } = req.body;
    try {
        await mongoDiscussionsCollection.updateOne(
            { _id: new ObjectId(threadId) },
            {
                $push: {
                    posts: {
                        student_id: studentId,
                        comment: replyComment,
                        date: new Date().toISOString().split('T')[0]
                    }
                }
            }
        );
        res.redirect('/discussions');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error posting reply');
    }
});