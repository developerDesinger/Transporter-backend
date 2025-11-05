const http = require("http");
require("dotenv").config();
const app = require("./app");
const { connectMongo } = require("./src/lib/mongoose");

const socketIo = require("socket.io");
const seedDatabaseAndCreateSuperAdmin = require("./src/api/v1/utils/superAdminCreation");
// const { syncDatabaseSchema, generatePrismaClient } = require("./src/utils/databaseSync");

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.name, err.message);
  process.exit(1);
});

// Test database connection
async function connectDatabase() {
  try {
    await connectMongo();
    console.log("MongoDB connected successfully!");

    // Seed database and create super admin
    await seedDatabaseAndCreateSuperAdmin();

    // Initialize cron jobs after database connection
    // cronService.init();
  } catch (err) {
    console.log("MongoDB connection error:", err);
    process.exit(1);
  }
}

// Connect to database
connectDatabase();

const port = process.env.PORT || 3000;
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.set("io", io);

server.listen(port, () => {
  console.log(`App running on port ${port}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.name, err.message);
  process.exit(1);
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("joinRoom", (userId) => {
    socket.join(userId);
    console.log(`User joined room: ${userId}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});
