// models.js - Database Models
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
    telegramId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    firstName: String,
    lastName: String,
    username: String,
    twitterHandle: String,
    twitterVerified: {
        type: Boolean,
        default: false
    },
    verificationCode: String,
    verificationExpires: Date,
    verifiedAt: Date,
    registeredAt: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    earnings: {
        type: Number,
        default: 0
    },
    campaignsCompleted: {
        type: Number,
        default: 0
    },
    profileCompleted: {
        type: Boolean,
        default: false
    },
    profileCompletedAt: Date,
    lastParticipation: Date,
    engagementRate: {
        type: Number,
        default: 5
    },
    // Smart Profile Data
    profile: {
        primaryProfile: {
            label: String,
            description: String,
            bestFor: [String],
            authenticityLevel: String
        },
        spendingPower: String,
        authenticityScore: Number,
        marketingValue: String,
        recommendedCampaignTypes: [String]
    },
    // Profile Answers (for re-analysis)
    profileAnswers: {
        age_range: String,
        daily_routine: [String],
        spending_priority: String,
        influence_style: String,
        discovery_style: [String]
    }
}, {
    timestamps: true
});

// Campaign Schema
const campaignSchema = new mongoose.Schema({
    brandName: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    targetAudience: String,
    campaignType: String,
    package: String,
    budget: {
        type: Number,
        required: true
    },
    duration: Number,
    estimatedParticipants: Number,
    estimatedReach: Number,
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'cancelled'],
        default: 'pending'
    },
    participants: [String], // Array of telegram IDs
    totalEngagement: {
        type: Number,
        default: 0
    },
    actualReach: Number,
    actualParticipants: Number,
    // Financial tracking
    totalPaidOut: {
        type: Number,
        default: 0
    },
    platformCommission: Number,
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    startedAt: Date,
    completedAt: Date
}, {
    timestamps: true
});

// Assignment Schema
const assignmentSchema = new mongoose.Schema({
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campaign',
        required: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    role: {
        type: String,
        enum: ['initiator', 'replier', 'retweeter', 'quoter'],
        required: true
    },
    scheduledTime: {
        type: Date,
        required: true
    },
    executedAt: Date,
    status: {
        type: String,
        enum: ['pending', 'executed', 'completed', 'failed', 'skipped'],
        default: 'pending'
    },
    content: String,
    actualContent: String, // What they actually posted
    estimatedEarning: Number,
    actualEarning: Number,
    bonusEarning: {
        type: Number,
        default: 0
    },
    // Twitter engagement data
    tweetId: String,
    engagement: {
        likes: {
            type: Number,
            default: 0
        },
        retweets: {
            type: Number,
            default: 0
        },
        replies: {
            type: Number,
            default: 0
        },
        impressions: {
            type: Number,
            default: 0
        }
    },
    // Profile matching data
    isProfileMatch: {
        type: Boolean,
        default: false
    },
    profileScore: Number
}, {
    timestamps: true
});

// Cooldown Schema
const cooldownSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    until: {
        type: Date,
        required: true
    },
    hours: Number,
    reason: String
}, {
    timestamps: true
});

// Profiling State Schema (for temporary storage)
const profilingStateSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    currentQuestion: {
        type: Number,
        default: 0
    },
    answers: {
        age_range: String,
        daily_routine: [String],
        spending_priority: String,
        influence_style: String,
        discovery_style: [String]
    },
    questionOrder: [String],
    startedAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: Date.now,
        expires: 3600 // Expires after 1 hour
    }
});

// Analytics Schema (for tracking platform performance)
const analyticsSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        unique: true
    },
    metrics: {
        totalUsers: Number,
        activeUsers: Number,
        newUsers: Number,
        completedProfiles: Number,
        activeCampaigns: Number,
        completedCampaigns: Number,
        totalRevenue: Number,
        totalPayouts: Number,
        platformCommission: Number,
        averageEngagement: Number
    }
}, {
    timestamps: true
});

// Create Models
const User = mongoose.model('User', userSchema);
const Campaign = mongoose.model('Campaign', campaignSchema);
const Assignment = mongoose.model('Assignment', assignmentSchema);
const Cooldown = mongoose.model('Cooldown', cooldownSchema);
const ProfilingState = mongoose.model('ProfilingState', profilingStateSchema);
const Analytics = mongoose.model('Analytics', analyticsSchema);

// Note: Indexes will be created automatically by MongoDB when needed

module.exports = {
    User,
    Campaign,
    Assignment,
    Cooldown,
    ProfilingState,
    Analytics
};