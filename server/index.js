// Hostinger imports this entry file instead of executing it as require.main.
// Listening must happen immediately; database setup continues asynchronously.
const { startServer } = require("./bootstrap.cjs");
const runtime = startServer();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    runtime
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
module.exports = runtime;
