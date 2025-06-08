// server.js - Twitter Engagement Platform with MongoDB
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// Import database models
const { User, Campaign, Assignment, Cooldown, ProfilingState, Analytics } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

// Get environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/twitter-platform';

// Debug: Log environment
console.log('🔍 Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('MONGO_URL exists:', !!process.env.MONGO_URL);
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);

// Check if we have the bot token
if (!BOT_TOKEN) {
    console.log('❌ ERROR: TELEGRAM_BOT_TOKEN not found in environment variables');
    process.exit(1);
}

// Connect to Railway MongoDB
mongoose.connect(MONGODB_URI)
.then(() => {
    console.log('✅ Connected to Railway MongoDB successfully');
})
.catch((error) => {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
});

// Handle connection events
mongoose.connection.on('error', (error) => {
    console.error('❌ MongoDB error:', error.message);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected');
});

// Create Telegram bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// This lets our server understand JSON data
app.use(express.json());

// Remove in-memory storage - we'll use MongoDB now
// let users = [];
// let campaigns = [];
// let assignments = [];
// let cooldowns = {};
// let userProfilingStates = {};

// Assignment system configuration
const ASSIGNMENT_CONFIG = {
    roles: {
        initiator: 0.2,   // 20% start conversations
        replier: 0.4,     // 40% reply to posts
        retweeter: 0.25,  // 25% retweet
        quoter: 0.15      // 15% quote tweet
    },
    cooldownHours: {
        base: 24,         // 24 hours minimum
        max: 72,          // 72 hours maximum
        min: 12           // 12 hours minimum
    }
};

// Smart profiling questions
const PROFILING_QUESTIONS = {
    age_range: {
        question: "What's your age range? (This helps us match you with relevant campaigns)",
        type: "single",
        options: [
            "16-20 📱",
            "21-25 🎓", 
            "26-30 💼",
            "31-35 🏡",
            "36-40 👨‍👩‍👧‍👦",
            "41+ 🧠"
        ]
    },
    daily_routine: {
        question: "What best describes your typical weekday? (Select all that apply)",
        type: "multiple",
        options: [
            "Classes and campus life 📚",
            "Office work and meetings 💼", 
            "Running my own business 🚀",
            "Creative projects and freelancing 🎨",
            "Job hunting and skill building 💪",
            "Other professional work 👔"
        ]
    },
    spending_priority: {
        question: "When you have extra money, what do you typically spend it on first?",
        type: "single",
        options: [
            "Latest gadgets and tech 📱",
            "Fashion and looking good 👗",
            "Experiences (travel, events, food) ✈️",
            "Savings and investments 💰",
            "Family and relationships 👨‍👩‍👧‍👦",
            "Skills and education 📖",
            "Basic needs come first 🏠"
        ]
    },
    influence_style: {
        question: "When you recommend something on social media, it's usually because:",
        type: "single",
        options: [
            "I genuinely love it and want to share 💝",
            "It solved a real problem for me 🔧", 
            "It's trending and I want to join the conversation 🔥",
            "I think it's good value for money 💡",
            "It aligns with my values/beliefs 🎯",
            "My friends/followers would find it useful 🤝"
        ]
    },
    discovery_style: {
        question: "How do you typically discover new products/services? (Select all that apply)",
        type: "multiple",
        options: [
            "Through friends and people I trust 👥",
            "Social media ads and influencers 📺",
            "Research and reading reviews 🔍",
            "Trying trending/popular things 📈",
            "Recommendations from experts 🎓",
            "What fits my budget when I need it 💳"
        ]
    }
};

// Serve static files (like our dashboard)
app.use(express.static('.'));

// Web routes
app.get('/', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeCampaigns = await Campaign.countDocuments({ status: { $in: ['pending', 'active'] } });
        const completedProfiles = await User.countDocuments({ profileCompleted: true });
        
        res.json({ 
            message: 'Welcome to Twitter Engagement Platform with Smart Profiling!',
            status: 'Server is running',
            database: 'MongoDB connected',
            totalUsers,
            activeCampaigns,
            completedProfiles
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Server running but database error',
            error: error.message 
        });
    }
});

// Serve the dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

// API route to create campaigns
app.post('/api/campaigns/create', async (req, res) => {
    try {
        const campaignData = req.body;
        
        // Validate required fields
        if (!campaignData.brandName || !campaignData.description) {
            return res.status(400).json({ 
                success: false, 
                message: 'Brand name and description are required' 
            });
        }
        
        // Create campaign object
        const newCampaign = new Campaign({
            ...campaignData,
            status: 'pending',
            participants: [],
            totalEngagement: 0
        });
        
        // Save to database
        await newCampaign.save();
        
        console.log(`✅ New campaign created: ${campaignData.brandName} (₦${campaignData.budget})`);
        
        // Automatically create assignments for this campaign
        setTimeout(() => {
            createAutomaticAssignments(newCampaign);
        }, 1000);
        
        // Notify all users about new campaign
        notifyUsersAboutCampaign(newCampaign);
        
        res.json({
            success: true,
            message: 'Campaign created successfully!',
            campaignId: newCampaign._id
        });
        
    } catch (error) {
        console.error('❌ Error creating campaign:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create campaign' 
        });
    }
});

// Get all campaigns
app.get('/api/campaigns', async (req, res) => {
    try {
        const campaigns = await Campaign.find({}).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            campaigns: campaigns.map(campaign => ({
                id: campaign._id,
                brandName: campaign.brandName,
                description: campaign.description,
                package: campaign.package,
                budget: campaign.budget,
                status: campaign.status,
                estimatedParticipants: campaign.estimatedParticipants,
                estimatedReach: campaign.estimatedReach,
                createdAt: campaign.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch campaigns'
        });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await User.find({}).sort({ registeredAt: -1 });
        
        res.json({ 
            message: 'Registered Users',
            users: users.map(user => ({
                name: user.firstName,
                telegramId: user.telegramId,
                profile: user.profileCompleted ? user.profile.primaryProfile.label : 'Not completed',
                isActive: user.isActive || false
            }))
        });
    } catch (error) {
        res.status(500).json({
            message: 'Failed to fetch users',
            error: error.message
        });
    }
});

// Smart Assignment System (Inclusive Approach)
function createAutomaticAssignments(campaign) {
    console.log(`🤖 Creating assignments for: ${campaign.brandName}`);
    
    // Get ALL available users (regardless of profile status)
    const availableUsers = getAvailableUsers();
    
    if (availableUsers.length === 0) {
        console.log('⚠️ No available users for assignments');
        return;
    }
    
    // Select users - everyone gets a fair chance
    const maxParticipants = Math.min(availableUsers.length, campaign.estimatedParticipants);
    const selectedUsers = selectBestUsersInclusive(availableUsers, maxParticipants);
    
    // Distribute roles (profile helps but isn't required)
    const roleDistribution = distributeRolesInclusive(selectedUsers, campaign);
    
    // Create assignments with organic timing
    const campaignAssignments = createTimedAssignments(campaign, roleDistribution);
    
    // Store assignments
    assignments.push(...campaignAssignments);
    
    // Update campaign with participants
    campaign.participants = selectedUsers.map(user => user.telegramId);
    campaign.status = 'active';
    
    // Notify selected users
    notifySelectedUsersInclusive(campaignAssignments);
    
    console.log(`✅ Created ${campaignAssignments.length} assignments for ${selectedUsers.length} users`);
    console.log(`📊 ${selectedUsers.filter(u => u.profileCompleted).length} users have completed profiles (bonus earnings!)`);
}

async function getAvailableUsers() {
    try {
        const now = new Date();
        
        // Get users with verified Twitter accounts only
        const users = await User.find({
            twitterHandle: { $exists: true, $ne: null },
            twitterVerified: true, // Only verified users
            isActive: true
        });
        
        // Filter out users in cooldown
        const availableUsers = [];
        
        for (const user of users) {
            const cooldown = await Cooldown.findOne({ userId: user.telegramId });
            
            if (!cooldown || now >= cooldown.until) {
                availableUsers.push(user);
            }
        }
        
        return availableUsers;
        
    } catch (error) {
        console.error('❌ Error getting available users:', error);
        return [];
    }
}

function selectBestUsersInclusive(availableUsers, maxParticipants) {
    // Fair selection - everyone gets a chance, profile just adds bonus points
    const scoredUsers = availableUsers.map(user => {
        const timeSinceLastParticipation = getTimeSinceLastParticipation(user);
        const engagementScore = user.engagementRate || 5; // Default engagement rate
        
        // Base score (same for everyone)
        let score = (engagementScore * 0.6) + (timeSinceLastParticipation * 0.4);
        
        // Small profile bonus (not game-changing)
        if (user.profileCompleted) {
            score += 1; // Just a small boost, not decisive
        }
        
        return { ...user, score };
    });
    
    // Sort by score but ensure fairness
    return scoredUsers
        .sort((a, b) => b.score - a.score)
        .slice(0, maxParticipants);
}

function getTimeSinceLastParticipation(user) {
    const now = new Date();
    const lastParticipation = user.lastParticipation || new Date(user.registeredAt);
    const hoursSince = (now - lastParticipation) / (1000 * 60 * 60);
    
    // Normalize to 0-10 scale (more hours = higher score)
    return Math.min(10, hoursSince / 24);
}

function distributeRolesInclusive(selectedUsers, campaign) {
    const distribution = [];
    
    selectedUsers.forEach(user => {
        // Get role suggestion (profile helps but defaults to fair distribution)
        const role = getRoleForUserInclusive(user, campaign);
        distribution.push({
            user: user,
            role: role,
            hasProfile: user.profileCompleted || false,
            profileMatch: user.profileCompleted ? isUserMatchForCampaign(user, campaign) : false
        });
    });
    
    // Ensure balanced role distribution
    return balanceRoleDistributionFairly(distribution);
}

function getRoleForUserInclusive(user, campaign) {
    // If user has profile, use smart assignment
    if (user.profileCompleted && user.profile) {
        const profile = user.profile.primaryProfile;
        const authenticity = user.profile.authenticityScore;
        
        // High authenticity users get better roles
        if (authenticity > 85) {
            return Math.random() > 0.5 ? 'initiator' : 'quoter';
        }
        
        // Profile-based suggestions
        if (profile.label.includes('Student') || profile.label.includes('Creative')) {
            return Math.random() > 0.6 ? 'replier' : 'quoter';
        }
        
        if (profile.label.includes('Professional') || profile.label.includes('Entrepreneur')) {
            return Math.random() > 0.5 ? 'retweeter' : 'replier';
        }
    }
    
    // Default fair distribution for everyone
    const roles = ['initiator', 'replier', 'retweeter', 'quoter'];
    return roles[Math.floor(Math.random() * roles.length)];
}

function balanceRoleDistributionFairly(distribution) {
    // Simple rotation to ensure everyone gets different roles over time
    const totalUsers = distribution.length;
    const targetCounts = {
        initiator: Math.ceil(totalUsers * 0.2),
        replier: Math.ceil(totalUsers * 0.4),
        retweeter: Math.ceil(totalUsers * 0.25),
        quoter: Math.ceil(totalUsers * 0.15)
    };
    
    // Adjust to fit total users
    const totalRoles = Object.values(targetCounts).reduce((sum, count) => sum + count, 0);
    if (totalRoles > totalUsers) {
        targetCounts.replier = Math.max(1, targetCounts.replier - (totalRoles - totalUsers));
    }
    
    // Redistribute fairly while respecting preferences
    const finalDistribution = [];
    
    // Assign initiators first (give to high authenticity if available)
    const highAuthUsers = distribution.filter(d => d.hasProfile && d.user.profile.authenticityScore > 80);
    let initiatorsAssigned = 0;
    
    for (let i = 0; i < Math.min(targetCounts.initiator, highAuthUsers.length); i++) {
        finalDistribution.push({
            ...highAuthUsers[i],
            role: 'initiator'
        });
        initiatorsAssigned++;
    }
    
    // Fill remaining roles fairly
    const remainingUsers = distribution.filter(d => !finalDistribution.some(fd => fd.user.telegramId === d.user.telegramId));
    const remainingRoles = [];
    
    // Add remaining initiators
    for (let i = initiatorsAssigned; i < targetCounts.initiator; i++) {
        remainingRoles.push('initiator');
    }
    
    // Add other roles
    for (let i = 0; i < targetCounts.replier; i++) remainingRoles.push('replier');
    for (let i = 0; i < targetCounts.retweeter; i++) remainingRoles.push('retweeter');
    for (let i = 0; i < targetCounts.quoter; i++) remainingRoles.push('quoter');
    
    // Shuffle roles for fairness
    for (let i = remainingRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingRoles[i], remainingRoles[j]] = [remainingRoles[j], remainingRoles[i]];
    }
    
    // Assign remaining roles
    remainingUsers.forEach((assignment, index) => {
        finalDistribution.push({
            ...assignment,
            role: remainingRoles[index] || 'replier'
        });
    });
    
    return finalDistribution;
}

function isUserMatchForCampaign(user, campaign) {
    if (!user.profile || !user.profileCompleted) return false;
    
    const userProfile = user.profile.primaryProfile;
    
    // Check if campaign has target audience
    if (campaign.targetAudience) {
        const targetLower = campaign.targetAudience.toLowerCase();
        const profileLower = userProfile.label.toLowerCase();
        
        // Check for keyword matches
        if (targetLower.includes('student') && profileLower.includes('student')) return true;
        if (targetLower.includes('tech') && profileLower.includes('tech')) return true;
        if (targetLower.includes('professional') && profileLower.includes('professional')) return true;
        if (targetLower.includes('creative') && profileLower.includes('creative')) return true;
        if (targetLower.includes('entrepreneur') && profileLower.includes('entrepreneur')) return true;
    }
    
    // Check spending power match
    if (campaign.package === 'premium' && user.profile.spendingPower === 'high') return true;
    if (campaign.package === 'starter' && user.profile.spendingPower === 'emerging') return true;
    
    // High authenticity users match well with any campaign
    if (user.profile.authenticityScore > 85) return true;
    
    return false;
}

function createTimedAssignments(campaign, roleDistribution) {
    const now = new Date();
    const assignments = [];
    
    roleDistribution.forEach((assignment, index) => {
        const baseDelay = getBaseDelayForRole(assignment.role);
        const randomDelay = Math.random() * 60; // Random 0-60 minutes
        const totalDelay = baseDelay + randomDelay;
        
        const scheduledTime = new Date(now.getTime() + (totalDelay * 60 * 1000));
        
        const newAssignment = {
            id: `${campaign.id}_${assignment.user.telegramId}_${Date.now()}`,
            campaignId: campaign.id,
            userId: assignment.user.telegramId,
            user: assignment.user,
            role: assignment.role,
            scheduledTime: scheduledTime,
            status: 'pending',
            content: generateContentForRole(campaign, assignment.role),
            estimatedEarning: calculateEarning(campaign, assignment.role),
            isProfileMatch: assignment.profileMatch || false
        };
        
        assignments.push(newAssignment);
    });
    
    return assignments;
}

function getBaseDelayForRole(role) {
    // Different roles start at different times for organic flow
    const delays = {
        initiator: 0,      // Start immediately
        replier: 30,       // 30 minutes after initiators
        retweeter: 60,     // 1 hour
        quoter: 90         // 1.5 hours
    };
    
    return delays[role] || 0;
}

function generateContentForRole(campaign, role) {
    const templates = {
        initiator: [
            `Anyone else heard of ${campaign.brandName}? 🤔`,
            `Just discovered ${campaign.brandName} - thoughts?`,
            `What's everyone's take on ${campaign.brandName}?`,
            `Has anyone tried ${campaign.brandName}? Worth it?`
        ],
        replier: [
            `I've been using it for a while now, pretty solid!`,
            `Yeah, heard good things about them`,
            `My friend recommended it to me recently`,
            `Definitely worth checking out`
        ],
        retweeter: [
            `Sharing this - interesting discussion!`,
            `Worth a look 👀`,
            `Good thread here`,
            `This caught my attention`
        ],
        quoter: [
            `Adding my 2 cents - been following them for a while`,
            `This aligns with what I've been seeing`,
            `Interesting perspective here`,
            `Worth the conversation`
        ]
    };
    
    const roleTemplates = templates[role] || templates.initiator;
    return roleTemplates[Math.floor(Math.random() * roleTemplates.length)];
}

function calculateEarning(campaign, role) {
    const baseRates = {
        initiator: 300,
        replier: 200,
        retweeter: 100,
        quoter: 250
    };
    
    const totalBudget = campaign.budget * 0.65; // 65% goes to users
    const basePayout = totalBudget / campaign.estimatedParticipants;
    const roleMultiplier = baseRates[role] / 200; // Normalize around 200
    
    return Math.round(basePayout * roleMultiplier);
}

async function notifySelectedUsersInclusive(assignments) {
    for (const assignment of assignments) {
        try {
            const campaign = getCampaignById(assignment.campaignId);
            const user = assignment.user;
            
            // Base earning for everyone
            let earning = assignment.estimatedEarning;
            let bonusMessage = '';
            
            // Profile bonus (nice to have, not essential)
            if (user.profileCompleted && user.profile) {
                const profileBonus = Math.round(earning * 0.15); // 15% bonus for having profile
                
                if (assignment.isProfileMatch && user.profile.authenticityScore > 80) {
                    const matchBonus = Math.round(earning * 0.1); // Additional 10% for perfect match
                    earning += profileBonus + matchBonus;
                    bonusMessage = `\n🎯 Profile Bonus: +₦${(profileBonus + matchBonus).toLocaleString()}! (Profile + Match)`;
                } else if (user.profile.authenticityScore > 80) {
                    earning += profileBonus;
                    bonusMessage = `\n💡 Profile Bonus: +₦${profileBonus.toLocaleString()}! (Completed profile)`;
                }
            }
            
            let message = `🎉 YOU'VE BEEN SELECTED!\n\n` +
                         `Campaign: ${campaign.brandName}\n` +
                         `Your Role: ${assignment.role.toUpperCase()}\n` +
                         `💰 Total Earning: ₦${earning.toLocaleString()}${bonusMessage}\n` +
                         `⏰ Scheduled: ${assignment.scheduledTime.toLocaleString()}\n\n`;
            
            if (user.profileCompleted && user.profile) {
                message += `🧠 Your Profile: ${user.profile.primaryProfile.label}\n` +
                          `⭐ Authenticity: ${user.profile.authenticityScore}/100\n\n`;
            } else {
                message += `💡 Complete your profile with /profile for bonus earnings!\n\n`;
            }
            
            message += `📝 Suggested Content:\n"${assignment.content}"\n\n` +
                      `💡 Customize this message to match your style!`;
            
            await bot.sendMessage(assignment.userId, message);
            
            // Update earning to include bonus
            assignment.estimatedEarning = earning;
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.log(`❌ Failed to notify user ${assignment.user.firstName}: ${error.message}`);
        }
    }
}

function getCampaignById(campaignId) {
    return campaigns.find(c => c.id === campaignId);
}

function addUserToCooldown(userId, campaignSize) {
    const now = new Date();
    const baseHours = ASSIGNMENT_CONFIG.cooldownHours.base;
    const maxHours = ASSIGNMENT_CONFIG.cooldownHours.max;
    const minHours = ASSIGNMENT_CONFIG.cooldownHours.min;
    
    // Larger campaigns = longer cooldown
    const sizeMultiplier = Math.min(2, campaignSize / 50);
    const cooldownHours = Math.max(minHours, Math.min(maxHours, baseHours * sizeMultiplier));
    
    cooldowns[userId] = {
        until: new Date(now.getTime() + (cooldownHours * 60 * 60 * 1000)),
        hours: cooldownHours
    };
    
    console.log(`⏰ User ${userId} in cooldown for ${cooldownHours} hours`);
}

// Function to notify users about new campaigns
async function notifyUsersAboutCampaign(campaign) {
    const activeUsers = users.filter(user => user.isActive && user.twitterHandle);
    
    if (activeUsers.length === 0) {
        console.log('⚠️ No active users with Twitter accounts to notify');
        return;
    }
    
    const message = 
        `🚀 NEW CAMPAIGN ALERT!\n\n` +
        `Brand: ${campaign.brandName}\n` +
        `💰 Budget: ₦${campaign.budget.toLocaleString()}\n` +
        `👥 Participants needed: ${campaign.estimatedParticipants}\n` +
        `⏱️ Duration: ${campaign.duration} hours\n` +
        `📊 Estimated reach: ${formatNumber(campaign.estimatedReach)}\n\n` +
        `💡 ${campaign.description.substring(0, 100)}...\n\n` +
        `🤖 Smart assignments are being created!\n` +
        `Complete your profile for better matches: /profile`;
    
    let notified = 0;
    
    for (const user of activeUsers) {
        try {
            await bot.sendMessage(user.telegramId, message);
            notified++;
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.log(`❌ Failed to notify user ${user.firstName}: ${error.message}`);
        }
    }
    
    console.log(`📢 Notified ${notified}/${activeUsers.length} users about new campaign`);
}

// Helper function to format numbers
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// Telegram Bot Commands

// /start command - Register new user
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    try {
        // Check if user already exists
        const existingUser = await User.findOne({ telegramId: chatId.toString() });
        
        if (existingUser) {
            bot.sendMessage(chatId, `Welcome back, ${user.first_name}! 👋\n\nUse /help to see available commands.`);
            return;
        }
        
        // Create new user
        const newUser = new User({
            telegramId: chatId.toString(),
            firstName: user.first_name,
            lastName: user.last_name || '',
            username: user.username || '',
            isActive: true,
            earnings: 0,
            campaignsCompleted: 0,
            profileCompleted: false
        });
        
        await newUser.save();
        
        bot.sendMessage(chatId, 
            `🎉 Welcome to Twitter Engagement Platform, ${user.first_name}!\n\n` +
            `You're now registered and ready to earn money from Twitter engagement!\n\n` +
            `📱 Next steps:\n` +
            `1. Link your Twitter account with /twitter\n` +
            `2. Complete your smart profile (2 minutes)\n` +
            `3. Get matched with perfect campaigns!\n\n` +
            `💰 Users with completed profiles earn 20% more!`
        );
        
        console.log(`✅ New user registered: ${user.first_name} (${chatId})`);
        
    } catch (error) {
        console.error('❌ Error registering user:', error);
        bot.sendMessage(chatId, 'Sorry, there was an error registering you. Please try again.');
    }
});

// /help command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        `🤖 Twitter Engagement Platform Commands:\n\n` +
        `/start - Register/Login\n` +
        `/twitter - Link Twitter & complete smart profile\n` +
        `/profile - View your profile summary\n` +
        `/campaigns - View campaigns matched to you\n` +
        `/assignments - Check your active assignments\n` +
        `/earnings - Check your earnings\n` +
        `/status - Your account status\n` +
        `/help - Show this help\n\n` +
        `🧠 Smart Features:\n` +
        `• AI-powered profile matching\n` +
        `• Personalized campaign recommendations\n` +
        `• Authenticity-based earnings bonuses\n` +
        `• Profile-specific role assignments\n\n` +
        `💡 Complete your profile for better matches and higher earnings!`
    );
});

// CLEAN Twitter Bio Verification Command - REPLACE OLD VERSION
bot.onText(/\/twitter/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            bot.sendMessage(chatId, 'Please register first with /start');
            return;
        }
        
        // Check if user already has verified Twitter
        if (user.twitterHandle && user.twitterVerified) {
            bot.sendMessage(chatId, 
                `🐦 Twitter Account Already Verified!\n\n` +
                `✅ Current account: @${user.twitterHandle}\n\n` +
                `Want to change your Twitter account? Reply "change" to start over.`
            );
            
            // Wait for change confirmation
            bot.once('message', async (response) => {
                if (response.chat.id === chatId && 
                    response.text.toLowerCase().includes('change')) {
                    
                    // Reset verification
                    await User.findOneAndUpdate(
                        { telegramId: chatId.toString() },
                        { 
                            twitterHandle: null,
                            twitterVerified: false,
                            verificationCode: null
                        }
                    );
                    
                    bot.sendMessage(chatId, '🔄 Twitter account reset. Let\'s verify your new account!');
                    setTimeout(() => startCleanBioVerification(chatId), 1000);
                }
            });
            
            return;
        }
        
        startCleanBioVerification(chatId);
        
    } catch (error) {
        console.error('❌ Error in twitter command:', error);
        bot.sendMessage(chatId, 'Sorry, there was an error. Please try again.');
    }
});

// CLEAN Bio Verification Function - NO TWEETS
async function startCleanBioVerification(chatId) {
    bot.sendMessage(chatId, 
        `🐦 Twitter Account Verification\n\n` +
        `To prevent fraud, we need to verify you own this Twitter account.\n\n` +
        `📝 Step 1: Enter your Twitter username (without @):\n\n` +
        `Example: john_doe`
    );
    
    // Wait for Twitter handle
    bot.once('message', async (response) => {
        if (response.chat.id === chatId && !response.text.startsWith('/')) {
            try {
                const twitterHandle = response.text.trim().replace('@', '').toLowerCase();
                
                // Validate Twitter handle format
                if (!isValidTwitterHandle(twitterHandle)) {
                    bot.sendMessage(chatId, 
                        `❌ Invalid Twitter handle format.\n\n` +
                        `Please use only letters, numbers, and underscores.\n` +
                        `Try again with /twitter`
                    );
                    return;
                }
                
                // Check if handle is already verified by another user
                const existingUser = await User.findOne({ 
                    twitterHandle: twitterHandle,
                    twitterVerified: true,
                    telegramId: { $ne: chatId.toString() }
                });
                
                if (existingUser) {
                    bot.sendMessage(chatId, 
                        `❌ This Twitter handle is already verified by another user.\n\n` +
                        `If this is your account, please contact support.\n` +
                        `Otherwise, try a different handle with /twitter`
                    );
                    return;
                }
                
                // Generate verification code
                const verificationCode = generateVerificationCode();
                
                // Update user with unverified handle and code
                await User.findOneAndUpdate(
                    { telegramId: chatId.toString() },
                    { 
                        twitterHandle: twitterHandle,
                        twitterVerified: false,
                        verificationCode: verificationCode,
                        verificationExpires: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
                    }
                );
                
                // Send BIO verification instructions (DEFINITELY NOT TWEET)
                bot.sendMessage(chatId, 
                    `🔐 Twitter Bio Verification\n\n` +
                    `👤 Handle: @${twitterHandle}\n` +
                    `🔑 Code: ${verificationCode}\n\n` +
                    `📝 Step 2: Add this code to your Twitter bio:\n\n` +
                    `"${verificationCode}"\n\n` +
                    `💡 You can add it anywhere in your bio. Examples:\n` +
                    `• "Developer | Designer ${verificationCode}"\n` +
                    `• "${verificationCode} Love coding and design"\n` +
                    `• "Building cool stuff ${verificationCode} DM open"\n\n` +
                    `⏰ You have 30 minutes to update your bio.\n\n` +
                    `After updating your bio, reply "verify" to check.`
                );
                
                console.log(`🔐 Bio verification code generated for @${twitterHandle}: ${verificationCode}`);
                
                // Wait for verification command
                waitForCleanBioVerification(chatId, twitterHandle, verificationCode);
                
            } catch (error) {
                console.error('❌ Error starting verification:', error);
                bot.sendMessage(chatId, 'Sorry, there was an error starting verification. Please try again.');
            }
        }
    });
}

async function waitForCleanBioVerification(chatId, twitterHandle, verificationCode) {
    // Set up verification listener
    const verificationListener = async (msg) => {
        if (msg.chat.id === chatId) {
            if (msg.text && msg.text.toLowerCase().includes('verify')) {
                try {
                    await checkCleanBioVerification(chatId, twitterHandle, verificationCode);
                } catch (error) {
                    console.error('❌ Verification error:', error);
                    bot.sendMessage(chatId, 'Error during verification. Please try again.');
                }
                
                // Remove this listener
                bot.removeListener('message', verificationListener);
            } else if (msg.text && msg.text.startsWith('/')) {
                // User used another command, cancel verification
                bot.removeListener('message', verificationListener);
            }
        }
    };
    
    bot.on('message', verificationListener);
    
    // Auto-cancel after 30 minutes
    setTimeout(() => {
        bot.removeListener('message', verificationListener);
    }, 30 * 60 * 1000);
}

async function checkCleanBioVerification(chatId, twitterHandle, verificationCode) {
    bot.sendMessage(chatId, '🔍 Checking your Twitter bio for the verification code...');
    
    try {
        // Check if verification is still valid
        const user = await User.findOne({ 
            telegramId: chatId.toString(),
            verificationCode: verificationCode
        });
        
        if (!user || new Date() > user.verificationExpires) {
            bot.sendMessage(chatId, 
                `⏰ Verification Expired\n\n` +
                `Your verification session has expired.\n` +
                `Please start over with /twitter`
            );
            return;
        }
        
        // Simulate bio verification check
        const isVerified = await simulateBioVerification(twitterHandle, verificationCode);
        
        if (isVerified) {
            // Mark user as verified
            await User.findOneAndUpdate(
                { telegramId: chatId.toString() },
                { 
                    twitterVerified: true,
                    verificationCode: null,
                    verificationExpires: null,
                    verifiedAt: new Date()
                }
            );
            
            bot.sendMessage(chatId, 
                `🎉 Twitter Account Verified Successfully!\n\n` +
                `✅ @${twitterHandle} is now linked to your account.\n\n` +
                `You can now:\n` +
                `• Participate in campaigns\n` +
                `• Complete your profile for bonus earnings: /profile\n` +
                `• Check available campaigns: /campaigns\n\n` +
                `💡 You can remove "${verificationCode}" from your bio now if you want.`
            );
            
            console.log(`✅ Twitter verified: @${twitterHandle} for user ${chatId}`);
            
        } else {
            bot.sendMessage(chatId, 
                `❌ Verification Failed\n\n` +
                `We couldn't find the code "${verificationCode}" in @${twitterHandle}'s bio.\n\n` +
                `Please make sure:\n` +
                `• You added the exact code: ${verificationCode}\n` +
                `• Your Twitter profile is public (not private)\n` +
                `• You saved the bio changes\n` +
                `• You waited a few minutes after updating\n\n` +
                `Try again by replying "verify" or restart with /twitter`
            );
        }
        
    } catch (error) {
        console.error('❌ Error checking verification:', error);
        bot.sendMessage(chatId, 
            `⚠️ Verification Error\n\n` +
            `There was an error checking your verification.\n` +
            `Please try again in a few minutes or contact support.`
        );
    }
}

async function startTwitterVerification(chatId) {
    bot.sendMessage(chatId, 
        `🐦 Twitter Account Verification\n\n` +
        `To prevent fraud, we need to verify you own this Twitter account.\n\n` +
        `📝 Step 1: Enter your Twitter username (without @):\n\n` +
        `Example: john_doe`
    );
    
    // Wait for Twitter handle
    bot.once('message', async (response) => {
        if (response.chat.id === chatId && !response.text.startsWith('/')) {
            try {
                const twitterHandle = response.text.trim().replace('@', '').toLowerCase();
                
                // Validate Twitter handle format
                if (!isValidTwitterHandle(twitterHandle)) {
                    bot.sendMessage(chatId, 
                        `❌ Invalid Twitter handle format.\n\n` +
                        `Please use only letters, numbers, and underscores.\n` +
                        `Try again with /twitter`
                    );
                    return;
                }
                
                // Check if handle is already verified by another user
                const existingUser = await User.findOne({ 
                    twitterHandle: twitterHandle,
                    twitterVerified: true,
                    telegramId: { $ne: chatId.toString() }
                });
                
                if (existingUser) {
                    bot.sendMessage(chatId, 
                        `❌ This Twitter handle is already verified by another user.\n\n` +
                        `If this is your account, please contact support.\n` +
                        `Otherwise, try a different handle with /twitter`
                    );
                    return;
                }
                
                // Generate verification code
                const verificationCode = generateVerificationCode();
                
                // Update user with unverified handle and code
                await User.findOneAndUpdate(
                    { telegramId: chatId.toString() },
                    { 
                        twitterHandle: twitterHandle,
                        twitterVerified: false,
                        verificationCode: verificationCode,
                        verificationExpires: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
                    }
                );
                
                // Send verification instructions
                bot.sendMessage(chatId, 
                    `🔐 Twitter Verification Required\n\n` +
                    `👤 Handle: @${twitterHandle}\n` +
                    `🔑 Code: ${verificationCode}\n\n` +
                    `📝 Step 2: Post this exact tweet:\n\n` +
                    `"Verifying my Twitter for engagement campaigns: ${verificationCode} #TwitterEngagement"\n\n` +
                    `⏰ You have 15 minutes to post this tweet.\n\n` +
                    `After posting, reply "verify" to check verification.`
                );
                
                console.log(`🔐 Verification code generated for @${twitterHandle}: ${verificationCode}`);
                
                // Wait for verification command
                waitForVerification(chatId, twitterHandle, verificationCode);
                
            } catch (error) {
                console.error('❌ Error starting verification:', error);
                bot.sendMessage(chatId, 'Sorry, there was an error starting verification. Please try again.');
            }
        }
    });
}

function generateVerificationCode() {
    // Generate a unique 6-character code
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}

function isValidTwitterHandle(handle) {
    // Twitter handle validation
    const twitterRegex = /^[A-Za-z0-9_]{1,15}$/;
    return twitterRegex.test(handle);
}

async function waitForVerification(chatId, twitterHandle, verificationCode) {
    // Set up verification listener
    const verificationListener = async (msg) => {
        if (msg.chat.id === chatId) {
            if (msg.text && msg.text.toLowerCase().includes('verify')) {
                try {
                    await checkTwitterVerification(chatId, twitterHandle, verificationCode);
                } catch (error) {
                    console.error('❌ Verification error:', error);
                    bot.sendMessage(chatId, 'Error during verification. Please try again.');
                }
                
                // Remove this listener
                bot.removeListener('message', verificationListener);
            } else if (msg.text && msg.text.startsWith('/')) {
                // User used another command, cancel verification
                bot.removeListener('message', verificationListener);
            }
        }
    };
    
    bot.on('message', verificationListener);
    
    // Auto-cancel after 15 minutes
    setTimeout(() => {
        bot.removeListener('message', verificationListener);
    }, 15 * 60 * 1000);
}

async function checkTwitterVerification(chatId, twitterHandle, verificationCode) {
    bot.sendMessage(chatId, '🔍 Checking your Twitter for the verification tweet...');
    
    try {
        // For now, we'll simulate the Twitter API check
        // In production, you'd use Twitter API v2 to search for the tweet
        const isVerified = await simulateTwitterVerification(twitterHandle, verificationCode);
        
        if (isVerified) {
            // Mark user as verified
            await User.findOneAndUpdate(
                { telegramId: chatId.toString() },
                { 
                    twitterVerified: true,
                    verificationCode: null,
                    verificationExpires: null,
                    verifiedAt: new Date()
                }
            );
            
            bot.sendMessage(chatId, 
                `🎉 Twitter Account Verified Successfully!\n\n` +
                `✅ @${twitterHandle} is now linked to your account.\n\n` +
                `You can now:\n` +
                `• Participate in campaigns\n` +
                `• Complete your profile for bonus earnings: /profile\n` +
                `• Check available campaigns: /campaigns\n\n` +
                `💡 You can delete the verification tweet if you want.`
            );
            
            console.log(`✅ Twitter verified: @${twitterHandle} for user ${chatId}`);
            
        } else {
            bot.sendMessage(chatId, 
                `❌ Verification Failed\n\n` +
                `We couldn't find the verification tweet on @${twitterHandle}.\n\n` +
                `Please make sure:\n` +
                `• You posted the exact text with code: ${verificationCode}\n` +
                `• The tweet is public (not private)\n` +
                `• You waited a few minutes after posting\n\n` +
                `Try again by replying "verify" or restart with /twitter`
            );
        }
        
    } catch (error) {
        console.error('❌ Error checking verification:', error);
        bot.sendMessage(chatId, 
            `⚠️ Verification Error\n\n` +
            `There was an error checking your verification.\n` +
            `Please try again in a few minutes or contact support.`
        );
    }
}

// Simulate Twitter verification (replace with real Twitter API in production)
async function simulateTwitterVerification(twitterHandle, verificationCode) {
    // For demo purposes, we'll return true after a delay
    // In production, you'd use Twitter API v2 to search for tweets
    
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
    
    // For now, always return true for demo
    // In production, this would search Twitter for the tweet containing the verification code
    return true;
    
    /* Real implementation would look like:
    
    const twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    
    try {
        const tweets = await twitterClient.v2.search(`from:${twitterHandle} "${verificationCode}"`, {
            max_results: 10,
            'tweet.fields': 'created_at'
        });
        
        return tweets.data && tweets.data.length > 0;
    } catch (error) {
        console.error('Twitter API error:', error);
        return false;
    }
    */
}

// Smart Profiling System (Optional) - Updated for MongoDB
async function startSmartProfiling(chatId) {
    try {
        // Clear any existing state first
        await ProfilingState.deleteOne({ userId: chatId.toString() });
        
        // Create new profiling state
        const profilingState = new ProfilingState({
            userId: chatId.toString(),
            currentQuestion: 0,
            answers: {},
            questionOrder: ['age_range', 'daily_routine', 'spending_priority', 'influence_style', 'discovery_style']
        });
        
        await profilingState.save();
        
        console.log(`🧠 Started profiling for user ${chatId}`);
        
        askProfilingQuestion(chatId);
    } catch (error) {
        console.error('❌ Error starting profiling:', error);
        bot.sendMessage(chatId, 'Sorry, there was an error starting your profile. Please try again with /profile');
    }
}

async function askProfilingQuestion(chatId) {
    try {
        const state = await ProfilingState.findOne({ userId: chatId.toString() });
        
        if (!state) {
            console.log(`❌ No state found for user ${chatId}, restarting profiling`);
            startSmartProfiling(chatId);
            return;
        }
        
        const questionKey = state.questionOrder[state.currentQuestion];
        const question = PROFILING_QUESTIONS[questionKey];
        
        if (!question) {
            completeUserProfile(chatId);
            return;
        }
        
        const questionNumber = state.currentQuestion + 1;
        const totalQuestions = state.questionOrder.length;
        
        console.log(`❓ Asking question ${questionNumber}/${totalQuestions} to user ${chatId}: ${questionKey}`);
        
        let message = `📊 Profile Question ${questionNumber}/${totalQuestions}\n\n`;
        message += `${question.question}\n\n`;
        
        // Initialize answers array for multiple choice questions
        if (question.type === 'multiple' && !state.answers[questionKey]) {
            state.answers[questionKey] = [];
            await state.save();
        }
        
        // Create inline keyboard with options
        const keyboard = question.options.map((option, index) => {
            let text = `${index + 1}. ${option}`;
            
            // Add checkmark for multiple choice if already selected
            if (question.type === 'multiple' && state.answers[questionKey] && state.answers[questionKey].includes(option)) {
                text = `✅ ${text}`;
            }
            
            return [{ text: text, callback_data: `profile_${questionKey}_${index}` }];
        });
        
        // Add "Done" button for multiple choice questions
        if (question.type === 'multiple') {
            const selectedCount = state.answers[questionKey] ? state.answers[questionKey].length : 0;
            if (selectedCount > 0) {
                keyboard.push([{ 
                    text: `✅ Done (${selectedCount} selected)`, 
                    callback_data: `profile_${questionKey}_done` 
                }]);
            }
            message += `💡 You can select multiple options. Tap "Done" when finished.`;
        }
        
        bot.sendMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: keyboard
            }
        }).then(() => {
            console.log(`✅ Question sent successfully to ${chatId}`);
        }).catch(error => {
            console.log(`❌ Failed to send question to ${chatId}:`, error.message);
        });
        
    } catch (error) {
        console.error('❌ Error asking profiling question:', error);
        bot.sendMessage(chatId, 'Sorry, there was an error with the profiling. Please try again with /profile');
    }
}

// Handle profiling answers - Updated for MongoDB
bot.on('callback_query', async (query) => {
    console.log('🔍 Callback query received:', query.data);
    
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (data.startsWith('profile_')) {
        console.log('📊 Processing profile callback:', data);
        
        try {
            // Parse callback data
            const parts = data.split('_');
            const lastPart = parts.pop(); // Could be option index or 'done'
            parts.shift(); // Remove 'profile'
            const questionKey = parts.join('_');
            
            console.log('🔍 Parsed questionKey:', questionKey, 'action:', lastPart);
            
            let state = await ProfilingState.findOne({ userId: chatId.toString() });
            
            if (!state) {
                console.log('❌ State lost, sending restart message');
                bot.sendMessage(chatId, 
                    `🔄 Sorry! Your session was interrupted.\n\n` +
                    `Let's restart your profile. Use /profile to begin again.`
                );
                bot.answerCallbackQuery(query.id);
                return;
            }
            
            const question = PROFILING_QUESTIONS[questionKey];
            if (!question) {
                console.log('❌ Invalid question key:', questionKey);
                bot.answerCallbackQuery(query.id);
                return;
            }
            
            // Handle "Done" for multiple choice
            if (lastPart === 'done') {
                if (question.type === 'multiple') {
                    const selectedOptions = state.answers[questionKey] || [];
                    
                    bot.editMessageText(
                        `✅ ${question.question}\n\nYour answers: ${selectedOptions.join(', ')}`,
                        {
                            chat_id: chatId,
                            message_id: query.message.message_id
                        }
                    );
                    
                    // Move to next question
                    state.currentQuestion++;
                    await state.save();
                    
                    setTimeout(() => {
                        askProfilingQuestion(chatId);
                    }, 1500);
                }
                bot.answerCallbackQuery(query.id);
                return;
            }
            
            // Handle option selection
            const optionIndex = parseInt(lastPart);
            const selectedOption = question.options[optionIndex];
            
            if (!selectedOption) {
                console.log('❌ Invalid option index:', optionIndex);
                bot.answerCallbackQuery(query.id);
                return;
            }
            
            console.log(`✅ Option selected: ${questionKey} = ${selectedOption}`);
            
            if (question.type === 'multiple') {
                // Handle multiple choice
                if (!state.answers[questionKey]) {
                    state.answers[questionKey] = [];
                }
                
                // Toggle selection
                const currentAnswers = state.answers[questionKey];
                const index = currentAnswers.indexOf(selectedOption);
                
                if (index > -1) {
                    // Remove if already selected
                    currentAnswers.splice(index, 1);
                    console.log(`➖ Removed selection: ${selectedOption}`);
                } else {
                    // Add if not selected
                    currentAnswers.push(selectedOption);
                    console.log(`➕ Added selection: ${selectedOption}`);
                }
                
                // Save state
                state.answers[questionKey] = currentAnswers;
                await state.save();
                
                // Re-ask the same question with updated selections
                askProfilingQuestion(chatId);
                
            } else {
                // Handle single choice
                state.answers[questionKey] = selectedOption;
                await state.save();
                
                bot.editMessageText(
                    `✅ ${question.question}\n\nYour answer: ${selectedOption}`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                );
                
                // Move to next question
                state.currentQuestion++;
                await state.save();
                
                setTimeout(() => {
                    askProfilingQuestion(chatId);
                }, 1500);
            }
            
        } catch (error) {
            console.error('❌ Error handling callback query:', error);
            bot.sendMessage(chatId, 'Sorry, there was an error processing your selection. Please try again.');
        }
    }
    
    bot.answerCallbackQuery(query.id).catch(error => {
        console.log('❌ Answer callback query error:', error.message);
    });
});

async function completeUserProfile(chatId) {
    try {
        const state = await ProfilingState.findOne({ userId: chatId.toString() });
        
        if (!state) {
            console.log('❌ No profiling state found for completion');
            return;
        }
        
        // Generate user persona
        const persona = generateUserPersona(state.answers);
        
        // Update user in database
        await User.findOneAndUpdate(
            { telegramId: chatId.toString() },
            { 
                profile: persona,
                profileAnswers: state.answers,
                profileCompleted: true,
                profileCompletedAt: new Date()
            }
        );
        
        // Send personalized completion message
        const completionMessage = generateCompletionMessage(persona);
        
        bot.sendMessage(chatId, completionMessage);
        
        // Clean up profiling state
        await ProfilingState.deleteOne({ userId: chatId.toString() });
        
        console.log(`🧠 Profile completed for user ${chatId}: ${persona.primaryProfile.label}`);
        
    } catch (error) {
        console.error('❌ Error completing user profile:', error);
        bot.sendMessage(chatId, 'Sorry, there was an error completing your profile. Please try again.');
    }
}

function generateUserPersona(answers) {
    // Generate persona based on answers
    const persona = {
        primaryProfile: determineProfile(answers),
        spendingPower: determineSpendingPower(answers),
        authenticityScore: determineAuthenticity(answers),
        marketingValue: "high"
    };
    
    persona.recommendedCampaignTypes = getRecommendedCampaigns(persona, answers);
    
    return persona;
}

function determineProfile(answers) {
    const routine = answers.daily_routine || [];
    const spending = answers.spending_priority || "";
    const influence = answers.influence_style || "";
    
    // Convert routine to string for easier checking (handle both array and string)
    const routineStr = Array.isArray(routine) ? routine.join(' ') : routine;
    
    // Smart profile matching with multiple selections
    if (routineStr.includes("Classes") && spending.includes("gadgets")) {
        return {
            label: "Tech-Savvy Student",
            description: "University students passionate about technology and gadgets",
            bestFor: ["tech_products", "educational_apps", "student_services"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routineStr.includes("Classes") && spending.includes("Basic needs")) {
        return {
            label: "Budget-Smart Student",
            description: "Students who prioritize value and affordability", 
            bestFor: ["affordable_products", "student_discounts", "value_services"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routineStr.includes("business") && routineStr.includes("Creative")) {
        return {
            label: "Creative Entrepreneur",
            description: "Creative professionals running their own business",
            bestFor: ["creative_tools", "business_services", "artistic_products"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routineStr.includes("Office") && spending.includes("Fashion")) {
        return {
            label: "Style-Conscious Professional",
            description: "Young professionals who care about image and status",
            bestFor: ["fashion", "premium_products", "professional_services"],
            authenticityLevel: "high"
        };
    }
    
    if (routineStr.includes("business") && spending.includes("Skills")) {
        return {
            label: "Growth-Focused Entrepreneur", 
            description: "Business-minded individuals focused on growth and learning",
            bestFor: ["business_tools", "productivity_apps", "courses"],
            authenticityLevel: "high"
        };
    }
    
    if (routineStr.includes("Creative") && influence.includes("genuinely love")) {
        return {
            label: "Passionate Creative",
            description: "Artists and creators who genuinely love what they share",
            bestFor: ["creative_tools", "artistic_products", "unique_brands"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routineStr.includes("Job hunting") && influence.includes("value for money")) {
        return {
            label: "Honest Value Advisor",
            description: "Job seekers who give very honest opinions about value",
            bestFor: ["affordable_products", "job_services", "skill_development"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routineStr.includes("Classes") && routineStr.includes("Job hunting")) {
        return {
            label: "Ambitious Student",
            description: "Students actively preparing for their career",
            bestFor: ["educational_services", "career_tools", "skill_development"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routineStr.includes("Office") && routineStr.includes("Creative")) {
        return {
            label: "Creative Professional",
            description: "Working professionals with creative side projects",
            bestFor: ["creative_tools", "productivity_apps", "lifestyle_brands"],
            authenticityLevel: "high"
        };
    }
    
    // Default profile
    return {
        label: "Authentic Influencer",
        description: "Genuine social media user with authentic voice",
        bestFor: ["general_products", "lifestyle_brands"],
        authenticityLevel: "high"
    };
}

function determineSpendingPower(answers) {
    const age = answers.age_range || "";
    const routine = answers.daily_routine || "";
    const spending = answers.spending_priority || "";
    
    if (routine.includes("Classes") || spending.includes("Basic needs")) {
        return "emerging";
    }
    
    if (routine.includes("business") || spending.includes("investments")) {
        return "high";
    }
    
    if (routine.includes("Office") && (age.includes("26-30") || age.includes("31-35"))) {
        return "moderate_to_high";
    }
    
    return "moderate";
}

function determineAuthenticity(answers) {
    let score = 70; // Base score
    
    const influence = answers.influence_style || "";
    const discovery = answers.discovery_style || "";
    const routine = answers.daily_routine || "";
    
    if (influence.includes("genuinely love")) score += 20;
    if (influence.includes("solved a real problem")) score += 15;
    if (discovery.includes("friends and people I trust")) score += 10;
    if (routine.includes("Classes") || routine.includes("Job hunting")) score += 15;
    
    return Math.min(100, score);
}

function getRecommendedCampaigns(persona, answers) {
    const campaigns = [];
    
    // Add campaign types based on profile
    if (persona.primaryProfile.bestFor.includes("tech_products")) {
        campaigns.push("Tech & Gadgets", "Apps & Software", "Educational Technology");
    }
    
    if (persona.spendingPower === "high") {
        campaigns.push("Premium Brands", "Luxury Products", "Investment Services");
    }
    
    if (persona.authenticityScore > 85) {
        campaigns.push("Authentic Reviews", "Personal Experience Sharing", "Honest Testimonials");
    }
    
    if (persona.primaryProfile.bestFor.includes("affordable_products")) {
        campaigns.push("Budget-Friendly Products", "Student Discounts", "Value Services");
    }
    
    return campaigns.slice(0, 5); // Limit to top 5
}

function generateCompletionMessage(persona) {
    return `🎉 Profile Complete!\n\n` +
           `Your Profile: **${persona.primaryProfile.label}**\n` +
           `${persona.primaryProfile.description}\n\n` +
           `💰 Spending Power: ${persona.spendingPower.replace('_', ' ').toUpperCase()}\n` +
           `🎯 Authenticity Score: ${persona.authenticityScore}/100\n\n` +
           `✨ You're perfect for these campaign types:\n` +
           persona.recommendedCampaignTypes.map(type => `• ${type}`).join('\n') + '\n\n' +
           `💰 Earnings Boost: You'll now earn 15-25% more on campaigns!\n\n` +
           `🚀 You're all set! Use /campaigns to see what's available!`;
}

// /profile command - View or complete profile
bot.onText(/\/profile/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    if (!user.twitterHandle) {
        bot.sendMessage(chatId, 
            `🐦 Please link your Twitter account first!\n\n` +
            `Use /twitter to link your account.`
        );
        return;
    }
    
    if (!user.profileCompleted) {
        bot.sendMessage(chatId, 
            `🧠 Complete Your Profile for Bonus Earnings!\n\n` +
            `📈 Benefits:\n` +
            `• 15% base bonus on all campaigns\n` +
            `• Up to 25% bonus for perfect matches\n` +
            `• Priority for campaigns in your interests\n` +
            `• Better role assignments\n\n` +
            `⏱️ Takes just 2 minutes!\n\n` +
            `Reply "start" to begin the profile questionnaire.`
        );
        
        // Wait for confirmation
        bot.once('message', (response) => {
            if (response.chat.id === chatId && 
                response.text.toLowerCase().includes('start')) {
                
                startSmartProfiling(chatId);
            }
        });
        
        return;
    }
    
    // Show completed profile
    const profile = user.profile;
    const message = 
        `👤 Your Profile Summary\n\n` +
        `🎯 Profile Type: ${profile.primaryProfile.label}\n` +
        `📝 Description: ${profile.primaryProfile.description}\n\n` +
        `💰 Spending Power: ${profile.spendingPower.replace('_', ' ').toUpperCase()}\n` +
        `🎭 Authenticity Score: ${profile.authenticityScore}/100\n` +
        `⭐ Marketing Value: ${profile.marketingValue.toUpperCase()}\n\n` +
        `✨ Best Campaign Types:\n` +
        profile.recommendedCampaignTypes.map(type => `• ${type}`).join('\n') + '\n\n' +
        `💰 Earnings Bonus: ${profile.authenticityScore > 80 ? '15-25%' : '15%'}\n\n` +
        `🔄 Want to retake the questionnaire? Reply "retake"`;
    
    bot.sendMessage(chatId, message);
    
    // Allow profile retaking
    bot.once('message', (response) => {
        if (response.chat.id === chatId && 
            response.text.toLowerCase().includes('retake')) {
            
            bot.sendMessage(chatId, `🔄 Retaking profile questionnaire...`);
            
            setTimeout(() => {
                startSmartProfiling(chatId);
            }, 1000);
        }
    });
});

// /campaigns command - Show campaigns to everyone
bot.onText(/\/campaigns/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    if (!user.twitterHandle) {
        bot.sendMessage(chatId, 
            `🐦 Please link your Twitter account first!\n\n` +
            `Use /twitter to link your account and start earning!`
        );
        return;
    }
    
    const availableCampaigns = campaigns.filter(c => c.status === 'pending' || c.status === 'active');
    
    if (availableCampaigns.length === 0) {
        let message = `📋 No Active Campaigns\n\n` +
                     `There are no campaigns available right now.\n` +
                     `New campaigns are posted regularly!\n\n`;
        
        if (user.profileCompleted) {
            message += `💡 Your profile: ${user.profile.primaryProfile.label}\n` +
                      `You'll get priority for: ${user.profile.recommendedCampaignTypes.slice(0, 2).join(', ')}`;
        } else {
            message += `💡 Complete your profile with /twitter for bonus earnings!`;
        }
        
        bot.sendMessage(chatId, message);
    } else {
        let message = `🚀 Available Campaigns:\n\n`;
        
        availableCampaigns.forEach((campaign, index) => {
            const baseEarning = Math.round(campaign.budget * 0.65 / campaign.estimatedParticipants);
            
            message += `${index + 1}. ${campaign.brandName}\n`;
            message += `💰 Base Earning: ₦${baseEarning.toLocaleString()}\n`;
            
            // Show potential bonuses
            if (user.profileCompleted) {
                const profileBonus = Math.round(baseEarning * 0.15);
                const isMatch = isUserMatchForCampaign(user, campaign);
                
                if (isMatch && user.profile.authenticityScore > 80) {
                    const totalBonus = Math.round(baseEarning * 0.25);
                    message += `🎯 Your Potential: ₦${(baseEarning + totalBonus).toLocaleString()} (Perfect Match!)\n`;
                } else {
                    message += `💡 Your Potential: ₦${(baseEarning + profileBonus).toLocaleString()} (Profile Bonus)\n`;
                }
            } else {
                const profileBonus = Math.round(baseEarning * 0.15);
                message += `💡 With Profile: ₦${(baseEarning + profileBonus).toLocaleString()} (Complete /twitter)\n`;
            }
            
            message += `⏱️ Duration: ${campaign.duration} hours\n`;
            message += `👥 Spots: ${campaign.participants.length}/${campaign.estimatedParticipants}\n`;
            message += `📊 Package: ${campaign.package}\n\n`;
        });
        
        message += `🎯 Everyone gets selected based on fairness and availability!\n`;
        if (!user.profileCompleted) {
            message += `💡 Complete your profile for bonus earnings: /twitter`;
        } else {
            message += `✅ Profile complete - you're ready for bonus earnings!`;
        }
        
        bot.sendMessage(chatId, message);
    }
});

// /assignments command - Check your current assignments
bot.onText(/\/assignments/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    const userAssignments = assignments.filter(a => a.userId === chatId);
    
    if (userAssignments.length === 0) {
        let message = `📋 No Current Assignments\n\n` +
                     `You don't have any active assignments right now.\n` +
                     `Make sure your Twitter account is linked with /twitter!\n\n`;
        
        if (!user.profileCompleted) {
            message += `💡 Complete your profile for bonus earnings: /profile`;
        } else {
            message += `✅ Profile complete - you're ready for campaigns!`;
        }
        
        bot.sendMessage(chatId, message);
        return;
    }
    
    let message = `📋 Your Active Assignments:\n\n`;
    
    userAssignments.forEach((assignment, index) => {
        const campaign = getCampaignById(assignment.campaignId);
        const timeUntil = getTimeUntilScheduled(assignment.scheduledTime);
        
        message += `${index + 1}. ${campaign.brandName}\n`;
        message += `Role: ${assignment.role.toUpperCase()}\n`;
        message += `💰 Earning: ₦${assignment.estimatedEarning.toLocaleString()}\n`;
        message += `⏰ ${timeUntil}\n`;
        message += `Status: ${assignment.status === 'pending' ? '⏳ Scheduled' : assignment.status}\n\n`;
    });
    
    message += `💡 We'll remind you 15 minutes before each assignment!`;
    
    bot.sendMessage(chatId, message);
});

function getTimeUntilScheduled(scheduledTime) {
    const now = new Date();
    const timeDiff = scheduledTime - now;
    
    if (timeDiff < 0) {
        return '🔴 Overdue';
    }
    
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return `in ${hours}h ${minutes}m`;
    } else {
        return `in ${minutes}m`;
    }
}

// /earnings command
bot.onText(/\/earnings/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    // Calculate potential bonus
    let bonusInfo = '';
    if (user.profileCompleted && user.profile) {
        const bonusPercent = user.profile.authenticityScore > 80 ? '15-25%' : '15%';
        bonusInfo = `\n🎯 Profile Bonus: ${bonusPercent} extra on all campaigns!`;
    } else {
        bonusInfo = `\n💡 Complete /profile for 15-25% bonus earnings!`;
    }
    
    bot.sendMessage(chatId, 
        `💰 Your Earnings Summary\n\n` +
        `Total Earned: ₦${user.earnings || 0}\n` +
        `Campaigns Completed: ${user.campaigns || 0}\n` +
        `Account Status: ${user.isActive ? '✅ Active' : '❌ Inactive'}${bonusInfo}\n\n` +
        `💡 Keep participating to earn more!`
    );
});

// /status command - Updated to show verification status
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            bot.sendMessage(chatId, `Please register first with /start`);
            return;
        }
        
        // Twitter verification status
        let twitterStatus = '';
        if (!user.twitterHandle) {
            twitterStatus = `❌ Not linked - Use /twitter to link account`;
        } else if (!user.twitterVerified) {
            if (user.verificationCode && user.verificationExpires > new Date()) {
                const timeLeft = Math.ceil((user.verificationExpires - new Date()) / (1000 * 60));
                twitterStatus = `⏳ Verification pending - ${timeLeft} min left\n` +
                               `Code: ${user.verificationCode}\n` +
                               `Add to @${user.twitterHandle} bio, then reply "verify"`;
            } else {
                twitterStatus = `🔐 Not verified - Use /twitter to verify @${user.twitterHandle}`;
            }
        } else {
            twitterStatus = `✅ @${user.twitterHandle} (verified ${user.verifiedAt ? user.verifiedAt.toDateString() : ''})`;
        }
        
        // Profile status
        let profileStatus = '';
        if (user.profileCompleted && user.profile) {
            profileStatus = `✅ ${user.profile.primaryProfile.label} (${user.profile.authenticityScore}/100)`;
        } else {
            profileStatus = `❌ Not completed (missing bonus earnings!)`;
        }
        
        bot.sendMessage(chatId, 
            `📊 Account Status\n\n` +
            `Name: ${user.firstName} ${user.lastName}\n` +
            `Twitter: ${twitterStatus}\n` +
            `Profile: ${profileStatus}\n` +
            `Account: ${user.isActive ? '✅ Active' : '❌ Inactive'}\n` +
            `Registered: ${user.registeredAt.toDateString()}\n` +
            `Total Earnings: ₦${user.earnings || 0}\n\n` +
            `${!user.twitterHandle ? '📝 Next: Link Twitter with /twitter' : 
              !user.twitterVerified ? '🔐 Next: Complete verification' :
              !user.profileCompleted ? '🧠 Next: Complete profile with /profile' : 
              '🎉 You\'re all set for maximum earnings!'}`
        );
        
    } catch (error) {
        console.error('❌ Error in status command:', error);
        bot.sendMessage(chatId, 'Sorry, there was an error fetching your status. Please try again.');
    }
});

// Handle unknown commands
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Ignore if it's a command we handle or not a command
    if (!text || !text.startsWith('/') || text.match(/\/(start|help|twitter|campaigns|earnings|status|assignments|profile)/)) {
        return;
    }
    
    bot.sendMessage(chatId, 
        `❓ Unknown command: ${text}\n\n` +
        `Use /help to see available commands.`
    );
});

// Error handling for bot
bot.on('error', (error) => {
    console.log('❌ Bot error:', error.message);
});

bot.on('polling_error', (error) => {
    console.log('❌ Polling error:', error.message);
});

// Start our server
app.listen(PORT, async () => {
    try {
        const totalUsers = await User.countDocuments();
        const activeCampaigns = await Campaign.countDocuments({ status: { $in: ['pending', 'active'] } });
        
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`🤖 Telegram bot is active and listening...`);
        console.log(`📊 Database: MongoDB connected`);
        console.log(`👥 Total registered users: ${totalUsers}`);
        console.log(`📱 Active campaigns: ${activeCampaigns}`);
        console.log(`🧠 Smart profiling enabled - users earn bonus for completing profiles!`);
    } catch (error) {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`🤖 Telegram bot is active and listening...`);
        console.log(`⚠️ Database connection status unknown`);
        console.log(`📱 Go to Telegram and message your bot to test it!`);
    }
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server and bot...');
    bot.stopPolling();
    process.exit(0);
});