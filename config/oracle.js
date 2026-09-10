const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

async function getOracleConnection() {
    try {
        const connection = await oracledb.getConnection({
            user: "campuspulse_user", 
            password: "root",         
            connectionString: "localhost/XE"
        });
        return connection;
    } catch (err) {
        console.error("Oracle Connection Internal Error: ", err);
        throw err;
    }
}

module.exports = { getOracleConnection };