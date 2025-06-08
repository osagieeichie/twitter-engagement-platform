// server.js - Our main server with Telegram Bot
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Get bot token from environment file
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Check if we have the bot token
if (!BOT_TOKEN) {
    console.log('❌ ERROR: Please add your TELEGRAM_BOT_TOKEN to the .env file');
    process.exit(1);
}

// Create Telegram bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// This lets our server understand JSON data
app.use(express.json());

// Store users in memory for now (later we'll use a database)
let users = [];
let campaigns = [];
let assignments = [];
let cooldowns = {}; // Track user cooldowns

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

// Serve static files (like our dashboard)
app.use(express.static('.'));

// Web routes
app.get('/', (req, res) => {
    res.json({ 
        message: 'Welcome to Twitter Engagement Platform!',
        status: 'Server is running',
        totalUsers: users.length,
        activeCampaigns: campaigns.length
    });
});

// Serve the dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

// API route to create campaigns
app.post('/api/campaigns/create', (req, res) => {
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
        const newCampaign = {
            id: Date.now().toString(), // Simple ID for now
            ...campaignData,
            status: 'pending',
            createdAt: new Date(),
            participants: [],
            totalEngagement: 0
        };
        
        // Add to campaigns array
        campaigns.push(newCampaign);
        
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
            campaignId: newCampaign.id
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
app.get('/api/campaigns', (req, res) => {
    res.json({
        success: true,
        campaigns: campaigns.map(campaign => ({
            id: campaign.id,
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
});

app.get('/users', (req, res) => {
    res.json({ 
        message: 'Registered Users',
        users: users.map(user => ({
            name: user.firstName,
            telegramId: user.telegramId,
            isActive: user.isActive || false
        }))
    });
});

// Automatic Assignment System
function createAutomaticAssignments(campaign) {
    console.log(`🤖 Creating automatic assignments for: ${campaign.brandName}`);
    
    // Get available users (not in cooldown, has Twitter account)
    const availableUsers = getAvailableUsers();
    
    if (availableUsers.length === 0) {
        console.log('⚠️ No available users for assignments');
        return;
    }
    
    // Calculate how many users we need (up to the campaign's estimated participants)
    const maxParticipants = Math.min(availableUsers.length, campaign.estimatedParticipants);
    const selectedUsers = selectBestUsers(availableUsers, maxParticipants);
    
    // Distribute roles among selected users
    const roleDistribution = distributeRoles(selectedUsers);
    
    // Create assignments with organic timing
    const campaignAssignments = createTimedAssignments(campaign, roleDistribution);
    
    // Store assignments
    assignments.push(...campaignAssignments);
    
    // Update campaign with participants
    campaign.participants = selectedUsers.map(user => user.telegramId);
    campaign.status = 'active';
    
    // Notify selected users
    notifySelectedUsers(campaignAssignments);
    
    console.log(`✅ Created ${campaignAssignments.length} assignments for ${selectedUsers.length} users`);
}

function getAvailableUsers() {
    const now = new Date();
    
    return users.filter(user => {
        // Must have Twitter account and be active
        if (!user.twitterHandle || !user.isActive) return false;
        
        // Check cooldown
        const userCooldown = cooldowns[user.telegramId];
        if (userCooldown && now < userCooldown.until) return false;
        
        return true;
    });
}

function selectBestUsers(availableUsers, maxParticipants) {
    // Sort users by engagement score and last participation
    const scoredUsers = availableUsers.map(user => {
        const timeSinceLastParticipation = getTimeSinceLastParticipation(user);
        const engagementScore = user.engagementRate || 5; // Default engagement rate
        
        // Score combines engagement and fairness (time since last participation)
        const score = (engagementScore * 0.6) + (timeSinceLastParticipation * 0.4);
        
        return { ...user, score };
    });
    
    // Sort by score (highest first) and take the best users
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

function distributeRoles(selectedUsers) {
    const totalUsers = selectedUsers.length;
    const roles = {
        initiators: Math.ceil(totalUsers * ASSIGNMENT_CONFIG.roles.initiator),
        repliers: Math.ceil(totalUsers * ASSIGNMENT_CONFIG.roles.replier),
        retweeters: Math.ceil(totalUsers * ASSIGNMENT_CONFIG.roles.retweeter),
        quoters: Math.ceil(totalUsers * ASSIGNMENT_CONFIG.roles.quoter)
    };
    
    // Make sure we don't exceed total users
    const totalRoles = Object.values(roles).reduce((sum, count) => sum + count, 0);
    if (totalRoles > totalUsers) {
        // Adjust by reducing largest categories first
        const excess = totalRoles - totalUsers;
        roles.repliers = Math.max(1, roles.repliers - Math.ceil(excess / 2));
        roles.retweeters = Math.max(1, roles.retweeters - Math.floor(excess / 2));
    }
    
    const distribution = [];
    let userIndex = 0;
    
    // Assign roles
    ['initiators', 'repliers', 'retweeters', 'quoters'].forEach(roleType => {
        const role = roleType.slice(0, -1); // Remove 's' to get singular
        for (let i = 0; i < roles[roleType] && userIndex < selectedUsers.length; i++) {
            distribution.push({
                user: selectedUsers[userIndex],
                role: role
            });
            userIndex++;
        }
    });
    
    return distribution;
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
            estimatedEarning: calculateEarning(campaign, assignment.role)
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

async function notifySelectedUsers(assignments) {
    for (const assignment of assignments) {
        try {
            const message = 
                `🎉 YOU'VE BEEN SELECTED!\n\n` +
                `Campaign: ${getCampaignById(assignment.campaignId).brandName}\n` +
                `Your Role: ${assignment.role.toUpperCase()}\n` +
                `💰 Estimated Earning: ₦${assignment.estimatedEarning.toLocaleString()}\n` +
                `⏰ Scheduled: ${assignment.scheduledTime.toLocaleString()}\n\n` +
                `📝 Suggested Content:\n"${assignment.content}"\n\n` +
                `💡 You can customize this message to match your style!\n` +
                `We'll remind you 15 minutes before it's time.`;
            
            await bot.sendMessage(assignment.userId, message);
            
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

// Function to notify users about new campaigns (updated)
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
        `🤖 Assignments are being created automatically!\n` +
        `Check /campaigns to see if you're selected!`;
    
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
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    // Check if user already exists
    const existingUser = users.find(u => u.telegramId === chatId);
    
    if (existingUser) {
        bot.sendMessage(chatId, `Welcome back, ${user.first_name}! 👋\n\nUse /help to see available commands.`);
        return;
    }
    
    // Add new user
    const newUser = {
        telegramId: chatId,
        firstName: user.first_name,
        lastName: user.last_name || '',
        username: user.username || '',
        registeredAt: new Date(),
        isActive: true,
        earnings: 0,
        campaigns: 0
    };
    
    users.push(newUser);
    
    bot.sendMessage(chatId, 
        `🎉 Welcome to Twitter Engagement Platform, ${user.first_name}!\n\n` +
        `You're now registered and ready to earn money from Twitter engagement!\n\n` +
        `📱 Next steps:\n` +
        `1. Link your Twitter account with /twitter\n` +
        `2. Check available campaigns with /campaigns\n` +
        `3. Get help anytime with /help\n\n` +
        `💰 Start earning today!`
    );
    
    console.log(`✅ New user registered: ${user.first_name} (${chatId})`);
});

// /help command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        `🤖 Twitter Engagement Platform Commands:\n\n` +
        `/start - Register/Login\n` +
        `/twitter - Link Twitter account\n` +
        `/campaigns - View available campaigns\n` +
        `/assignments - Check your active assignments\n` +
        `/earnings - Check your earnings\n` +
        `/status - Your account status\n` +
        `/help - Show this help\n\n` +
        `💡 Tip: Assignments are created automatically!\n` +
        `Stay active and keep your Twitter linked!`
    );
});

// /twitter command - Link Twitter account
bot.onText(/\/twitter/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        `🐦 Link Your Twitter Account\n\n` +
        `To participate in campaigns, we need your Twitter handle.\n\n` +
        `Please reply with your Twitter username (without @):\n` +
        `Example: john_doe\n\n` +
        `📝 Type your Twitter handle:`
    );
    
    // Wait for next message from this user
    bot.once('message', (response) => {
        if (response.chat.id === chatId && !response.text.startsWith('/')) {
            const twitterHandle = response.text.trim().replace('@', '');
            
            // Update user with Twitter handle
            const userIndex = users.findIndex(u => u.telegramId === chatId);
            if (userIndex !== -1) {
                users[userIndex].twitterHandle = twitterHandle;
                
                bot.sendMessage(chatId, 
                    `✅ Twitter account linked successfully!\n\n` +
                    `🐦 Twitter: @${twitterHandle}\n\n` +
                    `You can now participate in campaigns! Use /campaigns to see what's available.`
                );
                
                console.log(`📱 User ${users[userIndex].firstName} linked Twitter: @${twitterHandle}`);
            }
        }
    });
});

// /campaigns command
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
            `Use /twitter to link your account, then you can participate in campaigns.`
        );
        return;
    }
    
    const availableCampaigns = campaigns.filter(c => c.status === 'pending' || c.status === 'active');
    
    if (availableCampaigns.length === 0) {
        bot.sendMessage(chatId, 
            `📋 No Active Campaigns\n\n` +
            `There are no campaigns available right now.\n` +
            `New campaigns are posted regularly!\n\n` +
            `💡 We'll notify you when new campaigns are available.`
        );
    } else {
        let message = `🚀 Available Campaigns:\n\n`;
        
        availableCampaigns.forEach((campaign, index) => {
            const estimatedEarning = Math.round(campaign.budget * 0.65 / campaign.estimatedParticipants);
            
            message += `${index + 1}. ${campaign.brandName}\n`;
            message += `💰 Est. Earning: ₦${estimatedEarning.toLocaleString()}\n`;
            message += `⏱️ Duration: ${campaign.duration} hours\n`;
            message += `👥 Spots: ${campaign.participants.length}/${campaign.estimatedParticipants}\n`;
            message += `📊 Package: ${campaign.package}\n\n`;
        });
        
        message += `💡 Assignments are created automatically based on your activity!\n`;
        message += `Use /assignments to check if you've been selected.`;
        
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
        bot.sendMessage(chatId, 
            `📋 No Current Assignments\n\n` +
            `You don't have any active assignments right now.\n` +
            `Make sure your Twitter account is linked and stay active!\n\n` +
            `💡 New campaigns are created regularly.`
        );
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
    
    bot.sendMessage(chatId, 
        `💰 Your Earnings Summary\n\n` +
        `Total Earned: ₦${user.earnings || 0}\n` +
        `Campaigns Completed: ${user.campaigns || 0}\n` +
        `Account Status: ${user.isActive ? '✅ Active' : '❌ Inactive'}\n\n` +
        `💡 Keep participating to earn more!`
    );
});

// /status command
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    bot.sendMessage(chatId, 
        `📊 Account Status\n\n` +
        `Name: ${user.firstName} ${user.lastName}\n` +
        `Twitter: ${user.twitterHandle ? '@' + user.twitterHandle : '❌ Not linked'}\n` +
        `Status: ${user.isActive ? '✅ Active' : '❌ Inactive'}\n` +
        `Registered: ${user.registeredAt.toDateString()}\n` +
        `Total Earnings: ₦${user.earnings || 0}\n\n` +
        `${!user.twitterHandle ? '📝 Link your Twitter with /twitter' : '🎉 You\'re all set!'}`
    );
});

// Handle unknown commands
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Ignore if it's a command we handle or not a command
    if (!text || !text.startsWith('/') || text.match(/\/(start|help|twitter|campaigns|earnings|status|assignments)/)) {
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
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🤖 Telegram bot is active and listening...`);
    console.log(`👥 Total registered users: ${users.length}`);
    console.log(`📱 Go to Telegram and message your bot to test it!`);
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server and bot...');
    bot.stopPolling();
    process.exit(0);
});