// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

const MONGO_CONFIG = {
  host: process.env.MONGO_HOST || 'localhost',
  port: parseInt(process.env.MONGO_PORT || '27017', 10),
  username: process.env.MONGO_USERNAME || '',
  password: process.env.MONGO_PASSWORD || '',
  database: process.env.MONGO_DATABASE || 'gravitee',
  authSource: process.env.MONGO_AUTH_SOURCE || 'admin'
};

// Collection names from environment or defaults
const COLLECTIONS = {
  audits: process.env.MONGO_COLLECTION_AUDITS || 'apim_audits',
  users: process.env.MONGO_COLLECTION_USERS || 'apim_users',
  apis: process.env.MONGO_COLLECTION_APIS || 'apim_apis',
  applications: process.env.MONGO_COLLECTION_APPLICATIONS || 'apim_applications'
};

// Validate required environment variables
if (!MONGO_CONFIG.username || !MONGO_CONFIG.password) {
  console.error('❌ ERROR: MONGO_USERNAME and MONGO_PASSWORD must be set in .env file');
  console.error('💡 Please copy .env.example to .env and fill in your credentials');
  process.exit(1);
}

let db;
let auditsCollection;
let usersCollection;
let apisCollection;
let applicationsCollection;

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    const encodedPassword = encodeURIComponent(MONGO_CONFIG.password);
    const mongoUrl = `mongodb://${MONGO_CONFIG.username}:${encodedPassword}@${MONGO_CONFIG.host}:${MONGO_CONFIG.port}/${MONGO_CONFIG.database}?authSource=${MONGO_CONFIG.authSource}`;

    console.log(`🔄 MongoDB-yə qoşulur: ${MONGO_CONFIG.host}:${MONGO_CONFIG.port}/${MONGO_CONFIG.database}`);

    const client = await MongoClient.connect(mongoUrl, {
      serverSelectionTimeoutMS: 5000,
    });

    db = client.db(MONGO_CONFIG.database);
    auditsCollection = db.collection(COLLECTIONS.audits);
    usersCollection = db.collection(COLLECTIONS.users);
    apisCollection = db.collection(COLLECTIONS.apis);
    applicationsCollection = db.collection(COLLECTIONS.applications);

    console.log('✅ MongoDB-yə uğurla qoşuldu!');
    console.log(`📁 Database: ${MONGO_CONFIG.database}`);
    console.log(`📊 Collections: ${Object.values(COLLECTIONS).join(', ')}`);
    
    // Test connection
    const count = await auditsCollection.countDocuments();
    console.log(`📈 Ümumi audit log sayı: ${count.toLocaleString()}`);
  } catch (error) {
    console.error('❌ MongoDB qoşulma xətası:', error.message);
    console.error('💡 Zəhmət olmasa MongoDB konfiqurasiyasını yoxlayın');
    process.exit(1);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Get audit logs with filters
app.get('/api/audits', async (req, res) => {
  try {
    const {
      user,
      event,
      referenceType,
      startDate,
      endDate,
      limit = 100,
      skip = 0
    } = req.query;

    const andConditions = [];

    // Event filter
    if (event) {
      andConditions.push({ event });
    }

    // Reference type filter
    if (referenceType) {
      andConditions.push({ referenceType });
    }

    // Date filter 
    if (startDate || endDate) {
      const createdAt = {};
      if (startDate) {
        createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        createdAt.$lte = end;
      }
      andConditions.push({ createdAt });
    }

    // User filter
    if (user) {
      const userRegex = new RegExp(user, 'i');

      // Əvvəl apim_users-dan uyğun user-ları tapırıq
      const matchingUsers = await usersCollection.find({
        $or: [
          { firstname: userRegex },
          { lastname: userRegex },
          { displayName: userRegex },
          { email: userRegex },
          { sourceId: userRegex },
          { username: userRegex }
        ]
      }).project({ _id: 1, sourceId: 1, username: 1 }).toArray();

      const userIds = matchingUsers.map(u => u._id);
      const loginIds = matchingUsers
        .flatMap(u => [u.sourceId, u.username])
        .filter(Boolean);

      const orConditions = [
        { user: userRegex }
      ];

      if (userIds.length) {
        orConditions.push(
          { user: { $in: userIds } },
          { 'properties.USER': { $in: userIds } }
        );
      }

      if (loginIds.length) {
        orConditions.push(
          { user: { $in: loginIds } },
          { 'properties.USER': { $in: loginIds } }
        );
      }

      andConditions.push({ $or: orConditions });
    }

    const query =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
          ? andConditions[0]
          : { $and: andConditions };

    // Get total count
    const total = await auditsCollection.countDocuments(query);

    // Get audits
    const audits = await auditsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(parseInt(skip, 10))
      .limit(parseInt(limit, 10))
      .toArray();

    // Enrich with user + reference info
    const enrichedAudits = await Promise.all(
      audits.map(async (audit) => {
        // ===== USER RESOLUTION =====
        // audit.user is ALWAYS the user who performed the action
        let userName = 'Unknown';
        let userEmail = null;
        let targetUserName = null; // For properties.USER (if exists)

        const uuidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // Resolve the user who performed the action (audit.user)
        if (audit.user && uuidPattern.test(audit.user)) {
          try {
            const userDoc = await usersCollection.findOne({ _id: audit.user });
            if (userDoc) {
              const fullName = `${userDoc.firstname || ''} ${userDoc.lastname || ''}`.trim();
              userName =
                fullName ||
                userDoc.displayName ||
                userDoc.email ||
                userDoc.sourceId ||
                audit.user;
              userEmail = userDoc.email || null;
            } else {
              // User not found in DB, use ID
              userName = audit.user;
            }
          } catch (e) {
            console.error('Error resolving audit.user:', e);
            userName = audit.user;
          }
        } else if (audit.user) {
          // Not a UUID, might be username like 'admin', 'system'
          userName = audit.user;
        }

        // Special handling for system users
        if (
          userName === 'system' ||
          userName === 'SYSTEM' ||
          userName === 'admin' ||
          userName === 'Admin'
        ) {
          userName = '🤖 ' + userName;
        }

        // Resolve target user (properties.USER) if exists
        if (audit.properties && audit.properties.USER) {
          try {
            const targetUserDoc = await usersCollection.findOne({
              _id: audit.properties.USER,
            });
            if (targetUserDoc) {
              const fullName =
                `${targetUserDoc.firstname || ''} ${targetUserDoc.lastname || ''}`.trim();
              targetUserName =
                fullName ||
                targetUserDoc.displayName ||
                targetUserDoc.email ||
                targetUserDoc.sourceId ||
                audit.properties.USER;
            } else {
              targetUserName = audit.properties.USER;
            }
          } catch (e) {
            targetUserName = audit.properties.USER;
          }
        }

        // ===== REFERENCE RESOLUTION =====
        let referenceName = audit.referenceId;

        if (audit.referenceType === 'API' && audit.referenceId) {
          try {
            const api = await apisCollection.findOne({ _id: audit.referenceId });
            if (api) referenceName = api.name;
          } catch (e) {}
        } else if (audit.referenceType === 'APPLICATION' && audit.referenceId) {
          try {
            const app = await applicationsCollection.findOne({ _id: audit.referenceId });
            if (app) referenceName = app.name;
          } catch (e) {}
        }

        // ===== PATCH PARSING =====
        let parsedPatch = null;
        if (audit.patch) {
          parsedPatch = parsePatchData(audit.patch);
        }

        return {
          ...audit,
          userName, // User who performed the action
          userEmail,
          targetUserName, // Target user (if applicable)
          referenceName,
          parsedPatch,
        };
      })
    );

    res.json({
      total,
      audits: enrichedAudits,
      skip: parseInt(skip, 10),
      limit: parseInt(limit, 10)
    });
  } catch (error) {
    console.error('Audit log xətası:', error);
    res.status(500).json({ error: 'Audit log-lar alınarkən xəta baş verdi' });
  }
});

// Get distinct users
app.get('/api/users', async (req, res) => {
  try {
    const users = await auditsCollection.distinct('user');
    res.json(users.filter(u => u).sort());
  } catch (error) {
    res.status(500).json({ error: 'İstifadəçilər alınarkən xəta' });
  }
});

// Get distinct events
app.get('/api/events', async (req, res) => {
  try {
    const events = await auditsCollection.distinct('event');
    res.json(events.filter(e => e).sort());
  } catch (error) {
    res.status(500).json({ error: 'Event-lər alınarkən xəta' });
  }
});

// Get distinct reference types
app.get('/api/reference-types', async (req, res) => {
  try {
    const types = await auditsCollection.distinct('referenceType');
    res.json(types.filter(t => t).sort());
  } catch (error) {
    res.status(500).json({ error: 'Referans tipləri alınarkən xəta' });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      total,
      last24hCount,
      last7dCount,
      byReferenceType,
      topUsers,
      topEvents
    ] = await Promise.all([
      auditsCollection.countDocuments(),
      auditsCollection.countDocuments({ createdAt: { $gte: last24h } }),
      auditsCollection.countDocuments({ createdAt: { $gte: last7d } }),
      auditsCollection.aggregate([
        { $group: { _id: '$referenceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray(),
      auditsCollection.aggregate([
        { $match: { user: { $exists: true, $ne: null } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray(),
      auditsCollection.aggregate([
        { $group: { _id: '$event', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray()
    ]);

    res.json({
      total,
      last24h: last24hCount,
      last7d: last7dCount,
      byReferenceType: byReferenceType.map(r => ({ type: r._id, count: r.count })),
      topUsers: topUsers.map(u => ({ user: u._id, count: u.count })),
      topEvents: topEvents.map(e => ({ event: e._id, count: e.count }))
    });
  } catch (error) {
    console.error('Statistika xətası:', error);
    res.status(500).json({ error: 'Statistika alınarkən xəta' });
  }
});

// Helper function to parse and format patch data
function parsePatchData(patch) {
  if (!patch) return null;

  try {
    const parsed = typeof patch === 'string' ? JSON.parse(patch) : patch;
    
    if (!Array.isArray(parsed)) return null;

    return parsed.map(operation => {
      const result = {
        operation: operation.op,
        path: operation.path
      };

      // Add relevant fields based on operation type
      if (operation.from) result.from = operation.from;
      if (operation.value !== undefined) {
        // Try to parse nested JSON strings
        try {
          if (typeof operation.value === 'string' && 
              (operation.value.startsWith('{') || operation.value.startsWith('['))) {
            result.value = JSON.parse(operation.value);
          } else {
            result.value = operation.value;
          }
        } catch {
          result.value = operation.value;
        }
      }

      return result;
    });
  } catch (error) {
    console.error('Patch parse xətası:', error);
    return null;
  }
}

// Get audit detail
app.get('/api/audits/:id', async (req, res) => {
  try {
    const audit = await auditsCollection.findOne({ _id: req.params.id });
    if (!audit) {
      return res.status(404).json({ error: 'Audit log tapılmadı' });
    }

    // Parse patch data if exists
    if (audit.patch) {
      audit.parsedPatch = parsePatchData(audit.patch);
    }

    res.json(audit);
  } catch (error) {
    res.status(500).json({ error: 'Audit detay xətası' });
  }
});

// Get APIs
app.get('/api/apis', async (req, res) => {
  try {
    const { search, limit = 50, skip = 0 } = req.query;

    const query = search
      ? {
          $or: [
            { name: new RegExp(search, 'i') },
            { description: new RegExp(search, 'i') },
          ],
        }
      : {};

    const total = await apisCollection.countDocuments(query);
    const apis = await apisCollection
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(parseInt(skip, 10))
      .limit(parseInt(limit, 10))
      .toArray();

    res.json({ total, apis, skip: parseInt(skip, 10), limit: parseInt(limit, 10) });
  } catch (error) {
    console.error('API list xətası:', error);
    res.status(500).json({ error: 'API-lər alınarkən xəta baş verdi' });
  }
});

// Get Applications
app.get('/api/applications', async (req, res) => {
  try {
    const { search, limit = 50, skip = 0 } = req.query;

    const query = search
      ? {
          $or: [
            { name: new RegExp(search, 'i') },
            { description: new RegExp(search, 'i') },
          ],
        }
      : {};

    const total = await applicationsCollection.countDocuments(query);
    const applications = await applicationsCollection
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(parseInt(skip, 10))
      .limit(parseInt(limit, 10))
      .toArray();

    // Debug: Log first application structure
    if (applications.length > 0) {
      console.log('Sample Application Structure:', {
        name: applications[0].name,
        primaryOwner: applications[0].primaryOwner,
        owner: applications[0].owner,
        createdBy: applications[0].createdBy,
      });
    }

    // Enrich with owner information
    const enrichedApps = await Promise.all(
      applications.map(async (app) => {
        let ownerName = 'N/A';

        // primaryOwner can be:
        // 1. An object with id field: { id: "...", ... }
        // 2. An object with _id field: { _id: "...", ... }
        // 3. Just a string (user ID)
        let ownerId = null;

        if (app.primaryOwner) {
          if (typeof app.primaryOwner === 'object') {
            ownerId = app.primaryOwner.id || app.primaryOwner._id || app.primaryOwner.userId;
          } else if (typeof app.primaryOwner === 'string') {
            ownerId = app.primaryOwner;
          }
        }

        // Also check for owner field (alternative field name)
        if (!ownerId && app.owner) {
          if (typeof app.owner === 'object') {
            ownerId = app.owner.id || app.owner._id || app.owner.userId;
          } else if (typeof app.owner === 'string') {
            ownerId = app.owner;
          }
        }

        // Also check for createdBy field
        if (!ownerId && app.createdBy) {
          ownerId = app.createdBy;
        }

        if (ownerId) {
          try {
            const owner = await usersCollection.findOne({ _id: ownerId });
            if (owner) {
              const fullName = `${owner.firstname || ''} ${owner.lastname || ''}`.trim();
              ownerName =
                fullName ||
                owner.displayName ||
                owner.email ||
                owner.sourceId ||
                ownerId;
            } else {
              // If user not found, show the ID
              ownerName = ownerId;
            }
          } catch (e) {
            console.error('Owner lookup error:', e);
            ownerName = ownerId;
          }
        }

        return {
          ...app,
          ownerName,
          ownerId, // Also return the ID for debugging
        };
      })
    );

    res.json({
      total,
      applications: enrichedApps,
      skip: parseInt(skip, 10),
      limit: parseInt(limit, 10),
    });
  } catch (error) {
    console.error('Application list xətası:', error);
    res.status(500).json({ error: 'Application-lar alınarkən xəta baş verdi' });
  }
});

// Get Users
app.get('/api/users-list', async (req, res) => {
  try {
    const { search, limit = 50, skip = 0 } = req.query;

    const query = search
      ? {
          $or: [
            { firstname: new RegExp(search, 'i') },
            { lastname: new RegExp(search, 'i') },
            { email: new RegExp(search, 'i') },
            { sourceId: new RegExp(search, 'i') },
          ],
        }
      : {};

    const total = await usersCollection.countDocuments(query);
    const users = await usersCollection
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(parseInt(skip, 10))
      .limit(parseInt(limit, 10))
      .toArray();

    res.json({ total, users, skip: parseInt(skip, 10), limit: parseInt(limit, 10) });
  } catch (error) {
    console.error('User list xətası:', error);
    res.status(500).json({ error: 'İstifadəçilər alınarkən xəta baş verdi' });
  }
});

// Get Analytics data
app.get('/api/analytics', async (req, res) => {
  try {
    const now = new Date();
    const last30Days = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Top APIs by audit activity
    const topAPIs = await auditsCollection
      .aggregate([
        {
          $match: {
            referenceType: 'API',
            createdAt: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: '$referenceId',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    // Enrich with API names
    const enrichedAPIs = await Promise.all(
      topAPIs.map(async (item) => {
        const api = await apisCollection.findOne({ _id: item._id });
        return {
          id: item._id,
          name: api?.name || item._id,
          count: item.count,
        };
      })
    );

    // Top users by activity
    const topUsers = await auditsCollection
      .aggregate([
        {
          $match: {
            createdAt: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: '$user',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    // Enrich with user names
    const enrichedUsers = await Promise.all(
      topUsers.map(async (item) => {
        let userName = item._id || 'Unknown';

        if (item._id) {
          try {
            const userDoc = await usersCollection.findOne({ _id: item._id });
            if (userDoc) {
              const fullName = `${userDoc.firstname || ''} ${userDoc.lastname || ''}`.trim();
              userName =
                fullName ||
                userDoc.displayName ||
                userDoc.email ||
                userDoc.sourceId ||
                item._id;
            }
          } catch (e) {}
        }

        // Special handling for system users
        if (userName === 'system' || userName === 'admin') {
          userName = '🤖 ' + userName;
        }

        return {
          id: item._id,
          name: userName,
          count: item.count,
        };
      })
    );

    // Event distribution
    const eventDistribution = await auditsCollection
      .aggregate([
        {
          $match: {
            createdAt: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: '$event',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    res.json({
      topAPIs: enrichedAPIs,
      topUsers: enrichedUsers,
      eventDistribution,
    });
  } catch (error) {
    console.error('Analytics xətası:', error);
    res.status(500).json({ error: 'Analytics məlumatları alınarkən xəta baş verdi' });
  }
});

// Debug endpoint - Get single application structure
app.get('/api/applications/:id', async (req, res) => {
  try {
    const app = await applicationsCollection.findOne({ _id: req.params.id });
    if (!app) {
      return res.status(404).json({ error: 'Application tapılmadı' });
    }
    res.json(app);
  } catch (error) {
    console.error('Application detail xətası:', error);
    res.status(500).json({ error: 'Application məlumatı alınarkən xəta baş verdi' });
  }
});

// Get Alerts (recent critical events)
app.get('/api/alerts', async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);

    // Critical events: deletions, archiving, and other important changes
    const criticalEvents = await auditsCollection
      .find({
        createdAt: { $gte: last24h },
        event: {
          $in: [
            // API events
            'API_DELETED',
            'API_ARCHIVED',
            'API_DEPRECATED',
            // Application events
            'APPLICATION_DELETED',
            'APPLICATION_ARCHIVED',
            // User events
            'USER_DELETED',
            'USER_LOCKED',
            // Membership events
            'MEMBERSHIP_DELETED',
            // Plan events
            'PLAN_DELETED',
            // Subscription events
            'SUBSCRIPTION_CLOSED',
            // Other critical events
            'GROUP_DELETED',
            'ROLE_DELETED',
          ],
        },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Enrich with details
    const enrichedAlerts = await Promise.all(
      criticalEvents.map(async (alert) => {
        let userName = alert.user || 'Unknown';
        let referenceName = alert.referenceId;

        // Get user name
        if (alert.user) {
          try {
            const userDoc = await usersCollection.findOne({ _id: alert.user });
            if (userDoc) {
              const fullName = `${userDoc.firstname || ''} ${userDoc.lastname || ''}`.trim();
              userName =
                fullName || userDoc.displayName || userDoc.email || userDoc.sourceId || alert.user;
            }
          } catch (e) {}
        }

        // Get reference name
        if (alert.referenceType === 'API' && alert.referenceId) {
          try {
            const api = await apisCollection.findOne({ _id: alert.referenceId });
            if (api) referenceName = api.name;
          } catch (e) {}
        } else if (alert.referenceType === 'APPLICATION' && alert.referenceId) {
          try {
            const app = await applicationsCollection.findOne({ _id: alert.referenceId });
            if (app) referenceName = app.name;
          } catch (e) {}
        }

        return {
          ...alert,
          userName,
          referenceName,
        };
      })
    );

    res.json({ alerts: enrichedAlerts, total: enrichedAlerts.length });
  } catch (error) {
    console.error('Alerts xətası:', error);
    res.status(500).json({ error: 'Alert məlumatları alınarkən xəta baş verdi' });
  }
});

// Start server
async function startServer() {
  console.log(`\n🔧 Environment: ${NODE_ENV}`);
  console.log(`🔌 Starting Gravitee APIM Audit Viewer...\n`);

  await connectToMongoDB();

  app.listen(PORT, () => {
    console.log(`\n🚀 Server işləyir: http://localhost:${PORT}`);
    console.log(`📊 API endpoint: http://localhost:${PORT}/api/audits`);
    console.log(`\n💡 Tip: Press Ctrl+C to stop the server\n`);
  });
}

startServer().catch((error) => {
  console.error('❌ Server başlatma xətası:', error);
  process.exit(1);
});